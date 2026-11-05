-- migration_61.sql — v71: casual leave is EARNED MONTH BY MONTH (7 a year = 7/12 ≈ 0.58 a month from the joining month),
-- earned leave can no longer be applied for (it is paid as the attendance bonus), sick leave is capped at 2 days a month.
-- Run after migration_60.sql. Safe to run twice.
alter table leave_entitlements drop constraint if exists leave_entitlements_period_check;
alter table leave_entitlements add constraint leave_entitlements_period_check check (period in ('year','quarter','accrual'));
update leave_entitlements set period = 'accrual', days_per_year = 7 where leave_type = 'Casual';

-- casual leave earned so far in a year: 7/12 per month from the joining month (or January) up to this month
create or replace function leave_accrued(p_employee uuid, p_year int, p_per_year numeric default 7) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date; v_join date; v_from date; v_to date; v_months int;
begin
  select join_date into v_join from employees where id = p_employee;
  v_from := greatest(make_date(p_year, 1, 1), date_trunc('month', coalesce(v_join, make_date(p_year, 1, 1)))::date);
  v_to := case when p_year < extract(year from v_today)::int then make_date(p_year, 12, 1)
               when p_year > extract(year from v_today)::int then make_date(p_year, 1, 1) - 1
               else date_trunc('month', v_today)::date end;
  if v_to < v_from then return 0; end if;
  v_months := (extract(year from v_to)::int - extract(year from v_from)::int) * 12 + extract(month from v_to)::int - extract(month from v_from)::int + 1;
  return round(p_per_year * v_months / 12.0, 2);
end $$;
grant execute on function leave_accrued(uuid, int, numeric) to authenticated;

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
      'leave_type', e.leave_type, 'period', e.period, 'yearly', e.days_per_year,
      'entitled', case when e.period = 'accrual' then leave_accrued(p_employee, v_year, e.days_per_year) else e.days_per_year end,
      'applicable', e.leave_type <> 'Earned',
      'used', coalesce(u.used, 0), 'pending', coalesce(u.pending, 0),
      'balance', greatest(0, (case when e.period = 'accrual' then leave_accrued(p_employee, v_year, e.days_per_year) else e.days_per_year end) - coalesce(u.used, 0) - coalesce(u.pending, 0))
    ) order by case e.leave_type when 'Casual' then 1 when 'Earned' then 2 else 3 end), '[]'::json)
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

create or replace function leave_request_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ent numeric; v_per text; v_used numeric; v_year int := extract(year from new.start_date)::int; v_ms date; v_me date;
begin
  if new.end_date < new.start_date then raise exception 'The end date is before the start date'; end if;
  if new.leave_type is null then raise exception 'Choose the leave type'; end if;
  if tg_op = 'INSERT' and new.leave_type = 'Earned' then
    raise exception 'Earned leave cannot be applied for: it is paid as an attendance bonus when there is no leave or absence in a quarter';
  end if;
  new.days := leave_working_days(new.start_date, new.end_date);
  if new.days <= 0 then raise exception 'These dates are only Sundays; no leave is needed'; end if;
  if extract(year from new.end_date)::int <> v_year then raise exception 'Please raise separate requests for each year'; end if;
  if new.leave_type <> 'Unpaid' and new.leave_type <> 'Earned' and (tg_op = 'INSERT' or (new.status = 'Pending' and (old.status is distinct from 'Pending' or old.leave_type is distinct from new.leave_type or old.start_date <> new.start_date or old.end_date <> new.end_date))) then
    select days_per_year, period into v_ent, v_per from leave_entitlements where leave_type = new.leave_type;
    if new.leave_type = 'Sick' then   -- at most 2 sick days in a month
      v_ms := date_trunc('month', new.start_date)::date; v_me := (v_ms + interval '1 month')::date;
      if new.end_date >= v_me then raise exception 'Sick leave: please raise a separate request for each month'; end if;
      select coalesce(sum(days), 0) into v_used from leave_requests
        where employee_id = new.employee_id and leave_type = 'Sick' and status in ('Approved','Pending')
          and start_date >= v_ms and start_date < v_me and (tg_op = 'INSERT' or id <> new.id);
      if v_used + new.days > 2 then
        raise exception 'Sick leave is limited to 2 days a month (% already taken or pending this month, % requested)', v_used, new.days;
      end if;
    end if;
    if v_per = 'accrual' then v_ent := leave_accrued(new.employee_id, v_year, v_ent); end if;
    select coalesce(sum(days), 0) into v_used from leave_requests
      where employee_id = new.employee_id and leave_type = new.leave_type and status in ('Approved','Pending')
        and extract(year from start_date) = v_year and (tg_op = 'INSERT' or id <> new.id);
    if v_used + new.days > coalesce(v_ent, 0) then
      raise exception 'Only % day(s) of % leave available (% requested)', greatest(0, coalesce(v_ent, 0) - v_used), new.leave_type, new.days;
    end if;
  end if;
  return new;
end $$;
