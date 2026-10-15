-- v33: choose which investor funds a salary. Run after migration_36.sql. Safe to re-run.
alter table payroll add column if not exists investor_id uuid references investors(id) on delete set null;

create or replace function sync_payroll_expenditure() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  emp_name text;
  paid_on date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if new.status = 'Paid' and coalesce(new.net_pay, 0) > 0 then
    select name into emp_name from employees where id = new.employee_id;
    if tg_op = 'UPDATE' and old.status = 'Paid' and exists (select 1 from expenditures where payroll_id = new.id) then
      update expenditures set amount = new.net_pay, investor_id = new.investor_id,
             item = 'Salary ' || new.month || ' - ' || coalesce(emp_name, 'employee')
       where payroll_id = new.id;
    else
      insert into expenditures (category, item, vendor, amount, expense_date, notes, payroll_id, investor_id, created_by)
      values ('Salary', 'Salary ' || new.month || ' - ' || coalesce(emp_name, 'employee'), emp_name, new.net_pay, paid_on,
              'Auto-posted from Payroll when marked paid', new.id, new.investor_id, auth.uid())
      on conflict (payroll_id) where payroll_id is not null
      do update set amount = excluded.amount, item = excluded.item, investor_id = excluded.investor_id;
      update payroll set paid_at = now() where id = new.id and paid_at is null;
    end if;
  else
    delete from expenditures where payroll_id = new.id;
  end if;
  return null;
end $$;

-- Back-fill: salaries already posted before this update keep "no investor" until you pick one in Payroll.
