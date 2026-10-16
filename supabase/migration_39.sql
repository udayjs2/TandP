-- v35: access changes, invoice balances, inactive employees, resource allocation access,
-- inventory prices + materials issued to orders, and the actual order cost.
-- Run after migration_38.sql. Safe to re-run.

-- ================= 1. Access control =================
-- Finance-admin = Admin only (HR is no longer a finance user).
create or replace function is_finance_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
$$;

do $$
declare r record;
begin
  -- invoices: Admin only (GM and HR lose access; previously any signed-in user could read them)
  for r in select policyname from pg_policies where schemaname='public' and tablename='invoices' loop
    execute format('drop policy %I on invoices', r.policyname);
  end loop;
  create policy "invoices_finance_admin" on invoices for all using (is_finance_admin()) with check (is_finance_admin());

  -- other financial tables: Admin only
  for r in select tablename, policyname from pg_policies where schemaname='public'
           and tablename in ('investors','investments','order_finance','loans','loan_payments','order_payments') loop
    execute format('drop policy %I on %I', r.policyname, r.tablename);
  end loop;
  create policy "investors_finance_admin" on investors for all using (is_finance_admin()) with check (is_finance_admin());
  create policy "investments_finance_admin" on investments for all using (is_finance_admin()) with check (is_finance_admin());
  create policy "order_finance_finance_admin" on order_finance for all using (is_finance_admin()) with check (is_finance_admin());
  create policy "loans_finance_admin" on loans for all using (is_finance_admin()) with check (is_finance_admin());
  create policy "loan_payments_finance_admin" on loan_payments for all using (is_finance_admin()) with check (is_finance_admin());
  create policy "order_payments_finance_admin" on order_payments for all using (is_finance_admin()) with check (is_finance_admin());

  -- inventory: everyone signed in can read; only Admin / HR can edit (GM and PM are view-only)
  for r in select tablename, policyname from pg_policies where schemaname='public'
           and tablename in ('inventory_machines','inventory_fabric','inventory_items','inventory_spare_parts')
           and cmd <> 'SELECT' loop
    execute format('drop policy %I on %I', r.policyname, r.tablename);
  end loop;
  create policy "inv_machines_write" on inventory_machines for all using (is_admin()) with check (is_admin());
  create policy "inv_fabric_write" on inventory_fabric for all using (is_admin()) with check (is_admin());
  create policy "inv_items_write" on inventory_items for all using (is_admin()) with check (is_admin());
  create policy "inv_parts_write" on inventory_spare_parts for all using (is_admin()) with check (is_admin());

  -- manpower allocation (no wages in this table): Team Lead and above can read / allocate
  for r in select policyname from pg_policies where schemaname='public' and tablename='order_labor' loop
    execute format('drop policy %I on order_labor', r.policyname);
  end loop;
  create policy "order_labor_tl_select" on order_labor for select using (is_tl_or_above());
  create policy "order_labor_tl_insert" on order_labor for insert with check (is_tl_or_above());
  create policy "order_labor_tl_update" on order_labor for update using (is_tl_or_above());
  create policy "order_labor_tl_delete" on order_labor for delete using (is_tl_or_above());
end $$;

-- ================= 2. Invoice balance + automatic Paid =================
alter table invoices add column if not exists paid_auto boolean not null default false;

