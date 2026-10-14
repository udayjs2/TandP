-- Migration 33 — run in Supabase SQL Editor AFTER migration_32.sql
--
-- Operation-wise output log. This is the data the "Why did output change?"
-- report needs to spot operation bottlenecks and uneven workloads: who did
-- which operation, on which order, and how many pieces.

create or replace function is_tl_or_above()
returns boolean as $$
  select is_gm_pm_or_admin() or exists (select 1 from profiles where id = auth.uid() and role = 'tl');
$$ language sql security definer stable;

create table if not exists operation_output (
  id uuid primary key default gen_random_uuid(),
  work_date date not null,
  order_id uuid references orders(id) on delete cascade,
  item_description text,
  operation text not null,                       -- e.g. Collar attach, Side seam, Hemming
  employee_id uuid references employees(id) on delete set null,
  quantity numeric not null default 0,
  logged_by text,
  created_at timestamptz default now()
);
create index if not exists operation_output_date_idx on operation_output (work_date);

alter table operation_output enable row level security;
drop policy if exists "op_out_select" on operation_output;
drop policy if exists "op_out_insert" on operation_output;
drop policy if exists "op_out_update" on operation_output;
drop policy if exists "op_out_delete" on operation_output;
create policy "op_out_select" on operation_output for select using (is_tl_or_above());
create policy "op_out_insert" on operation_output for insert with check (is_tl_or_above());
create policy "op_out_update" on operation_output for update using (is_tl_or_above());
create policy "op_out_delete" on operation_output for delete using (is_tl_or_above());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='operation_output') then
    alter publication supabase_realtime add table operation_output;
  end if;
end $$;
