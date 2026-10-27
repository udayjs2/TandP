-- migration_53.sql — v60: damaged pieces (during cutting / during stitching). Run after migration_52.sql. Safe to run twice.
create table if not exists cutting_damage (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  item_description text not null,
  damage_date date not null,
  stage text not null check (stage in ('Cutting','Stitching')),
  sizes jsonb not null default '{}',          -- damaged pieces per size
  total integer not null default 0,
  note text,
  logged_by text,
  logged_by_role text,
  created_at timestamptz default now()
);
create index if not exists cutting_damage_order_idx on cutting_damage(order_id, damage_date);
alter table cutting_damage enable row level security;
drop policy if exists "cd_select" on cutting_damage;
create policy "cd_select" on cutting_damage for select using (auth.role() = 'authenticated');
-- no direct writes: everything goes through the functions below

-- Production Manager / Team Lead / GM / Admin (and the Cutting Master or a Cutter for "Cutting") record damage.
create or replace function log_damage(p_order uuid, p_item text, p_date date, p_stage text, p_sizes jsonb, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_role text; v_name text; k text; v numeric; v_total integer := 0; v_clean jsonb := '{}'::jsonb;
begin
  select role, name into v_role, v_name from profiles where id = auth.uid();
  if v_role is null then return json_build_object('ok', false, 'error', 'Not signed in'); end if;
  if p_stage not in ('Cutting','Stitching') then return json_build_object('ok', false, 'error', 'Choose damaged during cutting or during stitching'); end if;
  if not (is_tl_or_above() or (p_stage = 'Cutting' and v_role in ('cutting_master','cutting'))) then
    return json_build_object('ok', false, 'error', 'Only the Production Manager, a Team Lead, the General Manager or an Admin can record damaged pieces');
  end if;
  if not exists (select 1 from orders where id = p_order) then return json_build_object('ok', false, 'error', 'Order not found'); end if;
  if coalesce(trim(p_item), '') = '' then return json_build_object('ok', false, 'error', 'Choose the order item'); end if;
  if p_date is null or p_date > (now() at time zone 'Asia/Kolkata')::date then return json_build_object('ok', false, 'error', 'Choose today or an earlier date'); end if;
  for k, v in select key, nullif(value, '')::numeric from jsonb_each_text(coalesce(p_sizes, '{}'::jsonb)) loop
    if coalesce(v, 0) <= 0 then continue; end if;
    if v <> trunc(v) then return json_build_object('ok', false, 'error', 'Size ' || k || ': pieces must be a whole number'); end if;
    v_clean := v_clean || jsonb_build_object(k, v::integer);
    v_total := v_total + v::integer;
  end loop;
  if v_total <= 0 then return json_build_object('ok', false, 'error', 'Enter the damaged pieces for at least one size'); end if;
  insert into cutting_damage (order_id, item_description, damage_date, stage, sizes, total, note, logged_by, logged_by_role)
  values (p_order, trim(p_item), p_date, p_stage, v_clean, v_total, nullif(trim(coalesce(p_note, '')), ''), v_name, v_role);
  return json_build_object('ok', true, 'total', v_total);
end $$;
grant execute on function log_damage(uuid, text, date, text, jsonb, text) to authenticated;

-- Remove a mistaken entry: PM / GM / Admin, or the person who logged it.
create or replace function delete_damage(p_id uuid) returns json
language plpgsql security definer set search_path = public as $$
declare d cutting_damage%rowtype; v_name text;
begin
  select * into d from cutting_damage where id = p_id;
  if not found then return json_build_object('ok', false, 'error', 'Entry not found'); end if;
  select name into v_name from profiles where id = auth.uid();
  if not (is_gm_pm_or_admin() or d.logged_by = v_name) then return json_build_object('ok', false, 'error', 'Not allowed'); end if;
  delete from cutting_damage where id = p_id;
  return json_build_object('ok', true);
end $$;
grant execute on function delete_damage(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='cutting_damage') then
    alter publication supabase_realtime add table cutting_damage;
  end if;
end $$;
