-- Migration 32 — run in Supabase SQL Editor AFTER migration_31.sql
--
-- Quality module: a Quality Manager inspects an order (stitched count vs cut
-- count, design, colour, print vs sample, and more). Only an approved order
-- can be marked Shipped or have deliveries logged.

-- 1. New role: quality_manager (also fixes invitations so every role can be invited)
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin','user','hr','gm','pm','tl','cutting_master','sales','quality_manager'));

do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'role_invitations'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%intended_role%' loop
    execute format('alter table role_invitations drop constraint %I', c.conname);
  end loop;
end $$;
alter table role_invitations add constraint role_invitations_intended_role_check
  check (intended_role in ('admin','user','hr','gm','pm','tl','cutting_master','sales','quality_manager'));

create or replace function is_quality_or_admin()
returns boolean as $$
  select is_admin() or exists (select 1 from profiles where id = auth.uid() and role = 'quality_manager');
$$ language sql security definer stable;

-- 2. Order-level quality status
alter table orders
  add column if not exists quality_status text not null default 'Not inspected'
    check (quality_status in ('Not inspected','Approved','Rejected')),
  add column if not exists quality_approved_at timestamptz,
  add column if not exists quality_approved_by text;

-- orders already shipped before this feature existed are treated as approved
update orders set quality_status = 'Approved' where status = 'Shipped' and quality_status = 'Not inspected';

-- 3. Inspections (one row per inspection; an order can be re-inspected after a rejection)
create table if not exists quality_inspections (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  decision text not null check (decision in ('Approved','Rejected')),
  checks jsonb not null default '[]',          -- [{key,label,result: Pass|Fail|NA, note}]
  cut_total numeric default 0,
  stitched_total numeric default 0,
  inspected_qty numeric,
  defective_qty numeric,
  photos text[] default '{}',                  -- paths in the 'bills' bucket under quality/
  notes text,
  inspected_by uuid references profiles(id) on delete set null,
  inspected_by_name text,
  created_at timestamptz default now()
);
alter table quality_inspections enable row level security;
drop policy if exists "qi_select" on quality_inspections;
create policy "qi_select" on quality_inspections for select using (auth.role() = 'authenticated');
-- no insert/update policies: inspections are written only through submit_quality_inspection()

-- 4. Cut vs stitched totals for an order (approved cutting vs order progress)
create or replace function order_count_summary(p_order_id uuid)
returns json language sql security definer set search_path = public stable as $$
  select json_build_object(
    'cut', coalesce((select sum(v::numeric) from cutting_entries c, jsonb_each_text(c.sizes) e(k, v)
                     where c.order_id = p_order_id and c.status = 'Approved'), 0),
    'stitched', coalesce((select sum(quantity) from order_progress where order_id = p_order_id), 0)
  );
$$;
grant execute on function order_count_summary(uuid) to authenticated;

-- 5. Submit an inspection
create or replace function submit_quality_inspection(
  p_order_id uuid, p_decision text, p_checks jsonb,
  p_inspected numeric, p_defective numeric, p_notes text, p_photos text[]
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_counts json; v_cut numeric; v_stitched numeric;
  v_checks jsonb := '[]'; c jsonb; v_res text;
begin
  if not is_quality_or_admin() then
    return json_build_object('ok', false, 'error', 'Only the Quality Manager can inspect orders');
  end if;
  if p_decision not in ('Approved','Rejected') then
    return json_build_object('ok', false, 'error', 'Invalid decision');
  end if;
  select name into v_name from profiles where id = auth.uid();
  v_counts := order_count_summary(p_order_id);
  v_cut := (v_counts->>'cut')::numeric;
  v_stitched := (v_counts->>'stitched')::numeric;

  -- re-write the count check from the real numbers so it can't be faked
  for c in select * from jsonb_array_elements(p_checks) loop
    v_res := c->>'result';
    if c->>'key' = 'count_match' and v_cut > 0 then
      v_res := case when v_cut = v_stitched then 'Pass' else 'Fail' end;
    end if;
    if v_res not in ('Pass','Fail','NA') then
      return json_build_object('ok', false, 'error', 'Answer every check (Pass / Fail / N/A)');
    end if;
    v_checks := v_checks || jsonb_build_array(jsonb_set(c, '{result}', to_jsonb(v_res)));
  end loop;

  if p_decision = 'Approved' then
    if exists (select 1 from jsonb_array_elements(v_checks) x where x->>'result' = 'Fail') then
      return json_build_object('ok', false, 'error',
        case when v_cut > 0 and v_cut <> v_stitched
             then 'Stitched count (' || v_stitched || ') does not match cut count (' || v_cut || ')'
             else 'A failed check cannot be approved — reject the order or fix the issue and re-inspect' end);
    end if;
  elsif coalesce(trim(p_notes),'') = '' then
    return json_build_object('ok', false, 'error', 'Write the reason for rejecting');
  end if;

  insert into quality_inspections (order_id, decision, checks, cut_total, stitched_total, inspected_qty, defective_qty,
                                   photos, notes, inspected_by, inspected_by_name)
  values (p_order_id, p_decision, v_checks, v_cut, v_stitched, p_inspected, p_defective,
          coalesce(p_photos,'{}'), nullif(p_notes,''), auth.uid(), v_name);

  update orders set quality_status = p_decision,
                    quality_approved_at = case when p_decision = 'Approved' then now() else null end,
                    quality_approved_by = case when p_decision = 'Approved' then v_name else null end
  where id = p_order_id;

  return json_build_object('ok', true);
end;
$$;
grant execute on function submit_quality_inspection(uuid, text, jsonb, numeric, numeric, text, text[]) to authenticated;

-- 6. Gate: no Shipped status and no delivery entries without quality approval
create or replace function block_ship_without_quality()
returns trigger language plpgsql as $$
begin
  if new.status = 'Shipped' and old.status is distinct from 'Shipped' and new.quality_status <> 'Approved' then
    raise exception 'Quality approval is required before this order can be shipped';
  end if;
  return new;
end;
$$;
drop trigger if exists orders_require_quality on orders;
create trigger orders_require_quality before update on orders
  for each row execute procedure block_ship_without_quality();

create or replace function block_delivery_without_quality()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from orders where id = new.order_id and quality_status = 'Approved') then
    raise exception 'Quality approval is required before goods are dispatched for this order';
  end if;
  return new;
end;
$$;
drop trigger if exists deliveries_require_quality on order_deliveries;
create trigger deliveries_require_quality before insert on order_deliveries
  for each row execute procedure block_delivery_without_quality();

-- 7. Inspection photos: bills/quality/<order id>/...
drop policy if exists "bills_quality_insert" on storage.objects;
drop policy if exists "bills_quality_select" on storage.objects;
create policy "bills_quality_insert" on storage.objects for insert
  with check (bucket_id = 'bills' and (storage.foldername(name))[1] = 'quality' and is_quality_or_admin());
create policy "bills_quality_select" on storage.objects for select
  using (bucket_id = 'bills' and (storage.foldername(name))[1] = 'quality'
         and (is_quality_or_admin() or is_gm_pm_or_admin()));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='quality_inspections') then
    alter publication supabase_realtime add table quality_inspections;
  end if;
end $$;
