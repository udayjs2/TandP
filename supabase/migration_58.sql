-- migration_58.sql — v67: "Leave without pay" request type. Run after migration_57.sql. Safe to run twice.
-- Salary is monthly ÷ 30 per day; leave from the balance is not deducted, leave without pay is.
alter table leave_requests drop constraint if exists leave_requests_type_check;
alter table leave_requests add constraint leave_requests_type_check check (leave_type in ('Casual','Earned','Sick','Unpaid'));

create or replace function leave_request_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ent numeric; v_used numeric; v_year int := extract(year from new.start_date)::int;
begin
  if new.end_date < new.start_date then raise exception 'The end date is before the start date'; end if;
  if new.leave_type is null then raise exception 'Choose the leave type'; end if;
  new.days := leave_working_days(new.start_date, new.end_date);
  if new.days <= 0 then raise exception 'These dates are only Sundays; no leave is needed'; end if;
  if extract(year from new.end_date)::int <> v_year then raise exception 'Please raise separate requests for each year'; end if;
  -- leave without pay has no balance to check
  if new.leave_type <> 'Unpaid' and (tg_op = 'INSERT' or (new.status = 'Pending' and (old.status is distinct from 'Pending' or old.leave_type is distinct from new.leave_type or old.start_date <> new.start_date or old.end_date <> new.end_date))) then
    select days_per_year into v_ent from leave_entitlements where leave_type = new.leave_type;
    select coalesce(sum(days), 0) into v_used from leave_requests
      where employee_id = new.employee_id and leave_type = new.leave_type and status in ('Approved','Pending')
        and extract(year from start_date) = v_year and (tg_op = 'INSERT' or id <> new.id);
    if v_used + new.days > coalesce(v_ent, 0) then
      raise exception 'Only % day(s) of % leave left this year (% requested)', greatest(0, coalesce(v_ent, 0) - v_used), new.leave_type, new.days;
    end if;
  end if;
  return new;
end $$;

-- approved leave -> Attendance ("Leave", or "Unpaid Leave" for leave without pay), never on Sundays
create or replace function sync_leave_to_attendance()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_st text;
begin
  if new.status = 'Approved' and old.status is distinct from 'Approved' then
    v_st := case when new.leave_type = 'Unpaid' then 'Unpaid Leave' else 'Leave' end;
    insert into attendance (employee_id, date, status)
    select new.employee_id, d::date, v_st
    from generate_series(new.start_date, new.end_date, interval '1 day') d
    where extract(dow from d) <> 0
    on conflict (employee_id, date) do update set status = v_st
      where attendance.check_in is null;      -- never overwrite a real punch
  elsif old.status = 'Approved' and new.status is distinct from 'Approved' then
    delete from attendance
    where employee_id = new.employee_id and date between new.start_date and new.end_date
      and status in ('Leave','Unpaid Leave') and check_in is null;
  end if;
  return new;
end;
$$;
