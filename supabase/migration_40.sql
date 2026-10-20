-- v36: CRM & Sales — Lead -> Customer -> Order -> Commission.
-- Run after migration_39.sql. Safe to re-run.

-- ---------------------------------------------------------------- helpers
create or replace function my_employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select employee_id from profiles where id = auth.uid()
$$;

-- admin / hr / gm / pm : see every lead
create or replace function is_sales_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('admin','hr','gm','pm'))
$$;

-- admin / gm / pm : see every order value and commission (HR has no financial access)
create or replace function is_sales_finance_viewer() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('admin','gm','pm'))
$$;

-- ---------------------------------------------------------------- leads
create sequence if not exists lead_seq start 1;

create table if not exists sales_leads (
  id uuid primary key default gen_random_uuid(),
  lead_number text unique default ('LD-' || lpad(nextval('lead_seq')::text, 4, '0')),
  company_name text not null,
  lead_type text not null default 'Other',          -- School, Hospital, Company, Retailer, Other
  contact_person text,
  designation text,
  phone text,
  email text,
  address text,
  salesperson_id uuid references employees(id) on delete set null,
  lead_source text,
  first_visit_date date,
  estimated_value numeric not null default 0,
  quotation_value numeric not null default 0,
  expected_order_date date,
  status text not null default 'New',
  lost_reason text,
  customer_id uuid references sales_customers(id) on delete set null,
  next_followup_date date,
  last_activity_at timestamptz,
  notes text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);
alter table sales_leads drop constraint if exists sales_leads_status_check;
alter table sales_leads add constraint sales_leads_status_check
  check (status in ('New','Contacted','Interested','Quotation Sent','Won','Lost'));
create index if not exists sales_leads_salesperson_idx on sales_leads (salesperson_id);

create table if not exists lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references sales_leads(id) on delete cascade,
  kind text not null default 'Visit',                -- Visit, Call, WhatsApp, Email, Meeting, Quotation, Note
  activity_date date not null default ((now() at time zone 'Asia/Kolkata')::date),
  location text,
  contact_person text,
  requirements text,
  notes text,
  quotation_value numeric,
  customer_response text,
  expected_order_date date,
  next_followup_date date,
  logged_by text,
  created_at timestamptz default now()
);
alter table lead_activities drop constraint if exists lead_activities_kind_check;
alter table lead_activities add constraint lead_activities_kind_check
  check (kind in ('Visit','Call','WhatsApp','Email','Meeting','Quotation','Note'));
create index if not exists lead_activities_lead_idx on lead_activities (lead_id, activity_date desc);

-- a new activity keeps the lead's follow-up date / quotation / status up to date
create or replace function lead_activity_roll_up() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update sales_leads l set
    last_activity_at = now(),
    next_followup_date = case when new.kind = 'Note' then l.next_followup_date else new.next_followup_date end,
    quotation_value = coalesce(new.quotation_value, l.quotation_value),
    expected_order_date = coalesce(new.expected_order_date, l.expected_order_date),
    first_visit_date = coalesce(l.first_visit_date, case when new.kind = 'Visit' then new.activity_date end),
    status = case
      when l.status in ('Won','Lost') then l.status
      when new.kind = 'Quotation' or new.quotation_value is not null then 'Quotation Sent'
      when l.status = 'New' and new.kind <> 'Note' then 'Contacted'
      else l.status end
  where l.id = new.lead_id;
  return null;
end $$;
drop trigger if exists lead_activity_roll_up_trg on lead_activities;
create trigger lead_activity_roll_up_trg after insert on lead_activities
  for each row execute function lead_activity_roll_up();

alter table sales_leads enable row level security;
alter table lead_activities enable row level security;

drop policy if exists "leads_select" on sales_leads;
drop policy if exists "leads_insert" on sales_leads;
drop policy if exists "leads_update" on sales_leads;
drop policy if exists "leads_delete" on sales_leads;
create policy "leads_select" on sales_leads for select using (is_sales_manager() or salesperson_id = my_employee_id() or created_by = auth.uid());
create policy "leads_insert" on sales_leads for insert with check (is_sales_manager() or salesperson_id = my_employee_id());
create policy "leads_update" on sales_leads for update using (is_sales_manager() or salesperson_id = my_employee_id())
  with check (is_sales_manager() or salesperson_id = my_employee_id());
create policy "leads_delete" on sales_leads for delete using (is_sales_manager());

