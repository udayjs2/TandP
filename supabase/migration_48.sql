-- v53: partial dispatches. Each lot of pieces goes through its own QC approval, then dispatch approval by the
-- Production Manager and the General Manager, before deliveries can be logged against it.
-- Run after migration_47.sql. Safe to re-run.

create table if not exists dispatch_lots (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  lot_no int not null,
  items jsonb not null default '[]',
  note text,
  status text not null default 'Pending QC' check (status in ('Pending QC','Pending PM','Pending GM','Approved','Rejected')),
  requested_by text,
  requested_at timestamptz default now(),
  qc_by text, qc_at timestamptz, qc_inspected numeric, qc_defective numeric, qc_note text,
  pm_by text, pm_at timestamptz,
  gm_by text, gm_at timestamptz,
  reject_stage text,
  reject_reason text,
  unique (order_id, lot_no)
);
alter table dispatch_lots enable row level security;
drop policy if exists "dispatch_lots_select" on dispatch_lots;
create policy "dispatch_lots_select" on dispatch_lots for select using (auth.role() = 'authenticated');
-- no write policies: lots are created and approved only through the functions below

alter table order_deliveries add column if not exists lot_id uuid references dispatch_lots(id) on delete set null;
do $$ begin alter publication supabase_realtime add table dispatch_lots; exception when others then null; end $$;

-- Pieces can leave the factory when the whole order is approved, OR against a fully approved partial dispatch.
create or replace function block_delivery_without_quality()
returns trigger language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; l dispatch_lots%rowtype; lot_qty numeric; done numeric;
begin
  select * into o from orders where id = new.order_id;
  if o.quality_status = 'Approved' and o.dispatch_status = 'Approved' then return new; end if;
  if new.lot_id is null then
    raise exception 'The order needs quality and dispatch approval, or choose an approved partial dispatch, before goods are dispatched';
  end if;
  select * into l from dispatch_lots where id = new.lot_id and order_id = new.order_id;
  if not found then raise exception 'This partial dispatch does not belong to the order'; end if;
  if l.status <> 'Approved' then
    raise exception 'Partial dispatch % is not fully approved yet (status: %)', l.lot_no, l.status;
  end if;
  select coalesce(sum((it->>'quantity')::numeric), 0) into lot_qty
    from jsonb_array_elements(l.items) it where it->>'description' = new.item_description;
  if lot_qty = 0 then raise exception 'This item is not part of the approved partial dispatch %', l.lot_no; end if;
  select coalesce(sum(quantity), 0) into done from order_deliveries
   where lot_id = l.id and item_description = new.item_description and id is distinct from new.id;
  if done + new.quantity > lot_qty then
    raise exception 'Only % more pieces of % are approved in partial dispatch %', greatest(0, lot_qty - done), new.item_description, l.lot_no;
  end if;
  return new;
end $$;

