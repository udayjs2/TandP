-- v31: leave approvals for GM / PM / TL / HR, no self-approval, and auto-link of
-- manager logins to their employee record (needed for self check-in / check-out).
-- Run after migration_34.sql. Safe to re-run.

create or replace function my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

-- Who can SEE and DECIDE a leave request:
--   admin / hr  : everyone
--   gm / pm     : everyone except their own request
--   tl          : people who report to them (employees.reporting_manager_id)
--   anyone      : their own request (to view / cancel while Pending)
drop policy if exists "leave_requests_select" on leave_requests;
create policy "leave_requests_select" on leave_requests for select using (
  is_admin()
  or my_role() in ('gm','pm')
  or employee_id = (select employee_id from profiles where id = auth.uid())
  or exists (
    select 1 from employees e
    where e.id = leave_requests.employee_id
      and e.reporting_manager_id = (select employee_id from profiles where id = auth.uid())
  )
);

drop policy if exists "leave_requests_update" on leave_requests;
create policy "leave_requests_update" on leave_requests for update using (
  is_admin()
  or (my_role() in ('gm','pm') and employee_id is distinct from (select employee_id from profiles where id = auth.uid()))
  or exists (
    select 1 from employees e
    where e.id = leave_requests.employee_id
      and e.reporting_manager_id = (select employee_id from profiles where id = auth.uid())
  )
  or (
    employee_id = (select employee_id from profiles where id = auth.uid())
    and status = 'Pending'
  )
);

-- Nobody approves or rejects their own leave (only the owner/admin login can, as the final authority).
create or replace function block_self_leave_review() returns trigger
language plpgsql security definer set search_path = public as $$
declare my_emp uuid; r text;
begin
  if new.status is distinct from old.status and new.status in ('Approved','Rejected') then
    select employee_id, role into my_emp, r from profiles where id = auth.uid();
    if my_emp is not null and my_emp = new.employee_id and coalesce(r,'') <> 'admin' then
      raise exception 'You cannot approve or reject your own leave request. Ask your manager, GM or Admin.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists leave_block_self_review on leave_requests;
create trigger leave_block_self_review before update on leave_requests
  for each row execute function block_self_leave_review();

-- Link GM / PM / TL / HR logins to an employee record when the name matches exactly
-- (one employee, not already linked to another login). Lets them use My Attendance
-- check-in / check-out and raise leave. Anything not matched is listed in the notice.
do $$
declare p record; n int; emp uuid;
begin
  for p in select id, name from profiles
           where role in ('gm','pm','tl','hr') and employee_id is null loop
    select count(*) into n from employees e
      where lower(trim(e.name)) = lower(trim(p.name))
        and not exists (select 1 from profiles x where x.employee_id = e.id);
    if n = 1 then
      select e.id into emp from employees e
        where lower(trim(e.name)) = lower(trim(p.name))
          and not exists (select 1 from profiles x where x.employee_id = e.id);
      update profiles set employee_id = emp where id = p.id;
      raise notice 'Linked login "%" to its employee record', p.name;
    else
      raise notice 'NOT linked (no unique name match): "%". Link it in Payroll -> account column.', p.name;
    end if;
  end loop;
end $$;
