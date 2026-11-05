-- migration_60.sql — v70: Earned leave is 4 days per QUARTER (not 16 a year). Run after migration_59.sql. Safe to run twice.
-- * Earned leave balance covers only the current quarter (Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec); it does not carry over.
--   A new quarter starts again at 4 (the "credit").
-- * Attendance bonus (worked out in Payroll, no table needed): a full quarter with no absent / leave / half-day / unmarked
--   day pays the 4 unused earned-leave days (4 × monthly salary ÷ 30) with the first month's salary of the next quarter.
-- Casual (7) and Sick (10) stay yearly.
alter table leave_entitlements add column if not exists period text not null default 'year';
alter table leave_entitlements drop constraint if exists leave_entitlements_period_check;
alter table leave_entitlements add constraint leave_entitlements_period_check check (period in ('year','quarter'));
update leave_entitlements set days_per_year = 4, period = 'quarter' where leave_type = 'Earned';

-- balance for one employee: yearly types for the year, earned leave for the current quarter only
create or replace function leave_balance(p_employee uuid, p_year int default null) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_year int := coalesce(p_year, extract(year from v_today)::int);
  v_qs date := date_trunc('quarter', v_today)::date;
  v_me uuid; out json;
begin
  select employee_id into v_me from profiles where id = auth.uid();
  if not (coalesce(is_admin(), false) or coalesce(v_me = p_employee, false) or exists (select 1 from employees e where e.id = p_employee and e.reporting_manager_id = v_me)) then
    raise exception 'Not allowed';
  end if;
  select coalesce(json_agg(json_build_object(
      'leave_type', e.leave_type, 'entitled', e.days_per_year, 'period', e.period,
      'used', coalesce(u.used, 0), 'pending', coalesce(u.pending, 0),
      'balance', e.days_per_year - coalesce(u.used, 0) - coalesce(u.pending, 0)) order by case e.leave_type when 'Casual' then 1 when 'Earned' then 2 else 3 end), '[]'::json)
  into out
  from leave_entitlements e
  left join lateral (
    select sum(r.days) filter (where r.status = 'Approved') used, sum(r.days) filter (where r.status = 'Pending') pending
    from leave_requests r
    where r.employee_id = p_employee and r.leave_type = e.leave_type
      and case when e.period = 'quarter' then r.start_date >= v_qs and r.start_date < (v_qs + interval '3 months')::date
               else extract(year from r.start_date) = v_year end) u on true;
  return out;
end $$;
grant execute on function leave_balance(uuid, int) to authenticated;

-- every request: type required, Sundays excluded, within the balance; earned leave must stay inside one quarter
create or replace function leave_request_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ent numeric; v_per text; v_used numeric; v_year int := extract(year from new.start_date)::int; v_qs date; v_qe date;
begin
  if new.end_date < new.start_date then raise exception 'The end date is before the start date'; end if;
  if new.leave_type is null then raise exception 'Choose the leave type'; end if;
  new.days := leave_working_days(new.start_date, new.end_date);
  if new.days <= 0 then raise exception 'These dates are only Sundays; no leave is needed'; end if;
  if extract(year from new.end_date)::int <> v_year then raise exception 'Please raise separate requests for each year'; end if;
  if new.leave_type <> 'Unpaid' and (tg_op = 'INSERT' or (new.status = 'Pending' and (old.status is distinct from 'Pending' or old.leave_type is distinct from new.leave_type or old.start_date <> new.start_date or old.end_date <> new.end_date))) then
    select days_per_year, period into v_ent, v_per from leave_entitlements where leave_type = new.leave_type;
    if v_per = 'quarter' then
      v_qs := date_trunc('quarter', new.start_date)::date; v_qe := (v_qs + interval '3 months')::date;
      if new.end_date >= v_qe then raise exception 'Earned leave is given per quarter: please raise a separate request for each quarter'; end if;
      select coalesce(sum(days), 0) into v_used from leave_requests
        where employee_id = new.employee_id and leave_type = new.leave_type and status in ('Approved','Pending')
          and start_date >= v_qs and start_date < v_qe and (tg_op = 'INSERT' or id <> new.id);
    else
      select coalesce(sum(days), 0) into v_used from leave_requests
        where employee_id = new.employee_id and leave_type = new.leave_type and status in ('Approved','Pending')
          and extract(year from start_date) = v_year and (tg_op = 'INSERT' or id <> new.id);
    end if;
    if v_used + new.days > coalesce(v_ent, 0) then
      raise exception 'Only % day(s) of % leave left % (% requested)', greatest(0, coalesce(v_ent, 0) - v_used), new.leave_type, case when v_per = 'quarter' then 'this quarter' else 'this year' end, new.days;
    end if;
  end if;
  return new;
end $$;
