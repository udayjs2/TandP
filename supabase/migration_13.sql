-- Migration 13 — run this in Supabase SQL Editor on your EXISTING project
-- (Dashboard -> SQL Editor -> New query -> paste all of this -> Run)
--
-- Adds a narrow, purpose-built way for a small local sync script (running
-- on a PC on your factory's network, next to the ZKTeco device) to push
-- attendance punches into this app automatically — without ever handing
-- that script your full database credentials.
--
-- How it works: you generate a "device sync key" from the app (Attendance
-- tab, admin only). The local script sends that key with every punch it
-- uploads. The function below checks the key is valid and active, and if
-- so, is the ONLY thing it's allowed to do: upsert one attendance row. It
-- can't read or touch anything else in your database, unlike a full
-- service-role key would be able to.

create table if not exists device_sync_keys (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text,
  active boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz default now()
);

alter table device_sync_keys enable row level security;
create policy "device_sync_keys_admin_only" on device_sync_keys for all using (is_admin()) with check (is_admin());

-- The sync function itself: security definer so it can write to attendance
-- regardless of who's calling it (the local script has no logged-in user
-- session) — but it independently checks the key before doing anything.
create or replace function sync_attendance_punch(
  p_api_key text,
  p_employee_number text,
  p_date date,
  p_check_in time,
  p_check_out time
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_hours numeric;
  v_status text;
begin
  -- validate the key
  if not exists (select 1 from device_sync_keys where key = p_api_key and active = true) then
    return json_build_object('ok', false, 'error', 'invalid_or_inactive_key');
  end if;

  update device_sync_keys set last_used_at = now() where key = p_api_key;

  -- find the employee by their employee_number (must match what's set on
  -- the ZKTeco device / entered in the Employees tab)
  select id into v_employee_id from employees where employee_number = p_employee_number limit 1;
  if v_employee_id is null then
    return json_build_object('ok', false, 'error', 'employee_not_found', 'employee_number', p_employee_number);
  end if;

  -- compute hours worked and a suggested status (9am-6pm shift, 9hr min for
  -- a full day — same rule as the in-app attendance screen)
  if p_check_in is not null and p_check_out is not null then
    v_hours := extract(epoch from (p_check_out - p_check_in)) / 3600.0;
  else
    v_hours := null;
  end if;

  v_status := case
    when v_hours is null then 'Present'
    when v_hours >= 9 then 'Present'
    when v_hours >= 4.5 then 'Half Day'
    else 'Absent'
  end;

  insert into attendance (employee_id, date, status, check_in, check_out)
  values (v_employee_id, p_date, v_status, p_check_in, p_check_out)
  on conflict (employee_id, date)
  do update set check_in = excluded.check_in, check_out = excluded.check_out, status = excluded.status;

  return json_build_object('ok', true, 'employee_id', v_employee_id, 'status', v_status, 'hours', v_hours);
end;
$$;

-- The local script calls this using the anon key (no login), so the
-- function itself — not a table policy — is what gates access via p_api_key.
grant execute on function sync_attendance_punch(text, text, date, time, time) to anon, authenticated;

alter publication supabase_realtime add table device_sync_keys;
