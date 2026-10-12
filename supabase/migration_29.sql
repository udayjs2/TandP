-- Migration 29 — run in Supabase SQL Editor AFTER migration_28.sql
--
-- 1. Attendance fix: self check-in/out times were stored with microseconds
--    (e.g. 09:20:33.482913), which the time field in the Attendance screen
--    could not display, so the row looked empty. Times are now stored to the
--    second, existing rows are trimmed, and `attendance` is added to the
--    realtime feed so the Attendance page refreshes by itself.
-- 2. Inventory module: machines, fabric, and threads/elastic/accessories.

-- ---------- 1. Attendance ----------
update attendance
set check_in  = date_trunc('second', check_in),
    check_out = date_trunc('second', check_out)
where check_in is not null or check_out is not null;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendance'
  ) then
    alter publication supabase_realtime add table attendance;
  end if;
end $$;

create or replace function self_check_in(p_lat numeric, p_lng numeric, p_location text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_now_ist time := date_trunc('second', (now() at time zone 'Asia/Kolkata')::time);
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

  insert into attendance (employee_id, date, status, check_in, check_in_lat, check_in_lng, check_in_distance_m, check_in_location, self_marked)
  values (v_employee_id, v_today, 'Present', v_now_ist, p_lat, p_lng, v_distance, p_location, true)
  on conflict (employee_id, date)
  do update set check_in = excluded.check_in, check_in_lat = excluded.check_in_lat,
                check_in_lng = excluded.check_in_lng, check_in_distance_m = excluded.check_in_distance_m,
                check_in_location = excluded.check_in_location, self_marked = true;

  return json_build_object('ok', true, 'distance_meters', v_distance);
end;
$$;

create or replace function self_check_out(p_lat numeric, p_lng numeric, p_location text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_now_ist time := date_trunc('second', (now() at time zone 'Asia/Kolkata')::time);
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
  v_hours := extract(epoch from (v_now_ist - v_existing.check_in)) / 3600.0;
  v_status := case when v_hours >= 9 then 'Present' else 'Half Day' end;

  update attendance
  set check_out = v_now_ist, check_out_lat = p_lat, check_out_lng = p_lng,
      check_out_distance_m = v_distance, check_out_location = p_location, status = v_status
  where employee_id = v_employee_id and date = v_today;

  return json_build_object('ok', true, 'distance_meters', v_distance, 'hours', v_hours, 'status', v_status);
end;
$$;

grant execute on function self_check_in(numeric, numeric, text) to authenticated;
grant execute on function self_check_out(numeric, numeric, text) to authenticated;

-- ---------- 2. Inventory ----------
create table if not exists inventory_machines (
  id uuid primary key default gen_random_uuid(),
  model text not null check (model in ('JUKI','ZOJE','JIN','JACK','KANSAI','OTHER')),
  model_other text,                 -- name when model = OTHER
  machine_type text not null,       -- free text, e.g. Single needle lockstitch
  quantity integer not null default 1,
  working_condition text not null default 'Working',
  purchase_date date,
  last_service_date date,
  notes text,
  created_at timestamptz default now()
);

create table if not exists inventory_fabric (
  id uuid primary key default gen_random_uuid(),
  fabric_type text not null,        -- e.g. Single jersey, Cotton poplin
  color text,
  weight_gsm numeric,               -- fabric weight (GSM)
  stock_kg numeric default 0,
  stock_meters numeric default 0,
  supplier text,
  notes text,
  created_at timestamptz default now()
);

create table if not exists inventory_items (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('Thread','Elastic','Accessory','Other')),
  name text not null,
  quantity numeric not null default 0,
  unit text default 'pcs',
  notes text,
  created_at timestamptz default now()
);

alter table inventory_machines enable row level security;
alter table inventory_fabric enable row level security;
alter table inventory_items enable row level security;

-- Everyone signed in can read; admin/HR/GM/PM can add, edit and delete.
drop policy if exists "inv_machines_select" on inventory_machines;
drop policy if exists "inv_machines_write" on inventory_machines;
drop policy if exists "inv_fabric_select" on inventory_fabric;
drop policy if exists "inv_fabric_write" on inventory_fabric;
drop policy if exists "inv_items_select" on inventory_items;
drop policy if exists "inv_items_write" on inventory_items;

create policy "inv_machines_select" on inventory_machines for select using (auth.role() = 'authenticated');
create policy "inv_machines_write" on inventory_machines for all using (is_gm_pm_or_admin()) with check (is_gm_pm_or_admin());
create policy "inv_fabric_select" on inventory_fabric for select using (auth.role() = 'authenticated');
create policy "inv_fabric_write" on inventory_fabric for all using (is_gm_pm_or_admin()) with check (is_gm_pm_or_admin());
create policy "inv_items_select" on inventory_items for select using (auth.role() = 'authenticated');
create policy "inv_items_write" on inventory_items for all using (is_gm_pm_or_admin()) with check (is_gm_pm_or_admin());

do $$
declare t text;
begin
  foreach t in array array['inventory_machines','inventory_fabric','inventory_items'] loop
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;