drop policy if exists "lead_act_select" on lead_activities;
drop policy if exists "lead_act_insert" on lead_activities;
drop policy if exists "lead_act_delete" on lead_activities;
create policy "lead_act_select" on lead_activities for select using (
  exists (select 1 from sales_leads l where l.id = lead_id and (is_sales_manager() or l.salesperson_id = my_employee_id())));
create policy "lead_act_insert" on lead_activities for insert with check (
  exists (select 1 from sales_leads l where l.id = lead_id and (is_sales_manager() or l.salesperson_id = my_employee_id())));
create policy "lead_act_delete" on lead_activities for delete using (is_sales_manager());

-- ---------------------------------------------------------------- order <-> salesperson link
-- Kept apart from `orders` (readable by all staff) so order values stay private.
create table if not exists order_sales (
  order_id uuid primary key references orders(id) on delete cascade,
  lead_id uuid references sales_leads(id) on delete set null,
  customer_id uuid references sales_customers(id) on delete set null,
  salesperson_id uuid references employees(id) on delete set null,
  order_value numeric not null default 0,
  created_at timestamptz default now()
);
create index if not exists order_sales_sp_idx on order_sales (salesperson_id);
create index if not exists order_sales_lead_idx on order_sales (lead_id);
alter table order_sales enable row level security;
drop policy if exists "order_sales_select" on order_sales;
create policy "order_sales_select" on order_sales for select using (
  is_sales_finance_viewer() or salesperson_id = my_employee_id());
-- no write policies: written only through convert_lead_to_order() / set_order_sales()

-- ---------------------------------------------------------------- commission
create table if not exists commission_settings (
  id int primary key default 1 check (id = 1),
  threshold numeric not null default 500000,
  rate_pct numeric not null default 1,
  period text not null default 'month',      -- month | quarter | year | all
  basis text not null default 'completed',   -- completed (executed orders only) | confirmed (every confirmed order)
  updated_at timestamptz default now()
);
insert into commission_settings (id) values (1) on conflict do nothing;
alter table commission_settings drop constraint if exists commission_settings_period_check;
alter table commission_settings add constraint commission_settings_period_check check (period in ('month','quarter','year','all'));
alter table commission_settings drop constraint if exists commission_settings_basis_check;
alter table commission_settings add constraint commission_settings_basis_check check (basis in ('completed','confirmed'));
alter table commission_settings enable row level security;
drop policy if exists "comm_settings_select" on commission_settings;
create policy "comm_settings_select" on commission_settings for select using (auth.role() = 'authenticated');

create table if not exists sales_commissions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid unique references orders(id) on delete set null,   -- one commission per order: no duplicate payment
  salesperson_id uuid references employees(id) on delete set null,
  period_key text not null,
  order_number text,
  customer_name text,
  order_value numeric not null default 0,
  rate_pct numeric not null default 1,
  amount numeric not null default 0,
  status text not null default 'Pending',
  approved_by text, approved_at timestamptz,
  paid_by text, paid_at timestamptz,
  note text,
  created_at timestamptz default now()
);
alter table sales_commissions drop constraint if exists sales_commissions_status_check;
alter table sales_commissions add constraint sales_commissions_status_check check (status in ('Pending','Approved','Paid'));
create index if not exists sales_commissions_sp_idx on sales_commissions (salesperson_id, period_key);
alter table sales_commissions enable row level security;
drop policy if exists "sales_comm_select" on sales_commissions;
create policy "sales_comm_select" on sales_commissions for select using (
  is_sales_finance_viewer() or salesperson_id = my_employee_id());

-- paid commission posts to Finance -> Expenditures (category Commission), once
alter table expenditures add column if not exists commission_id uuid references sales_commissions(id) on delete set null;
create unique index if not exists expenditures_commission_id_key on expenditures(commission_id) where commission_id is not null;

-- period bucket (Indian financial year: Apr-Mar)
create or replace function commission_period_key(d date, per text) returns text
language sql immutable as $$
  select case per
    when 'month' then to_char(d, 'YYYY-MM')
    when 'quarter' then 'FY' || (case when extract(month from d) >= 4 then extract(year from d) else extract(year from d) - 1 end)::int
         || '-Q' || (case when extract(month from d) between 4 and 6 then 1 when extract(month from d) between 7 and 9 then 2
                          when extract(month from d) between 10 and 12 then 3 else 4 end)
    when 'year' then 'FY' || (case when extract(month from d) >= 4 then extract(year from d) else extract(year from d) - 1 end)::int
    else 'all' end
