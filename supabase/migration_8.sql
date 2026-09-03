-- Migration 8 — run this in Supabase SQL Editor on your EXISTING project
-- (Dashboard -> SQL Editor -> New query -> paste all of this -> Run)
--
-- Adds an optional link from an expenditure (e.g. fabric bought for a
-- specific order) to that order. When set, Finance -> Order Profitability
-- automatically totals those linked expenditures into that order's raw
-- material cost — no manual entry needed for that order.

alter table expenditures add column if not exists linked_order_id uuid references orders(id) on delete set null;