-- 1. Request a lot of already-made pieces
create or replace function request_dispatch_lot(p_order_id uuid, p_items jsonb, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; it jsonb; d text; q numeric; clean jsonb := '[]'; seen text[] := '{}';
        ordered numeric; made numeric; lotted numeric; avail numeric; v_no int; v_name text; v_id uuid;
begin
  if not (is_tl_or_above() or is_admin()) then
    return json_build_object('ok', false, 'error', 'Only the Team Lead, Production Manager, General Manager or Admin can request a partial dispatch');
  end if;
  select * into o from orders where id = p_order_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Order not found'); end if;
  if o.status in ('Shipped','Completed','Rejected by Customer') then
    return json_build_object('ok', false, 'error', 'This order has already been shipped');
  end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    d := trim(coalesce(it->>'description', ''));
    q := nullif(it->>'quantity', '')::numeric;
    if q is null or q <= 0 then continue; end if;
    if q <> floor(q) then return json_build_object('ok', false, 'error', 'Pieces must be whole numbers'); end if;
    if d = any(seen) then return json_build_object('ok', false, 'error', 'Each item can appear once in a lot'); end if;
    seen := seen || d;
    select sum((x->>'quantity')::numeric) into ordered from jsonb_array_elements(o.items) x where x->>'description' = d;
    if ordered is null then return json_build_object('ok', false, 'error', format('"%s" is not an item of this order', d)); end if;
    select coalesce(sum(quantity), 0) into made from order_progress where order_id = o.id and item_description = d;
    select coalesce(sum((li->>'quantity')::numeric), 0) into lotted
      from dispatch_lots l, jsonb_array_elements(l.items) li
     where l.order_id = o.id and l.status <> 'Rejected' and li->>'description' = d;
    avail := greatest(0, least(made, ordered) - lotted);
    if q > avail then
      return json_build_object('ok', false, 'error', format('%s: only %s pieces are available (made %s, already in other partial dispatches %s)', d, avail, made, lotted));
    end if;
    clean := clean || jsonb_build_array(jsonb_build_object('description', d, 'quantity', q));
  end loop;
  if jsonb_array_length(clean) = 0 then return json_build_object('ok', false, 'error', 'Enter the pieces to dispatch'); end if;
  select coalesce(max(lot_no), 0) + 1 into v_no from dispatch_lots where order_id = o.id;
  select name into v_name from profiles where id = auth.uid();
  insert into dispatch_lots (order_id, lot_no, items, note, requested_by)
  values (o.id, v_no, clean, nullif(trim(coalesce(p_note, '')), ''), v_name) returning id into v_id;
  return json_build_object('ok', true, 'id', v_id, 'lot_no', v_no);
end $$;

-- 2. Quality check of the lot (Quality Manager / QC / PM / Admin)
create or replace function qc_dispatch_lot(p_lot uuid, p_decision text, p_inspected numeric, p_defective numeric, p_note text)
returns json language plpgsql security definer set search_path = public as $$
declare l dispatch_lots%rowtype; v_name text; v_total numeric;
begin
  if not is_quality_or_admin() then
    return json_build_object('ok', false, 'error', 'Only the Quality Manager, QC or Production Manager can approve quality');
  end if;
  if p_decision not in ('Approved','Rejected') then return json_build_object('ok', false, 'error', 'Invalid decision'); end if;
  select * into l from dispatch_lots where id = p_lot for update;
  if not found then return json_build_object('ok', false, 'error', 'Partial dispatch not found'); end if;
  if l.status <> 'Pending QC' then return json_build_object('ok', false, 'error', 'This partial dispatch is not waiting for quality approval'); end if;
  select name into v_name from profiles where id = auth.uid();
  if p_decision = 'Rejected' then
    if length(trim(coalesce(p_note, ''))) < 3 then return json_build_object('ok', false, 'error', 'Write the reason for rejecting'); end if;
    update dispatch_lots set status = 'Rejected', reject_stage = 'QC', reject_reason = trim(p_note),
           qc_by = v_name, qc_at = now(), qc_inspected = p_inspected, qc_defective = p_defective, qc_note = trim(p_note)
     where id = p_lot;
    return json_build_object('ok', true, 'status', 'Rejected');
  end if;
  select coalesce(sum((it->>'quantity')::numeric), 0) into v_total from jsonb_array_elements(l.items) it;
  if coalesce(p_inspected, 0) <= 0 then return json_build_object('ok', false, 'error', 'Enter how many pieces were inspected'); end if;
  if p_inspected > v_total then return json_build_object('ok', false, 'error', format('Inspected pieces cannot be more than the %s pieces in this lot', v_total)); end if;
  if coalesce(p_defective, 0) < 0 or coalesce(p_defective, 0) > p_inspected then return json_build_object('ok', false, 'error', 'Check the defective count'); end if;
  if coalesce(p_defective, 0) > 0 then
    return json_build_object('ok', false, 'error', 'Defective pieces were found. Remove them from the lot (delete it and request a corrected one) or reject it.');
  end if;
  update dispatch_lots set status = 'Pending PM', qc_by = v_name, qc_at = now(), qc_inspected = p_inspected,
         qc_defective = 0, qc_note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_lot;
  return json_build_object('ok', true, 'status', 'Pending PM');
end $$;

-- 3. Dispatch approval of the lot: Production Manager, then General Manager (Admin can act at either step)
create or replace function approve_lot_dispatch(p_lot uuid, p_decision text, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare l dispatch_lots%rowtype; r text; v_name text;
begin
  r := my_role();
  if r not in ('pm','gm','admin') then
    return json_build_object('ok', false, 'error', 'Only the Production Manager and General Manager approve dispatch');
  end if;
  if p_decision not in ('Approved','Rejected') then return json_build_object('ok', false, 'error', 'Invalid decision'); end if;
  select * into l from dispatch_lots where id = p_lot for update;
  if not found then return json_build_object('ok', false, 'error', 'Partial dispatch not found'); end if;
  if l.status = 'Pending PM' then
    if r not in ('pm','admin') then return json_build_object('ok', false, 'error', 'Waiting for the Production Manager to approve first'); end if;
  elsif l.status = 'Pending GM' then
    if r not in ('gm','admin') then return json_build_object('ok', false, 'error', 'Waiting for the General Manager'); end if;
  else
    return json_build_object('ok', false, 'error', 'This partial dispatch is not waiting for dispatch approval');
  end if;
  select name into v_name from profiles where id = auth.uid();
  if p_decision = 'Rejected' then
    if length(trim(coalesce(p_note, ''))) < 3 then return json_build_object('ok', false, 'error', 'Write the reason for rejecting'); end if;
    update dispatch_lots set status = 'Rejected', reject_stage = case when l.status = 'Pending PM' then 'PM' else 'GM' end, reject_reason = trim(p_note) where id = p_lot;
  elsif l.status = 'Pending PM' then
    update dispatch_lots set status = 'Pending GM', pm_by = v_name, pm_at = now() where id = p_lot;
  else
    update dispatch_lots set status = 'Approved', gm_by = v_name, gm_at = now() where id = p_lot;
  end if;
  return json_build_object('ok', true);
end $$;

-- 4. Remove a lot that has not been dispatched yet
create or replace function delete_dispatch_lot(p_lot uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  if my_role() not in ('admin','gm','pm') then
    return json_build_object('ok', false, 'error', 'Only the Admin, Production Manager or General Manager can remove a partial dispatch');
  end if;
  if exists (select 1 from order_deliveries where lot_id = p_lot) then
    return json_build_object('ok', false, 'error', 'Goods have already been dispatched against this lot');
  end if;
  delete from dispatch_lots where id = p_lot;
  return json_build_object('ok', true);
end $$;

grant execute on function request_dispatch_lot(uuid, jsonb, text) to authenticated;
grant execute on function qc_dispatch_lot(uuid, text, numeric, numeric, text) to authenticated;
grant execute on function approve_lot_dispatch(uuid, text, text) to authenticated;
grant execute on function delete_dispatch_lot(uuid) to authenticated;