$$;

-- Order value used for commission: the agreed order value, else what has been invoiced for it.
create or replace function commission_order_value(p_order uuid, p_value numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(p_value, 0), (select sum(amount) from invoices where linked_order_id = p_order), 0)
$$;

-- Recalculate one salesperson's commission rows.
--   * the salesperson's orders in a period are COMBINED (3 x 2 lakh = 6 lakh);
--   * the period total must EXCEED the threshold (5,00,000);
--   * then every order in that period earns rate% (1% of 6 lakh = 6,000).
-- Approved / Paid rows are never changed or removed.
create or replace function refresh_commissions_for(p_sp uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s commission_settings%rowtype;
begin
  if p_sp is null then return; end if;
  select * into s from commission_settings where id = 1;

  create temp table if not exists _comm_elig (order_id uuid, period_key text, val numeric, order_number text, customer_name text) on commit drop;
  delete from _comm_elig where true;
  insert into _comm_elig
  select o.id, commission_period_key(coalesce(o.order_date, (o.created_at at time zone 'Asia/Kolkata')::date), s.period),
         commission_order_value(o.id, os.order_value), o.order_number, o.customer_name
  from order_sales os join orders o on o.id = os.order_id
  where os.salesperson_id = p_sp
    and (s.basis = 'confirmed' or o.status in ('Completed','Shipped'));

  -- pending rows that no longer qualify
  delete from sales_commissions c
   where c.salesperson_id = p_sp and c.status = 'Pending'
     and (c.order_id is null or not exists (
            select 1 from _comm_elig e
             where e.order_id = c.order_id and e.val > 0
               and (select sum(val) from _comm_elig x where x.period_key = e.period_key) > s.threshold));

  insert into sales_commissions (order_id, salesperson_id, period_key, order_number, customer_name, order_value, rate_pct, amount)
  select e.order_id, p_sp, e.period_key, e.order_number, e.customer_name, e.val, s.rate_pct, round(e.val * s.rate_pct / 100, 2)
    from _comm_elig e
   where e.val > 0 and (select sum(val) from _comm_elig x where x.period_key = e.period_key) > s.threshold
  on conflict (order_id) do update
     set period_key = excluded.period_key, order_number = excluded.order_number, customer_name = excluded.customer_name,
         order_value = excluded.order_value, rate_pct = excluded.rate_pct, amount = excluded.amount
   where sales_commissions.status = 'Pending' and sales_commissions.salesperson_id = p_sp;
end $$;

create or replace function refresh_all_commissions() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select distinct salesperson_id from order_sales where salesperson_id is not null loop
    perform refresh_commissions_for(r.salesperson_id);
  end loop;
end $$;
grant execute on function refresh_all_commissions() to authenticated;

create or replace function trg_order_sales_refresh() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') then perform refresh_commissions_for(old.salesperson_id); end if;
  if tg_op in ('INSERT','UPDATE') then perform refresh_commissions_for(new.salesperson_id); end if;
  return null;
end $$;
drop trigger if exists order_sales_refresh on order_sales;
create trigger order_sales_refresh after insert or update or delete on order_sales
  for each row execute function trg_order_sales_refresh();

create or replace function trg_order_status_commission() returns trigger
language plpgsql security definer set search_path = public as $$
declare sp uuid;
begin
  select salesperson_id into sp from order_sales where order_id = new.id;
  if sp is not null then perform refresh_commissions_for(sp); end if;
  return null;
end $$;
drop trigger if exists order_status_commission on orders;
create trigger order_status_commission after update of status, order_date on orders
  for each row execute function trg_order_status_commission();

-- settings (admin only); changing them re-prices pending commissions
create or replace function set_commission_settings(p_threshold numeric, p_rate numeric, p_period text, p_basis text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_finance_admin() then return jsonb_build_object('ok', false, 'error', 'Only the admin can change commission rules.'); end if;
  if p_threshold is null or p_threshold < 0 or p_rate is null or p_rate < 0 or p_rate > 100 then
    return jsonb_build_object('ok', false, 'error', 'Check the threshold and rate.');
  end if;
  update commission_settings set threshold = p_threshold, rate_pct = p_rate, period = p_period, basis = p_basis, updated_at = now() where id = 1;
  -- pending rows are rebuilt under the new rule; approved / paid rows stay as they were
  delete from sales_commissions where status = 'Pending';
  perform refresh_all_commissions();
  return jsonb_build_object('ok', true);
end $$;
grant execute on function set_commission_settings(numeric, numeric, text, text) to authenticated;

-- approve / pay / reopen commission rows (admin only). Paid rows are final.
create or replace function commission_set_status(p_ids uuid[], p_status text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; who text; paid_on date := (now() at time zone 'Asia/Kolkata')::date; sp_name text;
begin
  if not is_finance_admin() then return jsonb_build_object('ok', false, 'error', 'Only the admin can approve or pay commission.'); end if;
  if p_status not in ('Pending','Approved','Paid') then return jsonb_build_object('ok', false, 'error', 'Unknown status.'); end if;
  select name into who from profiles where id = auth.uid();
  for r in select * from sales_commissions where id = any(p_ids) for update loop
    if r.status = 'Paid' then continue; end if;                       -- never pay twice / never undo a payment
    if p_status = 'Paid' and r.status <> 'Approved' then continue; end if;   -- must be approved first
    if p_status = 'Approved' and r.status <> 'Pending' then continue; end if;
    if p_status = 'Pending' and r.status <> 'Approved' then continue; end if;
    if p_status = 'Approved' then
      update sales_commissions set status = 'Approved', approved_by = who, approved_at = now(), note = coalesce(p_note, note) where id = r.id;
    elsif p_status = 'Paid' then
      update sales_commissions set status = 'Paid', paid_by = who, paid_at = now(), note = coalesce(p_note, note) where id = r.id;
      select name into sp_name from employees where id = r.salesperson_id;
      insert into expenditures (category, item, vendor, amount, expense_date, notes, linked_order_id, commission_id, created_by)
      values ('Commission', 'Sales commission ' || coalesce(r.order_number, '') || ' - ' || coalesce(sp_name, 'salesperson'),
              sp_name, r.amount, paid_on, 'Auto-posted when commission was marked paid (' || r.period_key || ')', r.order_id, r.id, auth.uid())
      on conflict (commission_id) where commission_id is not null do nothing;
    else
      update sales_commissions set status = 'Pending', approved_by = null, approved_at = null where id = r.id;
    end if;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'count', n);
end $$;
grant execute on function commission_set_status(uuid[], text, text) to authenticated;

-- threshold progress: one row per salesperson per period
create or replace function commission_progress() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s commission_settings%rowtype; out jsonb;
begin
  select * into s from commission_settings where id = 1;
  if not (is_sales_finance_viewer() or my_employee_id() is not null) then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.period_key desc, t.salesperson_name), '[]'::jsonb) into out from (
    select os.salesperson_id,
           (select name from employees where id = os.salesperson_id) as salesperson_name,
           commission_period_key(coalesce(o.order_date, (o.created_at at time zone 'Asia/Kolkata')::date), s.period) as period_key,
           count(*) as orders,
           sum(commission_order_value(o.id, os.order_value)) as confirmed_value,
           sum(case when o.status in ('Completed','Shipped') then commission_order_value(o.id, os.order_value) else 0 end) as executed_value,
           sum(case when s.basis = 'confirmed' or o.status in ('Completed','Shipped') then commission_order_value(o.id, os.order_value) else 0 end) as counted_value,
           s.threshold, s.rate_pct, s.period, s.basis
      from order_sales os join orders o on o.id = os.order_id
     where os.salesperson_id is not null
       and (is_sales_finance_viewer() or os.salesperson_id = my_employee_id())
     group by os.salesperson_id, 3, s.threshold, s.rate_pct, s.period, s.basis
  ) t;
  return out;
