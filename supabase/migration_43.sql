-- v41: AI Factory Manager. Run after migration_42.sql. Safe to re-run.

-- Scheduled AI reports (written by the server with the service key; read in the app)
create table if not exists ai_reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                       -- morning | midday | evening | weekly | monthly
  title text not null,
  body text not null,
  data jsonb,                               -- structured daily report (evening run)
  audience text not null default 'managers' check (audience in ('managers','admin')),
  report_date date,
  created_at timestamptz default now()
);
alter table ai_reports enable row level security;
drop policy if exists "ai_reports_read" on ai_reports;
create policy "ai_reports_read" on ai_reports for select
  using (my_role() = 'admin' or (audience = 'managers' and my_role() in ('gm','pm')));
drop policy if exists "ai_reports_delete" on ai_reports;
create policy "ai_reports_delete" on ai_reports for delete using (my_role() = 'admin');

-- Numbers allowed to use the AI manager on WhatsApp (digits only, with country code, e.g. 919876543210)
create table if not exists ai_whatsapp_users (
  phone text primary key check (phone ~ '^[0-9]{8,15}$'),
  name text not null,
  role text not null default 'pm' check (role in ('admin','gm','pm')),
  receive_reports boolean not null default false,
  active boolean not null default true,
  created_at timestamptz default now()
);
alter table ai_whatsapp_users enable row level security;
drop policy if exists "ai_whatsapp_users_admin" on ai_whatsapp_users;
create policy "ai_whatsapp_users_admin" on ai_whatsapp_users for all using (my_role() = 'admin') with check (my_role() = 'admin');

create table if not exists ai_whatsapp_log (
  message_id text primary key,
  phone text,
  question text,
  answer text,
  created_at timestamptz default now()
);
alter table ai_whatsapp_log enable row level security;
drop policy if exists "ai_whatsapp_log_admin" on ai_whatsapp_log;
create policy "ai_whatsapp_log_admin" on ai_whatsapp_log for select using (my_role() = 'admin');

-- Versions of two existing functions without the signed-in-user check, callable ONLY with the service key
-- (used by scheduled reports and WhatsApp, where nobody is signed in).
create or replace function order_actual_cost_internal(p_order uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare fabric json; mats json; other json; crew json; stocked json;
        t_fabric numeric; t_mats numeric; t_other numeric; t_transport numeric; t_crew numeric; unpriced int;
begin

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
grant execute on function order_actual_cost_internal(uuid) to service_role;
revoke execute on function order_actual_cost_internal(uuid) from public, anon, authenticated;

create or replace function commission_progress_internal() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s commission_settings%rowtype; out jsonb;
begin
  select * into s from commission_settings where id = 1;
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
grant execute on function commission_progress_internal() to service_role;
revoke execute on function commission_progress_internal() from public, anon, authenticated;
