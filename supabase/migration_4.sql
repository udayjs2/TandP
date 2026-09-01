-- Migration 4 — run this in Supabase SQL Editor on your EXISTING project
-- (Dashboard -> SQL Editor -> New query -> paste all of this -> Run)
--
-- Adds: planned start/end dates on orders, a fuller status pipeline (adds
-- "Not Started" and "Ironing"), partial-delivery tracking (delivered vs
-- pending items), and a public order-tracking lookup customers can use
-- without logging in.

-- 1. Orders: planned dates + a short tracking code customers use to look up status
alter table orders add column if not exists planned_start_date date;
alter table orders add column if not exists planned_end_date date;
alter table orders add column if not exists tracking_code text default substr(md5(random()::text || clock_timestamp()::text), 1, 6);

-- rename the old default status label so it reads clearly as "not yet started"
update orders set status = 'Not Started' where status = 'Pending';

-- 2. Delivery log (partial deliveries — e.g. shipping some items now, rest later)
create table if not exists order_deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  date date not null,
  item_description text not null,
  quantity numeric not null default 0,
  delivered_to text,
  notes text,
  updated_by text,
  created_at timestamptz default now()
);

alter table order_deliveries enable row level security;
create policy "order_deliveries_select" on order_deliveries for select using (auth.role() = 'authenticated');
create policy "order_deliveries_admin_write" on order_deliveries for insert with check (is_admin());
create policy "order_deliveries_admin_update" on order_deliveries for update using (is_admin());
create policy "order_deliveries_admin_delete" on order_deliveries for delete using (is_admin());

alter publication supabase_realtime add table order_deliveries;

-- 3. Public order-status lookup (no login required).
-- A customer needs BOTH the exact order number AND its tracking code to see
-- anything — this function only ever returns one order's summary, never a list.
create or replace function public_order_status(p_order_number text, p_tracking_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  result json;
begin
  select json_build_object(
    'order_number', o.order_number,
    'customer_name', o.customer_name,
    'status', o.status,
    'order_date', o.order_date,
    'planned_start_date', o.planned_start_date,
    'planned_end_date', o.planned_end_date,
    'due_date', o.due_date,
    'items', (
      select coalesce(json_agg(json_build_object(
        'description', item->>'description',
        'required', (item->>'quantity')::numeric,
        'completed', coalesce((
          select sum(quantity) from order_progress
          where order_id = o.id and item_description = item->>'description'
        ), 0),
        'delivered', coalesce((
          select sum(quantity) from order_deliveries
          where order_id = o.id and item_description = item->>'description'
        ), 0)
      )), '[]'::json)
      from jsonb_array_elements(o.items) as item
    )
  ) into result
  from orders o
  where o.order_number = p_order_number and o.tracking_code = p_tracking_code;

  return result;
end;
$$;

grant execute on function public_order_status(text, text) to anon, authenticated;
