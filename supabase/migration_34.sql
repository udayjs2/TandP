-- v30: paid salaries post to Finance -> Expenditures automatically (category "Salary").
-- Run after migration_33.sql. Safe to re-run.

alter table payroll add column if not exists net_pay numeric;
alter table payroll add column if not exists paid_at timestamptz;
alter table expenditures add column if not exists payroll_id uuid references payroll(id) on delete cascade;
create unique index if not exists expenditures_payroll_id_key on expenditures(payroll_id) where payroll_id is not null;

create or replace function sync_payroll_expenditure() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  emp_name text;
  paid_on date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if new.status = 'Paid' and coalesce(new.net_pay, 0) > 0 then
    select name into emp_name from employees where id = new.employee_id;
    if tg_op = 'UPDATE' and old.status = 'Paid' and exists (select 1 from expenditures where payroll_id = new.id) then
      -- already posted: keep the original payment date, refresh the amount
      update expenditures set amount = new.net_pay,
             item = 'Salary ' || new.month || ' - ' || coalesce(emp_name, 'employee')
       where payroll_id = new.id;
    else
      insert into expenditures (category, item, vendor, amount, expense_date, notes, payroll_id, created_by)
      values ('Salary', 'Salary ' || new.month || ' - ' || coalesce(emp_name, 'employee'), emp_name, new.net_pay, paid_on,
              'Auto-posted from Payroll when marked paid', new.id, auth.uid())
      on conflict (payroll_id) where payroll_id is not null
      do update set amount = excluded.amount, item = excluded.item;
      update payroll set paid_at = now() where id = new.id and paid_at is null;
    end if;
  else
    -- back to Pending (or zero pay): withdraw the posted salary
    delete from expenditures where payroll_id = new.id;
  end if;
  return null;
end $$;

drop trigger if exists payroll_post_expenditure on payroll;
create trigger payroll_post_expenditure after insert or update on payroll
  for each row execute function sync_payroll_expenditure();
