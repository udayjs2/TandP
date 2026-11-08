-- v76: Customer details (GSTIN, contacts) built from orders, order value vs invoice fix, yearly commission target,
-- vendors auto-filled from purchase requests, HSN/GST on invoices. Run after migration_62.sql. Safe to re-run.

-- ---------- customers: more details + extra contacts ----------
alter table sales_customers add column if not exists gstin text;
alter table sales_customers add column if not exists email text;
alter table sales_customers add column if not exists address text;
alter table sales_customers add column if not exists credit_limit numeric;

create table if not exists customer_contacts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references sales_customers(id) on delete cascade,
  name text not null,
  designation text,
  phone text,
  email text,
  notes text,
  created_at timestamptz default now()
);
alter table customer_contacts enable row level security;
drop policy if exists "customer_contacts_select" on customer_contacts;
drop policy if exists "customer_contacts_insert" on customer_contacts;
drop policy if exists "customer_contacts_update" on customer_contacts;
drop policy if exists "customer_contacts_delete" on customer_contacts;
create policy "customer_contacts_select" on customer_contacts for select using (auth.role() = 'authenticated');
create policy "customer_contacts_insert" on customer_contacts for insert with check (is_sales_or_admin());
create policy "customer_contacts_update" on customer_contacts for update using (is_sales_or_admin());
create policy "customer_contacts_delete" on customer_contacts for delete using (is_sales_or_admin());
do $$ begin alter publication supabase_realtime add table customer_contacts; exception when others then null; end $$;

-- every customer name used on an order becomes a customer record (no duplicates, case/space-insensitive)
create or replace function sync_customers_from_orders() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with ins as (
    insert into sales_customers (name)
    select distinct on (lower(btrim(o.customer_name))) btrim(o.customer_name)
      from orders o
     where nullif(btrim(o.customer_name), '') is not null
       and not exists (select 1 from sales_customers c where lower(btrim(c.name)) = lower(btrim(o.customer_name)))
    returning 1)
  select count(*) into n from ins;
  return n;
end $$;
grant execute on function sync_customers_from_orders() to authenticated;

create or replace function trg_order_customer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if nullif(btrim(new.customer_name), '') is not null
     and not exists (select 1 from sales_customers c where lower(btrim(c.name)) = lower(btrim(new.customer_name))) then
    insert into sales_customers (name) values (btrim(new.customer_name));
  end if;
  return new;
end $$;
drop trigger if exists orders_customer_sync on orders;
create trigger orders_customer_sync after insert or update of customer_name on orders
  for each row execute function trg_order_customer();
select sync_customers_from_orders();

-- ---------- invoices: HSN / GST ----------
alter table invoices add column if not exists gst_type text;            -- null/'none' | 'intra' (CGST+SGST) | 'inter' (IGST)
alter table invoices add column if not exists taxable_value numeric;    -- amount before GST
alter table invoices add column if not exists gst_amount numeric default 0;
alter table invoices add column if not exists customer_gstin text;
alter table invoices add column if not exists place_of_supply text;
-- items jsonb now also carries hsn_code and gst_rate per line; `amount` stays the total payable (incl. GST)

-- ---------- order value: the invoice (before GST) wins when it is larger than the agreed value ----------
create or replace function commission_order_value(p_order uuid, p_value numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select greatest(coalesce(p_value, 0),
                  coalesce((select sum(coalesce(taxable_value, amount)) from invoices where linked_order_id = p_order), 0))
$$;

create or replace function sales_order_tracking() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare out jsonb; fin boolean := is_finance_admin();
begin
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.order_date desc nulls last, t.order_number desc), '[]'::jsonb) into out from (
    select o.id as order_id, o.order_number, o.customer_name, o.order_date, o.due_date, o.status,
           l.lead_number, os.lead_id, os.salesperson_id, e.name as salesperson_name,
           commission_order_value(o.id, os.order_value) as order_value,
           os.order_value as agreed_value,
           coalesce((select sum(nullif(i->>'quantity','')::numeric) from jsonb_array_elements(coalesce(o.items,'[]'::jsonb)) i), 0) as ordered_qty,
           coalesce((select sum(quantity) from order_deliveries d where d.order_id = o.id), 0) as delivered_qty,
           case when fin then (select coalesce(sum(amount),0) from invoices v where v.linked_order_id = o.id) end as invoiced,
           case when fin then (select coalesce(sum(coalesce(taxable_value, amount)),0) from invoices v where v.linked_order_id = o.id) end as invoiced_before_gst,
           case when fin then (select coalesce(sum(amount),0) from order_payments p where p.order_id = o.id) end as received,
           case
             when (select coalesce(sum(amount),0) from invoices v where v.linked_order_id = o.id) = 0 then 'Not invoiced'
             when (select coalesce(sum(amount),0) from order_payments p where p.order_id = o.id) >= (select coalesce(sum(amount),0) from invoices v where v.linked_order_id = o.id) then 'Paid'
             when (select coalesce(sum(amount),0) from order_payments p where p.order_id = o.id) > 0 then 'Part paid'
             else 'Invoiced' end as invoice_state,
           (select status from sales_commissions c where c.order_id = o.id) as commission_status,
           (select amount from sales_commissions c where c.order_id = o.id) as commission_amount
      from order_sales os
      join orders o on o.id = os.order_id
      left join sales_leads l on l.id = os.lead_id
      left join employees e on e.id = os.salesperson_id
     where is_sales_finance_viewer() or os.salesperson_id = my_employee_id()
  ) t;
  return out;
end $$;
grant execute on function sales_order_tracking() to authenticated;

-- ---------- commission: the 5,00,000 target is for the whole financial year (Apr-Mar) ----------
update commission_settings set period = 'year', updated_at = now() where id = 1 and period = 'month';
alter table commission_settings alter column period set default 'year';
select refresh_all_commissions();

-- ---------- vendors fill themselves from purchase requests ----------
alter table vendors add column if not exists source text;

create or replace function sync_vendor_from_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare vn text := nullif(btrim(coalesce(new.vendor, '')), '');
begin
  if vn is not null and not exists (select 1 from vendors v where lower(btrim(v.name)) = lower(vn)) then
    insert into vendors (name, supplier_type, source, created_by)
    values (vn, case new.category when 'Machine' then 'Machines' when 'Fabric' then 'Fabric'
                  when 'Spare Parts' then 'Spare Parts' when 'Accessories' then 'Accessories' else 'Other' end,
            'purchase_request', new.requested_by);
  end if;
  return new;
end $$;
drop trigger if exists purchase_request_vendor_sync on purchase_requests;
create trigger purchase_request_vendor_sync after insert or update of vendor on purchase_requests
  for each row execute function sync_vendor_from_request();

-- backfill from existing requests
insert into vendors (name, supplier_type, source)
select distinct on (lower(btrim(r.vendor))) btrim(r.vendor),
       case r.category when 'Machine' then 'Machines' when 'Fabric' then 'Fabric' when 'Spare Parts' then 'Spare Parts' when 'Accessories' then 'Accessories' else 'Other' end,
       'purchase_request'
  from purchase_requests r
 where nullif(btrim(coalesce(r.vendor,'')), '') is not null
   and not exists (select 1 from vendors v where lower(btrim(v.name)) = lower(btrim(r.vendor)));