end $$;
grant execute on function commission_progress() to authenticated;

-- ---------------------------------------------------------------- link an order to a salesperson / lead
create or replace function set_order_sales(p_order uuid, p_salesperson uuid, p_value numeric, p_lead uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not (is_pm_or_admin() or exists (select 1 from profiles where id = auth.uid() and role = 'gm')) then
    return jsonb_build_object('ok', false, 'error', 'Only Admin, HR, GM or PM can link an order to a salesperson.');
  end if;
  if p_salesperson is null and coalesce(p_value, 0) = 0 and p_lead is null then
    delete from order_sales where order_id = p_order;
    return jsonb_build_object('ok', true);
  end if;
  insert into order_sales (order_id, salesperson_id, order_value, lead_id, customer_id)
  values (p_order, p_salesperson, coalesce(p_value, 0), p_lead, (select customer_id from sales_leads where id = p_lead))
  on conflict (order_id) do update
     set salesperson_id = excluded.salesperson_id, order_value = excluded.order_value,
         lead_id = coalesce(excluded.lead_id, order_sales.lead_id),
         customer_id = coalesce(excluded.customer_id, order_sales.customer_id);
  return jsonb_build_object('ok', true);
end $$;
grant execute on function set_order_sales(uuid, uuid, numeric, uuid) to authenticated;

-- ---------------------------------------------------------------- convert a lead into customer + order
create or replace function convert_lead_to_order(p_lead uuid, p_items jsonb, p_order_value numeric, p_due_date date, p_order_number text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l sales_leads%rowtype; cid uuid; oid uuid; onum text; n int; today date := (now() at time zone 'Asia/Kolkata')::date; who text;
begin
  select * into l from sales_leads where id = p_lead for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Lead not found.'); end if;
  if not (is_sales_manager() or l.salesperson_id = my_employee_id()) then
    return jsonb_build_object('ok', false, 'error', 'You can only convert your own leads.');
  end if;
  if l.status = 'Lost' then return jsonb_build_object('ok', false, 'error', 'This lead is marked Lost. Re-open it first.'); end if;
  if l.salesperson_id is null then return jsonb_build_object('ok', false, 'error', 'Assign a salesperson to the lead first, so the order and commission are linked to someone.'); end if;
  if coalesce(p_order_value, 0) <= 0 then return jsonb_build_object('ok', false, 'error', 'Enter the order value.'); end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Add at least one item to the order.');
  end if;

  cid := l.customer_id;
  if cid is null then
    insert into sales_customers (name, location, contact_person, contact_number, notes, created_by)
    values (l.company_name, l.address, l.contact_person, l.phone, 'Converted from lead ' || l.lead_number, auth.uid())
    returning id into cid;
  end if;

  if p_order_number is not null and length(trim(p_order_number)) > 0 then
    onum := trim(p_order_number);
    if exists (select 1 from orders where order_number = onum) then return jsonb_build_object('ok', false, 'error', 'Order number ' || onum || ' already exists.'); end if;
  else
    select count(*) + 1 into n from orders;
    loop
      onum := 'ORD-' || lpad(n::text, 4, '0');
      exit when not exists (select 1 from orders where order_number = onum);
      n := n + 1;
    end loop;
  end if;

  insert into orders (order_number, customer_name, items, order_date, due_date, status)
  values (onum, l.company_name, p_items, today, p_due_date, 'Not Started')
  returning id into oid;

  insert into order_sales (order_id, lead_id, customer_id, salesperson_id, order_value)
  values (oid, l.id, cid, l.salesperson_id, p_order_value);

  update sales_leads set status = 'Won', customer_id = cid, lost_reason = null, next_followup_date = null where id = l.id;
  select name into who from profiles where id = auth.uid();
  insert into lead_activities (lead_id, kind, activity_date, notes, quotation_value, logged_by)
  values (l.id, 'Note', today, 'Order confirmed: ' || onum || ' for ' || p_order_value::text, null, who);
  return jsonb_build_object('ok', true, 'order_id', oid, 'order_number', onum, 'customer_id', cid);
end $$;
grant execute on function convert_lead_to_order(uuid, jsonb, numeric, date, text) to authenticated;

-- ---------------------------------------------------------------- order tracking for the CRM
-- Confirmation -> production -> delivery -> invoice -> payment. Amounts only for the admin.
create or replace function sales_order_tracking() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare out jsonb; fin boolean := is_finance_admin();
begin
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.order_date desc nulls last, t.order_number desc), '[]'::jsonb) into out from (
    select o.id as order_id, o.order_number, o.customer_name, o.order_date, o.due_date, o.status,
           l.lead_number, os.lead_id, os.salesperson_id, e.name as salesperson_name,
           commission_order_value(o.id, os.order_value) as order_value,
           coalesce((select sum(nullif(i->>'quantity','')::numeric) from jsonb_array_elements(coalesce(o.items,'[]'::jsonb)) i), 0) as ordered_qty,
           coalesce((select sum(quantity) from order_deliveries d where d.order_id = o.id), 0) as delivered_qty,
           case when fin then (select coalesce(sum(amount),0) from invoices v where v.linked_order_id = o.id) end as invoiced,
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

-- the actual-cost report counts commission paid on an order as an order expense automatically
-- (it is an order-linked expenditure), no extra change needed.

-- first run: price any existing links (none yet) — safe no-op
select refresh_all_commissions();

revoke execute on function refresh_commissions_for(uuid) from public, anon, authenticated;
