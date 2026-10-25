-- v58: Sales Manager login role. Run after migration_50.sql. Safe to re-run.
-- The Sales Manager runs the sales team: sees every lead, customer and sales order (with values and commission),
-- and can add/edit customers, visits, leads and vendors. Targets & expense approval stay with Admin / GM / PM.

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin','user','hr','gm','pm','tl','cutting_master','sales','quality_manager','finance','qc','ironing','sales_manager'));

create or replace function is_sales_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('admin','hr','gm','pm','sales_manager'))
$$;

create or replace function is_sales_finance_viewer() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('admin','gm','pm','sales_manager'))
$$;

create or replace function is_sales_or_admin()
returns boolean as $$
  select is_admin() or exists (select 1 from profiles where id = auth.uid() and role = 'sales_manager') or exists (
    select 1 from profiles p
    join employees e on e.id = p.employee_id
    where p.id = auth.uid() and e.role = 'Sales'
  );
$$ language sql security definer stable;

drop policy if exists "vendors_select" on vendors;
drop policy if exists "vendors_insert" on vendors;
drop policy if exists "vendors_update" on vendors;
create policy "vendors_select" on vendors for select using (is_admin() or my_role() in ('gm','pm','sales','sales_manager'));
create policy "vendors_insert" on vendors for insert with check (is_admin() or my_role() in ('gm','pm','sales','sales_manager'));
create policy "vendors_update" on vendors for update using (is_admin() or my_role() in ('gm','pm','sales','sales_manager'));
