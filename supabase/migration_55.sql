-- migration_55.sql — v64: leave types + yearly balances, Sundays no longer counted as leave.
-- Run after migration_54.sql. Safe to run twice.

-- ---------- yearly entitlements (edit the numbers here if the policy changes) ----------
create table if not exists leave_entitlements (
  leave_type text primary key check (leave_type in ('Casual','Earned','Sick')),
  days_per_year numeric not null
);
insert into leave_entitlements (leave_type, days_per_year) values ('Casual', 7), ('Earned', 16), ('Sick', 10)
on conflict (leave_type) do nothing;
alter table leave_entitlements enable row level security;
drop policy if exists "leave_ent_select" on leave_entitlements;
create policy "leave_ent_select" on leave_entitlements for select using (auth.role() = 'authenticated');
drop policy if exists "leave_ent_admin" on leave_entitlements;
create policy "leave_ent_admin" on leave_entitlements for update using (is_admin());

alter table leave_requests add column if not exists leave_type text;
alter table leave_requests add column if not exists days numeric;
update leave_requests set leave_type = 'Casual' where leave_type is null;
alter table leave_requests alter column leave_type set default 'Casual';
alter table leave_requests drop constraint if exists leave_requests_type_check;
alter table leave_requests add constraint leave_requests_type_check check (leave_type in ('Casual','Earned','Sick'));

-- days between two dates, Sundays excluded (a Sunday is never a leave day)
create or replace function leave_working_days(p_from date, p_to date) returns numeric
language sql immutable as $$
  select count(*)::numeric from generate_series(p_from, p_to, interval '1 day') d where extract(dow from d) <> 0;
$$;
update leave_requests set days = leave_working_days(start_date, end_date) where days is null;

-- balance for one employee in one calendar year
create or replace function leave_balance(p_employee uuid, p_year int default null) returns json
language plpgsql stable security definer set search_path = public as $$
declare v_year int := coalesce(p_year, extract(year from (now() at time zone 'Asia/Kolkata'))::int); v_me uuid; out json;
begin
  select employee_id into v_me from profiles where id = auth.uid();
  if not (coalesce(is_admin(), false) or coalesce(v_me = p_employee, false) or exists (select 1 from employees e where e.id = p_employee and e.reporting_manager_id = v_me)) then
    raise exception 'Not allowed';
  end if;
  select coalesce(json_agg(json_build_object(
      'leave_type', e.leave_type, 'entitled', e.days_per_year,
      'used', coalesce(u.used, 0), 'pending', coalesce(u.pending, 0),
      'balance', e.days_per_year - coalesce(u.used, 0) - coalesce(u.pending, 0)) order by case e.leave_type when 'Casual' then 1 when 'Earned' then 2 else 3 end), '[]'::json)
  into out
  from leave_entitlements e
  left join (
    select leave_type, sum(days) filter (where status = 'Approved') used, sum(days) filter (where status = 'Pending') pending
    from leave_requests where employee_id = p_employee and extract(year from start_date) = v_year group by leave_type) u on u.leave_type = e.leave_type;
  return out;
end $$;
grant execute on function leave_balance(uuid, int) to authenticated;

-- every request: type required, Sundays excluded from the day count, and not more than the balance left
create or replace function leave_request_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ent numeric; v_used numeric; v_year int := extract(year from new.start_date)::int;
begin
  if new.end_date < new.start_date then raise exception 'The end date is before the start date'; end if;
  if new.leave_type is null then raise exception 'Choose the leave type'; end if;
  new.days := leave_working_days(new.start_date, new.end_date);
  if new.days <= 0 then raise exception 'These dates are only Sundays; no leave is needed'; end if;
  if extract(year from new.end_date)::int <> v_year then raise exception 'Please raise separate requests for each year'; end if;
  if tg_op = 'INSERT' or (new.status = 'Pending' and (old.status is distinct from 'Pending' or old.leave_type is distinct from new.leave_type or old.start_date <> new.start_date or old.end_date <> new.end_date)) then
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
drop trigger if exists leave_request_check_trg on leave_requests;
create trigger leave_request_check_trg before insert or update on leave_requests
  for each row execute function leave_request_check();

-- approved leave -> Attendance "Leave", never on Sundays
create or replace function sync_leave_to_attendance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'Approved' and old.status is distinct from 'Approved' then
    insert into attendance (employee_id, date, status)
    select new.employee_id, d::date, 'Leave'
    from generate_series(new.start_date, new.end_date, interval '1 day') d
    where extract(dow from d) <> 0
    on conflict (employee_id, date) do update set status = 'Leave'
      where attendance.check_in is null;      -- never overwrite a real punch
  elsif old.status = 'Approved' and new.status is distinct from 'Approved' then
    delete from attendance
    where employee_id = new.employee_id and date between new.start_date and new.end_date
      and status = 'Leave' and check_in is null;
  end if;
  return new;
end;
$$;

-- clean up: "Leave" rows that were written on Sundays
delete from attendance where status = 'Leave' and check_in is null and extract(dow from date) = 0;
