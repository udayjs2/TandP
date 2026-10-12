-- Migration 26 — run this in Supabase SQL Editor on your EXISTING project
-- (Dashboard -> SQL Editor -> New query -> paste all of this -> Run)
--
-- Part 2: the Cutting module. The Cutting Master logs how many of each
-- size were cut, for a given order + item, on a given day. The Production
-- Manager (or GM/admin/hr) then approves or rejects that count. Once
-- approved, completed/stitched counts per size are logged against it —
-- shown green when they match the cut count, red when they don't.

create table if not exists cutting_entries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  item_description text not null,
  cut_date date not null,
  sizes jsonb not null default '{}', -- { "S": 50, "M": 60, "L": 40, ... }
  completed_sizes jsonb not null default '{}', -- same shape, filled in as stitching finishes
  status text not null default 'Submitted' check (status in ('Submitted','Approved','Rejected')),
  submitted_by text,
  reviewed_by text,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz default now()
);

alter table cutting_entries enable row level security;

-- Anyone signed in can see cutting entries (production-floor visibility,
-- same level of openness as orders themselves).
create policy "cutting_entries_select" on cutting_entries for select using (auth.role() = 'authenticated');

-- Only the Cutting Master (or admin/hr) can submit new cutting counts.
create policy "cutting_entries_insert" on cutting_entries for insert with check (is_cutting_or_admin());

-- Approving/rejecting and logging completed-size counts both go through
-- UPDATE — restricted to GM/PM/admin/hr (not the Cutting Master, who
-- shouldn't be able to self-approve their own submission).
create policy "cutting_entries_update" on cutting_entries for update using (is_gm_pm_or_admin());

create policy "cutting_entries_delete" on cutting_entries for delete using (is_admin());

alter publication supabase_realtime add table cutting_entries;