-- Payments logged against an order are applied to its invoices oldest-first. An invoice covered in
-- full becomes Paid; if a payment is later removed, invoices that were auto-marked Paid revert.
create or replace function recompute_invoice_status(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pool numeric; inv record; share numeric;
begin
  if p_order is null then return; end if;
  select coalesce(sum(amount), 0) into pool from order_payments where order_id = p_order;
  for inv in select id, amount, status, paid_auto from invoices
             where linked_order_id = p_order order by issue_date nulls last, created_at, id loop
    share := least(pool, coalesce(inv.amount, 0));
    pool := pool - share;
    if coalesce(inv.amount, 0) > 0 and share >= inv.amount then
      if inv.status <> 'Paid' then update invoices set status = 'Paid', paid_auto = true where id = inv.id; end if;
    elsif inv.paid_auto and inv.status = 'Paid' then
      update invoices set status = 'Unpaid', paid_auto = false where id = inv.id;
    end if;
  end loop;
end $$;

create or replace function trg_payment_invoice_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') then perform recompute_invoice_status(old.order_id); end if;
  if tg_op in ('INSERT','UPDATE') then perform recompute_invoice_status(new.order_id); end if;
  return null;
end $$;
drop trigger if exists payments_sync_invoices on order_payments;
create trigger payments_sync_invoices after insert or update or delete on order_payments
  for each row execute function trg_payment_invoice_sync();

create or replace function trg_invoice_payment_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform recompute_invoice_status(new.linked_order_id);
  return null;
end $$;
drop trigger if exists invoices_sync_payments on invoices;
create trigger invoices_sync_payments after insert or update of amount, linked_order_id on invoices
  for each row execute function trg_invoice_payment_sync();

-- one-off: apply to everything that already exists
do $$ declare o uuid; begin
  for o in select distinct linked_order_id from invoices where linked_order_id is not null loop
    perform recompute_invoice_status(o);
  end loop;
end $$;

-- ================= 3. Inactive employees =================
alter table employees add column if not exists status text not null default 'Active';
alter table employees drop constraint if exists employees_status_check;
alter table employees add constraint employees_status_check check (status in ('Active','Inactive'));
alter table employees add column if not exists inactive_since date;
alter table employees add column if not exists inactive_reason text;
alter table employees add column if not exists reactivated_at date;

-- Anyone with no attendance record at all for 30 days becomes Inactive (people who joined or were
-- re-activated less than 30 days ago are left alone). Run by Admin / HR when they open Employees.
create or replace function deactivate_stale_employees() returns json
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date; names text[];
begin
  if not is_admin() then return json_build_object('ok', false, 'error', 'Not allowed'); end if;
  with moved as (
    update employees e set status = 'Inactive', inactive_since = today,
           inactive_reason = 'No attendance marked for 30 days'
    where e.status = 'Active'
      and greatest(coalesce(e.join_date, date '1900-01-01'), coalesce(e.reactivated_at, date '1900-01-01'),
                   (e.created_at at time zone 'Asia/Kolkata')::date) <= today - 30
      and not exists (select 1 from attendance a where a.employee_id = e.id and a.date > today - 30)
    returning e.name)
  select coalesce(array_agg(name), '{}') into names from moved;
  return json_build_object('ok', true, 'count', coalesce(array_length(names, 1), 0), 'names', names);
end $$;
grant execute on function deactivate_stale_employees() to authenticated;

create or replace function set_employee_active(p_id uuid, p_active boolean) returns json
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not is_admin() then return json_build_object('ok', false, 'error', 'Only HR or Admin can change this'); end if;
  if p_active then
    update employees set status = 'Active', inactive_since = null, inactive_reason = null, reactivated_at = today where id = p_id;
  else
    update employees set status = 'Inactive', inactive_since = today, inactive_reason = 'Made inactive by HR / Admin' where id = p_id;
  end if;
  return json_build_object('ok', true);
end $$;
grant execute on function set_employee_active(uuid, boolean) to authenticated;

-- ================= 4. Prices in inventory + materials issued to orders =================
alter table inventory_fabric add column if not exists price_per_kg numeric;
alter table inventory_fabric add column if not exists price_per_meter numeric;
alter table inventory_items add column if not exists unit_price numeric;
alter table fabric_usage add column if not exists price_per_kg numeric;
alter table fabric_usage add column if not exists price_per_meter numeric;

-- the price in force when the fabric was cut is kept on the usage row
create or replace function snapshot_fabric_price() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.fabric_id is not null and new.price_per_kg is null and new.price_per_meter is null then
    select f.price_per_kg, f.price_per_meter into new.price_per_kg, new.price_per_meter from inventory_fabric f where f.id = new.fabric_id;
  end if;
  return new;
end $$;
drop trigger if exists fabric_usage_price on fabric_usage;
create trigger fabric_usage_price before insert on fabric_usage for each row execute function snapshot_fabric_price();

create table if not exists order_material_usage (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  item_id uuid references inventory_items(id) on delete set null,
  item_name text not null,
  category text,
  unit text,
  quantity numeric not null check (quantity > 0),
  unit_price numeric,
  used_on date not null default ((now() at time zone 'Asia/Kolkata')::date),
  used_by text,
  notes text,
  returned boolean not null default false,
  created_at timestamptz default now()
);
alter table order_material_usage enable row level security;
drop policy if exists "material_usage_select" on order_material_usage;
create policy "material_usage_select" on order_material_usage for select
  using (is_admin() or is_tl_or_above() or my_role() = 'cutting_master');

create or replace function issue_material_to_order(p_order uuid, p_item uuid, p_qty numeric, p_notes text default null)
returns json language plpgsql security definer set search_path = public as $$
declare it inventory_items%rowtype; who text;
begin
  if not (is_admin() or is_tl_or_above() or my_role() = 'cutting_master') then
    return json_build_object('ok', false, 'error', 'Not allowed'); end if;
  if p_qty is null or p_qty <= 0 then return json_build_object('ok', false, 'error', 'Enter a quantity'); end if;
  select * into it from inventory_items where id = p_item for update;
  if not found then return json_build_object('ok', false, 'error', 'Item not found'); end if;
  if coalesce(it.quantity, 0) < p_qty then
    return json_build_object('ok', false, 'error', 'Only ' || coalesce(it.quantity, 0) || ' ' || coalesce(it.unit, '') || ' in stock'); end if;
  select name into who from profiles where id = auth.uid();
  update inventory_items set quantity = quantity - p_qty where id = p_item;
  insert into order_material_usage (order_id, item_id, item_name, category, unit, quantity, unit_price, used_by, notes)
  values (p_order, p_item, it.name, it.category, it.unit, p_qty, it.unit_price, who, nullif(p_notes, ''));
  return json_build_object('ok', true);
end $$;
grant execute on function issue_material_to_order(uuid, uuid, numeric, text) to authenticated;

create or replace function return_material_usage(p_id uuid) returns json
language plpgsql security definer set search_path = public as $$
declare u order_material_usage%rowtype;
begin
  if not (is_admin() or is_tl_or_above() or my_role() = 'cutting_master') then
    return json_build_object('ok', false, 'error', 'Not allowed'); end if;
  select * into u from order_material_usage where id = p_id for update;
  if not found or u.returned then return json_build_object('ok', false, 'error', 'Nothing to return'); end if;
  if u.item_id is not null then update inventory_items set quantity = quantity + u.quantity where id = u.item_id; end if;
  update order_material_usage set returned = true where id = p_id;
  return json_build_object('ok', true);
end $$;
grant execute on function return_material_usage(uuid) to authenticated;

-- Goods received from a purchase request also set the stock price (weighted average with what is in stock).
create or replace function receive_purchase_request(p_id uuid, p_received_qty numeric, p_notes text, p_inv jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_name text; r purchase_requests%rowtype; v_msg text := 'No inventory posting (category: Other)';
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_amt numeric; v_kg numeric; v_m numeric; v_q numeric; f inventory_fabric%rowtype; it inventory_items%rowtype;
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
    else
      insert into inventory_fabric (fabric_type, color, weight_gsm, stock_kg, stock_meters, supplier, price_per_kg, price_per_meter)
      values (p_inv->>'fabric_type', nullif(p_inv->>'color',''), nullif(p_inv->>'weight_gsm','')::numeric, v_kg, v_m, r.vendor,
              case when v_kg > 0 and v_amt > 0 then round(v_amt / v_kg, 2) end,
              case when v_m > 0 and v_kg = 0 and v_amt > 0 then round(v_amt / v_m, 2) end);
    end if;
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

-- ================= 5. Actual cost of an order (Admin only) =================
-- fabric used x inventory price + trims/thread/elastic issued x inventory price
-- + expenditures tagged to the order (transport, printing, packing, ...) + manpower.
-- Fabric / accessory purchase requests are NOT added again: they are already priced through the stock used.
create or replace function order_actual_cost(p_order uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare fabric json; mats json; other json; crew json; stocked json;
        t_fabric numeric; t_mats numeric; t_other numeric; t_transport numeric; t_crew numeric; unpriced int;
begin
  if not is_finance_admin() then raise exception 'Not allowed'; end if;

  select coalesce(json_agg(x order by x.cut_date), '[]'::json), coalesce(sum(x.cost), 0) into fabric, t_fabric from (
    select u.created_at::date as cut_date, f.fabric_type, f.color, u.kg_used, u.meters_used,
           coalesce(u.price_per_kg, f.price_per_kg) as price_per_kg, coalesce(u.price_per_meter, f.price_per_meter) as price_per_meter,
           coalesce(u.kg_used,0) * coalesce(u.price_per_kg, f.price_per_kg, 0)
             + coalesce(u.meters_used,0) * coalesce(u.price_per_meter, f.price_per_meter, 0) as cost
    from fabric_usage u left join inventory_fabric f on f.id = u.fabric_id
    where u.order_id = p_order and u.restored = false) x;

  select coalesce(json_agg(x order by x.used_on), '[]'::json), coalesce(sum(x.cost), 0) into mats, t_mats from (
    select m.used_on, m.item_name, m.category, m.unit, m.quantity, m.unit_price, m.quantity * coalesce(m.unit_price, 0) as cost
    from order_material_usage m where m.order_id = p_order and not m.returned) x;

  select coalesce(json_agg(x order by x.expense_date), '[]'::json), coalesce(sum(x.amount), 0),
         coalesce(sum(x.amount) filter (where x.category = 'Transport'), 0) into other, t_other, t_transport from (
    select e.expense_date, e.category, e.item, e.vendor, e.amount from expenditures e
    where e.linked_order_id = p_order and e.category <> 'Salary'
      and not exists (select 1 from purchase_requests pr where pr.expenditure_id = e.id and pr.category in ('Fabric','Accessories'))) x;

  select coalesce(json_agg(x), '[]'::json) into stocked from (
    select e.expense_date, e.item, e.amount from expenditures e
    where e.linked_order_id = p_order
      and exists (select 1 from purchase_requests pr where pr.expenditure_id = e.id and pr.category in ('Fabric','Accessories'))) x;

  select coalesce(json_agg(x order by x.work_date, x.name), '[]'::json), coalesce(sum(x.cost), 0) into crew, t_crew from (
    select e.name, l.work_date,
           round((coalesce(e.base_salary,0) / extract(day from (date_trunc('month', l.work_date) + interval '1 month - 1 day')))
                 / (select count(distinct l2.order_id) from order_labor l2 where l2.employee_id = l.employee_id and l2.work_date = l.work_date), 2) as cost
    from order_labor l join employees e on e.id = l.employee_id where l.order_id = p_order) x;

  select (select count(*) from json_array_elements(fabric) r where coalesce((r->>'cost')::numeric,0) = 0)
       + (select count(*) from json_array_elements(mats) r where coalesce((r->>'unit_price')::numeric,0) = 0) into unpriced;

  return json_build_object('fabric', fabric, 'materials', mats, 'other', other, 'stock_purchases', stocked, 'crew', crew,
    'totals', json_build_object('fabric', t_fabric, 'materials', t_mats, 'other', t_other, 'transport', t_transport, 'manpower', t_crew,
                                'total', t_fabric + t_mats + t_other + t_crew),
    'unpriced_lines', unpriced);
end $$;
grant execute on function order_actual_cost(uuid) to authenticated;

do $$ begin alter publication supabase_realtime add table order_material_usage; exception when others then null; end $$;
