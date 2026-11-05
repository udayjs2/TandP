-- migration_56.sql — v64: Measurements module (schools -> students -> garment sizes and measurements).
-- Run after migration_55.sql. Safe to run twice.
create or replace function can_measure() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid()
                 and role in ('admin','hr','gm','pm','tl','cutting_master','cutting','sales_manager','sales'));
$$;
create or replace function can_manage_measure() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid()
                 and role in ('admin','hr','gm','pm','cutting_master','sales_manager'));
$$;

-- the garments measured and the measurements taken for each (anyone who measures can add more)
create table if not exists measurement_items (
  name text primary key,
  fields text[] not null default '{}',
  sort_no int not null default 100,
  created_by text,
  created_at timestamptz default now()
);
insert into measurement_items (name, fields, sort_no) values
  ('Shirt',   array['Length','Shoulder','Chest'], 10),
  ('T-Shirt', array['Length','Shoulder','Chest'], 20),
  ('Pant',    array['Waist','Length'], 30),
  ('Short',   array['Waist','Length'], 40),
  ('Skirt',   array['Waist','Length'], 50),
  ('Coat',    array['Length','Shoulder','Chest','Sleeve'], 60)
on conflict (name) do nothing;

create table if not exists measurement_schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  place text,
  contact text,
  order_id uuid references orders(id) on delete set null,
  notes text,
  created_by text,
  created_at timestamptz default now()
);
create table if not exists measurement_students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references measurement_schools(id) on delete cascade,
  student_name text not null,
  class_name text,
  section text,
  roll_no text,
  gender text,
  notes text,
  created_by text,
  created_at timestamptz default now()
);
create index if not exists measurement_students_school_idx on measurement_students(school_id);
create table if not exists measurement_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references measurement_students(id) on delete cascade,
  item text not null,
  size text,                         -- the size label, e.g. 32 / M — what the lists are filtered and counted by
  m jsonb not null default '{}',     -- the measurements, e.g. {"Length": "24", "Chest": "30"}
  created_by text,
  updated_at timestamptz default now(),
  unique (student_id, item)
);
create index if not exists measurement_records_student_idx on measurement_records(student_id);

alter table measurement_items enable row level security;
alter table measurement_schools enable row level security;
alter table measurement_students enable row level security;
alter table measurement_records enable row level security;

do $$ declare t text; begin
  foreach t in array array['measurement_schools','measurement_students','measurement_records','measurement_items'] loop
    execute format('drop policy if exists "%1$s_select" on %1$s', t);
    execute format('drop policy if exists "%1$s_insert" on %1$s', t);
    execute format('drop policy if exists "%1$s_update" on %1$s', t);
    execute format('drop policy if exists "%1$s_delete" on %1$s', t);
    execute format('create policy "%1$s_select" on %1$s for select using (can_measure())', t);
    execute format('create policy "%1$s_insert" on %1$s for insert with check (can_measure())', t);
    execute format('create policy "%1$s_update" on %1$s for update using (can_measure())', t);
    execute format('create policy "%1$s_delete" on %1$s for delete using (can_manage_measure())', t);
  end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['measurement_schools','measurement_students','measurement_records','measurement_items'] loop
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;
