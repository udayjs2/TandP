-- migration_45.sql — v48: day-by-day stitching history per cutting entry. Run after migration_44.sql. Safe to run twice.
create table if not exists cutting_stitch_log (
  id uuid primary key default gen_random_uuid(),
  cutting_entry_id uuid not null references cutting_entries(id) on delete cascade,
  log_date date not null,
  sizes jsonb not null default '{}',      -- pieces stitched on THIS day, per size
  note text,
  logged_by text,
  created_at timestamptz default now()
);
create index if not exists cutting_stitch_log_entry_idx on cutting_stitch_log(cutting_entry_id, log_date);
alter table cutting_stitch_log enable row level security;
drop policy if exists "csl_select" on cutting_stitch_log;
create policy "csl_select" on cutting_stitch_log for select using (auth.role() = 'authenticated');
-- no direct writes: everything goes through the functions below

-- Totals shown on the cutting card (completed_sizes) are always the sum of the daily rows.
create or replace function recompute_stitched(p_entry uuid) returns void
language sql security definer set search_path = public as $$
  update cutting_entries set completed_sizes = coalesce((
    select jsonb_object_agg(k, t) from (
      select e.key k, sum(e.value::numeric) t
      from cutting_stitch_log l, jsonb_each_text(l.sizes) e
      where l.cutting_entry_id = p_entry group by e.key
    ) x), '{}'::jsonb)
  where id = p_entry;
$$;

-- Add one day's stitching. Can be called again on later days; the totals keep adding up.
create or replace function log_stitching(p_entry uuid, p_date date, p_sizes jsonb, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare e cutting_entries%rowtype; k text; v numeric; cur numeric; v_name text; v_clean jsonb := '{}'::jsonb;
begin
  if not is_gm_pm_or_admin() then
    return json_build_object('ok', false, 'error', 'Only the Production Manager, General Manager or Admin can log stitching');
  end if;
  select * into e from cutting_entries where id = p_entry for update;
  if not found then return json_build_object('ok', false, 'error', 'Cutting entry not found'); end if;
  if e.status <> 'Approved' then return json_build_object('ok', false, 'error', 'Stitching can only be logged on an approved cutting entry'); end if;
  if p_date is null or p_date > (now() at time zone 'Asia/Kolkata')::date then
    return json_build_object('ok', false, 'error', 'Choose today or an earlier date');
  end if;
  for k, v in select key, nullif(value, '')::numeric from jsonb_each_text(coalesce(p_sizes, '{}'::jsonb)) loop
    if coalesce(v, 0) <= 0 then continue; end if;
    if not (e.sizes ? k) then return json_build_object('ok', false, 'error', 'Size ' || k || ' is not part of this cutting entry'); end if;
    cur := coalesce(nullif(e.completed_sizes->>k, '')::numeric, 0);
    if cur + v > (e.sizes->>k)::numeric then
      return json_build_object('ok', false, 'error', 'Size ' || k || ': ' || (cur + v) || ' stitched would exceed the ' || (e.sizes->>k) || ' cut');
    end if;
    v_clean := v_clean || jsonb_build_object(k, v);
  end loop;
  if v_clean = '{}'::jsonb then return json_build_object('ok', false, 'error', 'Enter the pieces stitched for at least one size'); end if;
  select name into v_name from profiles where id = auth.uid();
  insert into cutting_stitch_log (cutting_entry_id, log_date, sizes, note, logged_by)
  values (p_entry, p_date, v_clean, nullif(trim(coalesce(p_note, '')), ''), v_name);
  perform recompute_stitched(p_entry);
  return json_build_object('ok', true);
end $$;
grant execute on function log_stitching(uuid, date, jsonb, text) to authenticated;

-- Remove a mistaken daily row; the totals are recalculated.
create or replace function delete_stitch_log(p_id uuid) returns json
language plpgsql security definer set search_path = public as $$
declare v_entry uuid;
begin
  if not is_gm_pm_or_admin() then return json_build_object('ok', false, 'error', 'Not allowed'); end if;
  select cutting_entry_id into v_entry from cutting_stitch_log where id = p_id;
  if v_entry is null then return json_build_object('ok', false, 'error', 'Row not found'); end if;
  delete from cutting_stitch_log where id = p_id;
  perform recompute_stitched(v_entry);
  return json_build_object('ok', true);
end $$;
grant execute on function delete_stitch_log(uuid) to authenticated;

-- Keep what was already logged: one opening row per entry that has totals but no history yet.
insert into cutting_stitch_log (cutting_entry_id, log_date, sizes, note, logged_by)
select c.id, coalesce(c.reviewed_at::date, c.cut_date),
       (select jsonb_object_agg(x.key, x.value::numeric) from jsonb_each_text(c.completed_sizes) x where coalesce(nullif(x.value,'')::numeric,0) > 0),
       'Total logged before daily history was added', 'System'
from cutting_entries c
where c.completed_sizes <> '{}'::jsonb
  and exists (select 1 from jsonb_each_text(c.completed_sizes) x where coalesce(nullif(x.value,'')::numeric,0) > 0)
  and not exists (select 1 from cutting_stitch_log l where l.cutting_entry_id = c.id);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='cutting_stitch_log') then
    alter publication supabase_realtime add table cutting_stitch_log;
  end if;
end $$;
