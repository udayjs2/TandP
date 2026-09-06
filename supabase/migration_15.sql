-- Migration 15 — run this in Supabase SQL Editor on your EXISTING project
-- (Dashboard -> SQL Editor -> New query -> paste all of this -> Run)
--
-- Adds production planning: a rate table (pieces/day/person per garment
-- type, since a plain T-shirt and a pant with a back pocket take different
-- time), per-order assigned resources, and total factory workforce — used
-- together to project how many days an order will take and flag whether
-- it's on track to meet its due date.

-- Garment production rates (admin-maintained — you know your factory's
-- actual speeds, this app doesn't guess them for you)
create table if not exists garment_rates (
  id uuid primary key default gen_random_uuid(),
  garment_type text not null unique,
  pieces_per_day_per_person numeric not null default 0,
  notes text,
  created_at timestamptz default now()
);

alter table garment_rates enable row level security;
create policy "garment_rates_select" on garment_rates for select using (auth.role() = 'authenticated');
create policy "garment_rates_admin_write" on garment_rates for insert with check (is_admin());
create policy "garment_rates_admin_update" on garment_rates for update using (is_admin());
create policy "garment_rates_admin_delete" on garment_rates for delete using (is_admin());

alter publication supabase_realtime add table garment_rates;

-- How many people are currently assigned to work on this order (used for
-- day-count projections, separate from order_labor's historical log)
alter table orders add column if not exists planned_resources numeric default 0;

-- Total workforce available factory-wide, for a capacity sanity-check
-- across the whole pipeline
alter table settings add column if not exists total_workforce numeric default 0;
