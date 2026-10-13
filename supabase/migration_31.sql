-- Migration 31 — run in Supabase SQL Editor AFTER migration_30.sql
--
-- Purchase request lifecycle after approval:
--   Approved -> Payment to vendor -> Vendor invoice -> Dispatch / transport
--   tracking -> Goods received at factory -> posted into Inventory.

alter table purchase_requests
  add column if not exists paid_at date,
  add column if not exists paid_amount numeric,
  add column if not exists payment_mode text,
  add column if not exists payment_ref text,
  add column if not exists paid_by text,
  add column if not exists invoice_number text,
  add column if not exists invoice_date date,
  add column if not exists invoice_amount numeric,
  add column if not exists invoice_path text,          -- file in the 'bills' bucket
  add column if not exists transporter text,
  add column if not exists tracking_number text,
  add column if not exists dispatch_date date,
  add column if not exists expected_arrival date,
  add column if not exists received_at date,
  add column if not exists received_by text,
  add column if not exists received_qty numeric,
  add column if not exists received_notes text,
  add column if not exists inventory_posted text;       -- what was added to inventory, for the record

-- Vendor invoice files live under bills/vendor-invoices/... ; GM/PM/Admin/HR may upload and read them
drop policy if exists "bills_vendor_insert" on storage.objects;
drop policy if exists "bills_vendor_select" on storage.objects;
create policy "bills_vendor_insert" on storage.objects for insert
  with check (bucket_id = 'bills' and (storage.foldername(name))[1] = 'vendor-invoices' and is_gm_pm_or_admin());
create policy "bills_vendor_select" on storage.objects for select
  using (bucket_id = 'bills' and (storage.foldername(name))[1] = 'vendor-invoices' and is_gm_pm_or_admin());

