-- v81: fabric history log. Fabric whose stock reaches zero moves from Inventory to Inventory -> History Logs together with
-- when it was bought, from which vendor, how much, and which orders used it. Run after migration_66.sql. Safe to re-run.

create table if not exists fabric_receipts (
  id uuid primary key default gen_random_uuid(),
  fabric_id uuid references inventory_fabric(id) on delete set null,
  request_id uuid references purchase_requests(id) on delete set null,
  vendor text,
  kg numeric not null default 0,
  meters numeric not null default 0,
  amount numeric,
  received_on date,
  received_by text,
  fabric_label text,
  order_id uuid references orders(id) on delete set null,   -- order the purchase was requested for, if any
  created_at timestamptz default now()
);
create index if not exists fabric_receipts_fabric on fabric_receipts(fabric_id);
alter table fabric_receipts enable row level security;
drop policy if exists "fabric_receipts_select" on fabric_receipts;
create policy "fabric_receipts_select" on fabric_receipts for select using (is_gm_pm_or_admin());
do $$ begin alter publication supabase_realtime add table fabric_receipts; exception when others then null; end $$;

alter table inventory_fabric add column if not exists exhausted_at timestamptz;

create or replace function trg_fabric_exhausted() returns trigger
language plpgsql as $$
begin
  if coalesce(new.stock_kg, 0) <= 0.0001 and coalesce(new.stock_meters, 0) <= 0.0001 then
    if tg_op = 'UPDATE' and (coalesce(old.stock_kg, 0) > 0.0001 or coalesce(old.stock_meters, 0) > 0.0001) then
      new.exhausted_at := now();            -- just used up: moves to the history log
    end if;
  else
    new.exhausted_at := null;               -- stock came back (return / new purchase): active again
  end if;
  return new;
end $$;
drop trigger if exists fabric_exhausted_flag on inventory_fabric;
create trigger fabric_exhausted_flag before insert or update of stock_kg, stock_meters on inventory_fabric
  for each row execute function trg_fabric_exhausted();

-- fabrics already at zero that have been used before go to the history now
update inventory_fabric f set exhausted_at = coalesce((select max(u.created_at) from fabric_usage u where u.fabric_id = f.id), f.created_at)
 where f.exhausted_at is null and coalesce(f.stock_kg, 0) <= 0.0001 and coalesce(f.stock_meters, 0) <= 0.0001
   and exists (select 1 from fabric_usage u where u.fabric_id = f.id);

