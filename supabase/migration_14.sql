-- Migration 14 — run this in Supabase SQL Editor on your EXISTING project
-- (Dashboard -> SQL Editor -> New query -> paste all of this -> Run)
--
-- Adds an "advance received" field on invoices, deducted from the item
-- total to show a Balance Due on the printed invoice. Also fixes how
-- Finance counts revenue: it now counts the invoice's full (gross) amount
-- only — advance payments are a partial payment toward that same amount,
-- not additional revenue on top of it.

alter table invoices add column if not exists advance_received numeric default 0;