-- Payment / invoice / dispatch updates. p_stage: 'payment' | 'invoice' | 'dispatch'
create or replace function update_purchase_fulfilment(p_id uuid, p_stage text, p_data jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_role text; v_name text; r purchase_requests%rowtype;
begin
  select role, name into v_role, v_name from profiles where id = auth.uid();
  select * into r from purchase_requests where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Request not found'); end if;
  if r.status <> 'Approved' then return json_build_object('ok', false, 'error', 'Only approved requests can be processed'); end if;
  if r.received_at is not null then return json_build_object('ok', false, 'error', 'Goods already received'); end if;

  if p_stage = 'payment' then
    if v_role not in ('admin','hr') then return json_build_object('ok', false, 'error', 'Only Admin/HR can record payments'); end if;
    update purchase_requests set
      paid_at = (p_data->>'paid_at')::date,
      paid_amount = (p_data->>'paid_amount')::numeric,
      payment_mode = p_data->>'payment_mode',
      payment_ref = nullif(p_data->>'payment_ref',''),
      paid_by = v_name
    where id = p_id;
  elsif p_stage = 'invoice' then
    if not is_gm_pm_or_admin() then return json_build_object('ok', false, 'error', 'Not allowed'); end if;
    update purchase_requests set
      invoice_number = p_data->>'invoice_number',
      invoice_date = nullif(p_data->>'invoice_date','')::date,
      invoice_amount = nullif(p_data->>'invoice_amount','')::numeric,
      invoice_path = coalesce(nullif(p_data->>'invoice_path',''), invoice_path),
      vendor = coalesce(nullif(p_data->>'vendor',''), vendor)
    where id = p_id;
    -- the real invoice amount replaces the estimate in the order's expenditure
    if nullif(p_data->>'invoice_amount','') is not null and r.expenditure_id is not null then
      update expenditures set
        amount = (p_data->>'invoice_amount')::numeric,
        vendor = coalesce(nullif(p_data->>'vendor',''), vendor),
        notes = coalesce(notes,'') || ' [Invoice ' || (p_data->>'invoice_number') || ']'
      where id = r.expenditure_id;
    end if;
  elsif p_stage = 'dispatch' then
    if not is_gm_pm_or_admin() then return json_build_object('ok', false, 'error', 'Not allowed'); end if;
    update purchase_requests set
      transporter = p_data->>'transporter',
      tracking_number = nullif(p_data->>'tracking_number',''),
      dispatch_date = nullif(p_data->>'dispatch_date','')::date,
      expected_arrival = nullif(p_data->>'expected_arrival','')::date
    where id = p_id;
  else
    return json_build_object('ok', false, 'error', 'Unknown stage');
  end if;
  return json_build_object('ok', true);
end;
$$;
grant execute on function update_purchase_fulfilment(uuid, text, jsonb) to authenticated;

-- Goods receipt: marks the request received AND adds the stock to Inventory in one step.
-- p_inv examples:
--  Fabric:      {"mode":"existing","id":"<fabric id>","kg":50,"meters":200}
--               {"mode":"new","fabric_type":"Single jersey","color":"Navy","weight_gsm":180,"kg":50,"meters":200}
--  Accessories: {"mode":"existing","id":"<item id>","quantity":500}
--               {"mode":"new","category":"Elastic","name":"Elastic 20mm","unit":"m","quantity":500}
--  Machine:     {"model":"JUKI","model_other":null,"machine_type":"Single needle","quantity":2}
--  Spare Parts: {"machine_id":"<id or empty>","part_name":"Motor","quantity":1}
create or replace function receive_purchase_request(p_id uuid, p_received_qty numeric, p_notes text, p_inv jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_name text; r purchase_requests%rowtype; v_msg text := 'No inventory posting (category: Other)';
  v_id uuid; v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not is_gm_pm_or_admin() then return json_build_object('ok', false, 'error', 'Not allowed'); end if;
  select name into v_name from profiles where id = auth.uid();
  select * into r from purchase_requests where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Request not found'); end if;
  if r.status <> 'Approved' then return json_build_object('ok', false, 'error', 'Request is not approved'); end if;
  if r.received_at is not null then return json_build_object('ok', false, 'error', 'Already received'); end if;

  if r.category = 'Fabric' then
    if p_inv->>'mode' = 'existing' then
      update inventory_fabric set
        stock_kg = coalesce(stock_kg,0) + coalesce((p_inv->>'kg')::numeric,0),
        stock_meters = coalesce(stock_meters,0) + coalesce((p_inv->>'meters')::numeric,0)
      where id = (p_inv->>'id')::uuid;
      if not found then return json_build_object('ok', false, 'error', 'Fabric not found'); end if;
    else
      insert into inventory_fabric (fabric_type, color, weight_gsm, stock_kg, stock_meters, supplier)
      values (p_inv->>'fabric_type', nullif(p_inv->>'color',''), nullif(p_inv->>'weight_gsm','')::numeric,
              coalesce((p_inv->>'kg')::numeric,0), coalesce((p_inv->>'meters')::numeric,0), r.vendor);
    end if;
    v_msg := 'Fabric +' || coalesce(p_inv->>'kg','0') || ' kg / ' || coalesce(p_inv->>'meters','0') || ' m';

  elsif r.category = 'Accessories' then
    if p_inv->>'mode' = 'existing' then
      update inventory_items set quantity = coalesce(quantity,0) + coalesce((p_inv->>'quantity')::numeric,0)
      where id = (p_inv->>'id')::uuid;
      if not found then return json_build_object('ok', false, 'error', 'Item not found'); end if;
    else
      insert into inventory_items (category, name, quantity, unit, notes)
      values (coalesce(nullif(p_inv->>'category',''),'Accessory'), p_inv->>'name',
              coalesce((p_inv->>'quantity')::numeric,0), coalesce(nullif(p_inv->>'unit',''),'pcs'),
              'Received via purchase request');
    end if;
    v_msg := 'Item +' || coalesce(p_inv->>'quantity','0');

  elsif r.category = 'Machine' then
    insert into inventory_machines (model, model_other, machine_type, quantity, working_condition, purchase_date, notes)
    values (coalesce(nullif(p_inv->>'model',''),'OTHER'), nullif(p_inv->>'model_other',''), p_inv->>'machine_type',
            coalesce((p_inv->>'quantity')::integer,1), 'Working', coalesce(r.invoice_date, v_today),
            'Received via purchase request');
    v_msg := 'Machine +' || coalesce(p_inv->>'quantity','1');

  elsif r.category = 'Spare Parts' then
    insert into inventory_spare_parts (machine_id, part_name, quantity, status, supplier, amount, purchase_date, notes)
    values (nullif(p_inv->>'machine_id','')::uuid, p_inv->>'part_name', coalesce((p_inv->>'quantity')::numeric,1),
            'Purchased', r.vendor, coalesce(r.invoice_amount, r.amount), coalesce(r.invoice_date, v_today),
            'Received via purchase request');
    v_msg := 'Spare part +' || coalesce(p_inv->>'quantity','1');
  end if;

  update purchase_requests set
    received_at = v_today, received_by = v_name, received_qty = p_received_qty,
    received_notes = nullif(p_notes,''), inventory_posted = v_msg
  where id = p_id;
  return json_build_object('ok', true, 'posted', v_msg);
end;
$$;
grant execute on function receive_purchase_request(uuid, numeric, text, jsonb) to authenticated;
