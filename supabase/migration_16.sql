-- Migration 16 — run this in Supabase SQL Editor on your EXISTING project
-- (Dashboard -> SQL Editor -> New query -> paste all of this -> Run)
--
-- Adds operation-count-based rate estimation, matching how garment
-- factories actually plan: each style has a number of operations (an
-- assembly line splits these across operators), and daily output per
-- person is estimated from operation count, an assumed time per operation,
-- and a line efficiency percentage. You can always override the resulting
-- number directly once you have real observed output data.

alter table garment_rates add column if not exists operations integer;
alter table settings add column if not exists avg_seconds_per_operation numeric default 30;
alter table settings add column if not exists line_efficiency_pct numeric default 50;
