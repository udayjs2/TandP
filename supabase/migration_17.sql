-- Migration 17 — run this in Supabase SQL Editor on your EXISTING project
-- (Dashboard -> SQL Editor -> New query -> paste all of this -> Run)
--
-- Adds phone-based self check-in/check-out: an employee (linked to their
-- login, same as Payroll self-view) taps "Check In" on their phone, the
-- browser captures their GPS location, and the app records the distance
-- from your factory. Outside-the-geofence check-ins are NOT blocked
-- (indoor GPS can be unreliable) — they're flagged instead, so you can see
-- and investigate rather than someone being stuck unable to clock in.

-- Attendance: where a self check-in/out happened, and how far from the
-- factory. Distance is stored, not a blocking pass/fail — you compare it
-- against your configured radius whenever you look at it.
alter table attendance add column if not exists check_in_lat numeric;
alter table attendance add column if not exists check_in_lng numeric;
alter table attendance add column if not exists check_in_distance_m numeric;
alter table attendance add column if not exists check_out_lat numeric;
alter table attendance add column if not exists check_out_lng numeric;
alter table attendance add column if not exists check_out_distance_m numeric;
alter table attendance add column if not exists self_marked boolean default false;

-- Factory location + how far (meters) counts as "at the factory"
alter table settings add column if not exists factory_lat numeric;
alter table settings add column if not exists factory_lng numeric;
alter table settings add column if not exists geofence_radius_meters numeric default 200;

-- Distance between two lat/lng points, in meters (standard haversine formula)
create or replace function haversine_meters(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
returns numeric
language sql
immutable
as $$
  select case
    when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
    else 6371000 * 2 * asin(sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
    ))
  end;
$$;

-- Self check-in: only ever touches the CALLING user's own linked employee
-- record, and only today's date — hard-coded inside the function, not
-- something a client payload could override.
create or replace function self_check_in(p_lat numeric, p_lng numeric)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_today date := current_date;
  v_existing record;
  v_factory_lat numeric;
  v_factory_lng numeric;
  v_distance numeric;
begin
  select employee_id into v_employee_id from profiles where id = auth.uid();
  if v_employee_id is null then
    return json_build_object('ok', false, 'error', 'not_linked_to_employee');
  end if;

  select * into v_existing from attendance where employee_id = v_employee_id and date = v_today;
  if v_existing.check_in is not null then
    return json_build_object('ok', false, 'error', 'already_checked_in');
  end if;

  select factory_lat, factory_lng into v_factory_lat, v_factory_lng from settings where id = 1;
  v_distance := haversine_meters(v_factory_lat, v_factory_lng, p_lat, p_lng);

  insert into attendance (employee_id, date, status, check_in, check_in_lat, check_in_lng, check_in_distance_m, self_marked)
  values (v_employee_id, v_today, 'Present', current_time, p_lat, p_lng, v_distance, true)
  on conflict (employee_id, date)
  do update set check_in = excluded.check_in, check_in_lat = excluded.check_in_lat,
                check_in_lng = excluded.check_in_lng, check_in_distance_m = excluded.check_in_distance_m,
                self_marked = true;

  return json_build_object('ok', true, 'distance_meters', v_distance);
end;
$$;

-- Self check-out: computes hours worked and status itself from the stored
-- check-in time — a client can't just claim a status.
create or replace function self_check_out(p_lat numeric, p_lng numeric)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_today date := current_date;
  v_existing record;
  v_factory_lat numeric;
  v_factory_lng numeric;
  v_distance numeric;
  v_hours numeric;
  v_status text;
begin
  select employee_id into v_employee_id from profiles where id = auth.uid();
  if v_employee_id is null then
    return json_build_object('ok', false, 'error', 'not_linked_to_employee');
  end if;

  select * into v_existing from attendance where employee_id = v_employee_id and date = v_today;
  if v_existing.check_in is null then
    return json_build_object('ok', false, 'error', 'not_checked_in_yet');
  end if;

  select factory_lat, factory_lng into v_factory_lat, v_factory_lng from settings where id = 1;
  v_distance := haversine_meters(v_factory_lat, v_factory_lng, p_lat, p_lng);
  v_hours := extract(epoch from (current_time - v_existing.check_in)) / 3600.0;
  v_status := case
    when v_hours >= 9 then 'Present'
    when v_hours >= 4.5 then 'Half Day'
    else 'Absent'
  end;

  update attendance
  set check_out = current_time, check_out_lat = p_lat, check_out_lng = p_lng,
      check_out_distance_m = v_distance, status = v_status
  where employee_id = v_employee_id and date = v_today;

  return json_build_object('ok', true, 'distance_meters', v_distance, 'hours', v_hours, 'status', v_status);
end;
$$;

grant execute on function self_check_in(numeric, numeric) to authenticated;
grant execute on function self_check_out(numeric, numeric) to authenticated;