-- purchases are recorded when goods are received
create or replace function receive_purchase_request(p_id uuid, p_received_qty numeric, p_notes text, p_inv jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_name text; r purchase_requests%rowtype; v_msg text := 'No inventory posting (category: Other)';
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_amt numeric; v_kg numeric; v_m numeric; v_q numeric; f inventory_fabric%rowtype; it inventory_items%rowtype; v_fid uuid;
begin
  if not is_gm_pm_or_admin() then return json_build_object('ok', false, 'error', 'Not allowed'); end if;
  select name into v_name from profiles where id = auth.uid();
  select * into r from purchase_requests where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Request not found'); end if;
  if r.status <> 'Approved' then return json_build_object('ok', false, 'error', 'Request is not approved'); end if;
  if r.received_at is not null then return json_build_object('ok', false, 'error', 'Already received'); end if;
  v_amt := coalesce(r.invoice_amount, r.amount);

  if r.category = 'Fabric' then
    v_kg := coalesce((p_inv->>'kg')::numeric, 0); v_m := coalesce((p_inv->>'meters')::numeric, 0);
    if p_inv->>'mode' = 'existing' then
      select * into f from inventory_fabric where id = (p_inv->>'id')::uuid for update;
      if not found then return json_build_object('ok', false, 'error', 'Fabric not found'); end if;
      update inventory_fabric set
        stock_kg = coalesce(stock_kg,0) + v_kg,
        stock_meters = coalesce(stock_meters,0) + v_m,
        price_per_kg = case when v_kg > 0 and v_amt > 0 then round((coalesce(f.stock_kg,0) * coalesce(f.price_per_kg,0) + v_amt) / (coalesce(f.stock_kg,0) + v_kg), 2) else price_per_kg end,
        price_per_meter = case when v_m > 0 and v_kg = 0 and v_amt > 0 then round((coalesce(f.stock_meters,0) * coalesce(f.price_per_meter,0) + v_amt) / (coalesce(f.stock_meters,0) + v_m), 2) else price_per_meter end
      where id = f.id;
      v_fid := f.id;
    else
      insert into inventory_fabric (fabric_type, color, weight_gsm, stock_kg, stock_meters, supplier, price_per_kg, price_per_meter)
      values (p_inv->>'fabric_type', nullif(p_inv->>'color',''), nullif(p_inv->>'weight_gsm','')::numeric, v_kg, v_m, r.vendor,
              case when v_kg > 0 and v_amt > 0 then round(v_amt / v_kg, 2) end,
              case when v_m > 0 and v_kg = 0 and v_amt > 0 then round(v_amt / v_m, 2) end)
      returning id into v_fid;
    end if;
    insert into fabric_receipts (fabric_id, request_id, vendor, kg, meters, amount, received_on, received_by, fabric_label, order_id)
    values (v_fid, r.id, r.vendor, v_kg, v_m, v_amt, v_today, v_name, r.item, r.order_id);
    v_msg := 'Fabric +' || coalesce(p_inv->>'kg','0') || ' kg / ' || coalesce(p_inv->>'meters','0') || ' m';

  elsif r.category = 'Accessories' then
    v_q := coalesce((p_inv->>'quantity')::numeric, 0);
    if p_inv->>'mode' = 'existing' then
      select * into it from inventory_items where id = (p_inv->>'id')::uuid for update;
      if not found then return json_build_object('ok', false, 'error', 'Item not found'); end if;
      update inventory_items set quantity = coalesce(quantity,0) + v_q,
        unit_price = case when v_q > 0 and v_amt > 0 then round((coalesce(it.quantity,0) * coalesce(it.unit_price,0) + v_amt) / (coalesce(it.quantity,0) + v_q), 4) else unit_price end
      where id = it.id;
    else
      insert into inventory_items (category, name, quantity, unit, notes, unit_price)
      values (coalesce(nullif(p_inv->>'category',''),'Accessory'), p_inv->>'name', v_q, coalesce(nullif(p_inv->>'unit',''),'pcs'),
              'Received via purchase request', case when v_q > 0 and v_amt > 0 then round(v_amt / v_q, 4) end);
    end if;
    v_msg := 'Item +' || coalesce(p_inv->>'quantity','0');

  elsif r.category = 'Machine' then
    insert into inventory_machines (model, model_other, machine_type, quantity, working_condition, purchase_date, notes)
    values (coalesce(nullif(p_inv->>'model',''),'OTHER'), nullif(p_inv->>'model_other',''), p_inv->>'machine_type',
            coalesce((p_inv->>'quantity')::integer,1), 'Working', coalesce(r.invoice_date, v_today), 'Received via purchase request');
    v_msg := 'Machine +' || coalesce(p_inv->>'quantity','1');

  elsif r.category = 'Spare Parts' then
    insert into inventory_spare_parts (machine_id, part_name, quantity, status, supplier, amount, purchase_date, notes)
    values (nullif(p_inv->>'machine_id','')::uuid, p_inv->>'part_name', coalesce((p_inv->>'quantity')::numeric,1),
            'Purchased', r.vendor, v_amt, coalesce(r.invoice_date, v_today), 'Received via purchase request');
    v_msg := 'Spare part +' || coalesce(p_inv->>'quantity','1');
  end if;

  update purchase_requests set received_at = v_today, received_by = v_name, received_qty = p_received_qty,
    received_notes = nullif(p_notes,''), inventory_posted = v_msg where id = p_id;
  return json_build_object('ok', true, 'posted', v_msg);
end $$;
grant execute on function receive_purchase_request(uuid, numeric, text, jsonb) to authenticated;

-- best-effort back-fill of fabric already received before this version (matched on vendor + fabric name)
insert into fabric_receipts (fabric_id, request_id, vendor, kg, meters, amount, received_on, received_by, fabric_label, order_id)
select (select f.id from inventory_fabric f where lower(btrim(coalesce(f.supplier,''))) = lower(btrim(coalesce(r.vendor,'')))
          and lower(r.item) like '%' || lower(f.fabric_type) || '%' order by f.created_at limit 1),
       r.id, r.vendor,
       coalesce(nullif(substring(r.inventory_posted from 'Fabric \+([0-9.]+) kg'), '')::numeric, 0),
       coalesce(nullif(substring(r.inventory_posted from '/ ([0-9.]+) m'), '')::numeric, 0),
       coalesce(r.invoice_amount, r.amount), r.received_at, r.received_by, r.item, r.order_id
  from purchase_requests r
 where r.category = 'Fabric' and r.received_at is not null
   and not exists (select 1 from fabric_receipts x where x.request_id = r.id);
