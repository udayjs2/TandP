-- v37: new login type "Finance" (Finance & Accounts access). Run after migration_40.sql. Safe to re-run.

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin','user','hr','gm','pm','tl','cutting_master','sales','quality_manager','finance'));

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
  check (intended_role in ('admin','user','hr','gm','pm','tl','cutting_master','sales','quality_manager','finance'));

-- Admin and Finance: invoices, investors, investments, loans, payments, order costing, actual cost
create or replace function is_finance_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('admin','finance'))
$$;

-- tables that were guarded by is_admin() (admin + hr): let Finance in as well
drop policy if exists "expenditures_finance_role" on expenditures;
create policy "expenditures_finance_role" on expenditures for all using (my_role() = 'finance') with check (my_role() = 'finance');
drop policy if exists "advances_finance_role" on employee_advances;
create policy "advances_finance_role" on employee_advances for all using (my_role() = 'finance') with check (my_role() = 'finance');
drop policy if exists "claims_finance_select" on expense_claims;
create policy "claims_finance_select" on expense_claims for select using (my_role() = 'finance');

-- the commission RULES stay with the Admin only (paying commission is allowed for Finance)
create or replace function set_commission_settings(p_threshold numeric, p_rate numeric, p_period text, p_basis text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if my_role() <> 'admin' then return jsonb_build_object('ok', false, 'error', 'Only the admin can change commission rules.'); end if;
  if p_threshold is null or p_threshold < 0 or p_rate is null or p_rate < 0 or p_rate > 100 then
    return jsonb_build_object('ok', false, 'error', 'Check the threshold and rate.');
  end if;
  update commission_settings set threshold = p_threshold, rate_pct = p_rate, period = p_period, basis = p_basis, updated_at = now() where id = 1;
  delete from sales_commissions where status = 'Pending';
  perform refresh_all_commissions();
  return jsonb_build_object('ok', true);
end $$;
grant execute on function set_commission_settings(numeric, numeric, text, text) to authenticated;

-- investor names for the "Funded by" pickers (non-admin users cannot read the investors table directly)
create or replace function investor_names()
returns table (id uuid, name text) language sql security definer set search_path = public stable as $$
  select i.id, i.name from investors i
  where is_gm_pm_or_admin() or my_role() = 'finance' order by i.name;
$$;
grant execute on function investor_names() to authenticated;
