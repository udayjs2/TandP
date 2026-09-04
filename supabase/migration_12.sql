-- Migration 12 — run this in Supabase SQL Editor on your EXISTING project
-- (Dashboard -> SQL Editor -> New query -> paste all of this -> Run)
--
-- Adds check-in/check-out time tracking to attendance, so late arrivals and
-- overtime can be calculated automatically against a 9 AM - 6 PM shift with
-- a 9-hour minimum for a full day. These times can be entered manually, or
-- bulk-imported from a CSV export of your biometric device's software.

alter table attendance add column if not exists check_in time;
alter table attendance add column if not exists check_out time;
