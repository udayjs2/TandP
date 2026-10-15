-- v34: daily workforce per order, delay RCA gate, customer agreement link, customer feedback link.
-- Run after migration_37.sql. Safe to re-run.

-- ================= 1. Who worked on which order on a day =================
-- Combines Manpower assignments (Orders -> people icon) and the Operation log.
-- Labour cost = employee's daily wage (monthly base / days in month), split across the orders the
-- person worked on that day. Wages are only returned to Admin / HR; everyone else gets NULL.
create or replace function daily_order_workforce(p_date date)
returns table(order_id uuid, employee_id uuid, employee_name text, employee_role text, wage_share numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_admin boolean := is_admin();
begin
  if not (is_tl_or_above() or v_admin) then raise exception 'Not allowed'; end if;
  return query
  with pairs as (
    select l.order_id, l.employee_id from order_labor l where l.work_date = p_date
    union
    select o.order_id, o.employee_id from operation_output o
      where o.work_date = p_date and o.order_id is not null and o.employee_id is not null
  ), cnt as (select pairs.employee_id, count(*) as n from pairs group by pairs.employee_id)
  select p.order_id, p.employee_id, e.name, e.role,
         case when v_admin then round((coalesce(e.base_salary, 0)
              / extract(day from (date_trunc('month', p_date) + interval '1 month - 1 day'))) / c.n, 2)
              else null end
  from pairs p join employees e on e.id = p.employee_id join cnt c on c.employee_id = p.employee_id;
end $$;
grant execute on function daily_order_workforce(date) to authenticated;

-- ================= 2. Delay RCA + lessons learned =================
create table if not exists order_delay_rca (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id) on delete cascade,
  causes jsonb not null default '[]',      -- [{cause, days, notes}]
  root_cause text not null,
  lessons_learned text not null,
  corrective_action text,
  days_late integer,
  submitted_by uuid references profiles(id) on delete set null,
  submitted_by_name text,
  submitted_at timestamptz default now()
);
alter table order_delay_rca enable row level security;
drop policy if exists "rca_select" on order_delay_rca;
drop policy if exists "rca_insert" on order_delay_rca;
drop policy if exists "rca_update" on order_delay_rca;
drop policy if exists "rca_delete" on order_delay_rca;
create policy "rca_select" on order_delay_rca for select using (is_admin() or is_tl_or_above() or my_role() = 'quality_manager');
create policy "rca_insert" on order_delay_rca for insert with check (is_admin() or my_role() in ('gm','pm','tl'));
create policy "rca_update" on order_delay_rca for update using (is_admin() or my_role() in ('gm','pm','tl'));
create policy "rca_delete" on order_delay_rca for delete using (is_admin());

-- An order past its due date cannot move to Completed / Shipped until the RCA is on file.
create or replace function block_late_completion_without_rca() returns trigger
language plpgsql security definer set search_path = public as $$
declare today_ist date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if new.status in ('Completed','Shipped') and old.status is distinct from new.status
     and old.status not in ('Completed','Shipped')
     and new.due_date is not null and new.due_date < today_ist
     and not exists (select 1 from order_delay_rca r where r.order_id = new.id) then
    raise exception 'This order is past its due date. Submit the delay RCA and lessons learned before completing it.';
  end if;
  return new;
end $$;
drop trigger if exists orders_require_rca on orders;
create trigger orders_require_rca before update on orders
  for each row execute function block_late_completion_without_rca();

-- ================= 3. Customer agreement (agree / disagree link) =================
alter table orders add column if not exists agreement_status text not null default 'Not sent';
alter table orders drop constraint if exists orders_agreement_status_check;
alter table orders add constraint orders_agreement_status_check check (agreement_status in ('Not sent','Sent','Agreed','Disagreed'));
alter table orders add column if not exists agreement_sent_at timestamptz;
alter table orders add column if not exists agreement_responded_at timestamptz;
alter table orders add column if not exists agreement_responder text;
alter table orders add column if not exists agreement_comment text;
alter table orders add column if not exists feedback_sent_at timestamptz;

create or replace function public_agreement(p_order_number text, p_tracking_code text)
returns json language plpgsql security definer set search_path = public as $$
declare o record; a record;
begin
  select * into o from orders where order_number = p_order_number and tracking_code = p_tracking_code;
  if not found then return null; end if;
  select * into a from order_agreements where order_id = o.id order by created_at desc limit 1;
  return json_build_object(
    'order_number', o.order_number, 'customer_name', o.customer_name, 'order_date', o.order_date,
    'due_date', o.due_date, 'agreement_status', o.agreement_status, 'responded_at', o.agreement_responded_at,
    'responder', o.agreement_responder,
    'items', (select coalesce(json_agg(json_build_object(
        'description', it->>'description', 'quantity', (it->>'quantity')::numeric,
        'rate', (select (r->>'rate')::numeric from jsonb_array_elements(coalesce(a.item_rates,'[]'::jsonb)) r where r->>'description' = it->>'description' limit 1)
      )), '[]'::json) from jsonb_array_elements(o.items) it),
    'terms', case when a.id is null then null else json_build_object(
        'gst_percent', a.gst_percent, 'advance_pct', a.advance_pct, 'before_dispatch_pct', a.before_dispatch_pct,
        'balance_pct', a.balance_pct, 'balance_days', a.balance_days, 'transportation', a.transportation,
        'unclaimed_goods_days', a.unclaimed_goods_days) end
  );
end $$;

create or replace function public_agreement_respond(p_order_number text, p_tracking_code text, p_decision text, p_name text, p_comment text)
returns json language plpgsql security definer set search_path = public as $$
declare o record;
begin
  select * into o from orders where order_number = p_order_number and tracking_code = p_tracking_code;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if p_decision not in ('Agreed','Disagreed') then return json_build_object('ok', false, 'error', 'bad_decision'); end if;
  if o.agreement_status <> 'Sent' then return json_build_object('ok', false, 'error', 'not_open', 'status', o.agreement_status); end if;
  if length(trim(coalesce(p_name,''))) < 2 then return json_build_object('ok', false, 'error', 'name_required'); end if;
  if p_decision = 'Disagreed' and length(trim(coalesce(p_comment,''))) < 3 then return json_build_object('ok', false, 'error', 'comment_required'); end if;
  update orders set agreement_status = p_decision, agreement_responded_at = now(),
         agreement_responder = left(trim(p_name), 120), agreement_comment = nullif(left(trim(coalesce(p_comment,'')), 1000), '')
   where id = o.id;
  return json_build_object('ok', true, 'status', p_decision);
end $$;
grant execute on function public_agreement(text, text) to anon, authenticated;
grant execute on function public_agreement_respond(text, text, text, text, text) to anon, authenticated;

-- ================= 4. Customer feedback =================
create table if not exists order_feedback (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id) on delete cascade,
  ratings jsonb not null default '{}',     -- {fabric_quality: 1-5, ...}
  delivery_timing text,                    -- On time / Slightly delayed / Very delayed
  would_reorder text,                      -- Yes / Maybe / No
  issues text,
  comments text,
  respondent_name text,
  submitted_at timestamptz default now()
);
alter table order_feedback enable row level security;
drop policy if exists "feedback_select" on order_feedback;
drop policy if exists "feedback_delete" on order_feedback;
create policy "feedback_select" on order_feedback for select using (is_admin() or is_tl_or_above() or my_role() = 'quality_manager');
create policy "feedback_delete" on order_feedback for delete using (is_admin());

create or replace function public_feedback_status(p_order_number text, p_tracking_code text)
returns json language plpgsql security definer set search_path = public as $$
declare o record;
begin
  select * into o from orders where order_number = p_order_number and tracking_code = p_tracking_code;
  if not found then return null; end if;
  return json_build_object('order_number', o.order_number, 'customer_name', o.customer_name, 'status', o.status,
    'open', o.status in ('Completed','Shipped'),
    'already_submitted', exists (select 1 from order_feedback f where f.order_id = o.id));
end $$;

create or replace function public_feedback_submit(p_order_number text, p_tracking_code text, p_payload jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare o record; k text; v numeric; r jsonb := '{}'::jsonb;
begin
  select * into o from orders where order_number = p_order_number and tracking_code = p_tracking_code;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if o.status not in ('Completed','Shipped') then return json_build_object('ok', false, 'error', 'not_open'); end if;
  if exists (select 1 from order_feedback where order_id = o.id) then return json_build_object('ok', false, 'error', 'already_submitted'); end if;
  for k in select jsonb_object_keys(coalesce(p_payload->'ratings','{}'::jsonb)) loop
    v := (p_payload->'ratings'->>k)::numeric;
    if v between 1 and 5 and k ~ '^[a-z_]{1,40}$' then r := r || jsonb_build_object(k, v); end if;
  end loop;
  if r = '{}'::jsonb then return json_build_object('ok', false, 'error', 'no_ratings'); end if;
  insert into order_feedback (order_id, ratings, delivery_timing, would_reorder, issues, comments, respondent_name)
  values (o.id, r, left(p_payload->>'delivery_timing', 40), left(p_payload->>'would_reorder', 20),
          nullif(left(p_payload->>'issues', 1500), ''), nullif(left(p_payload->>'comments', 1500), ''),
          nullif(left(p_payload->>'respondent_name', 120), ''));
  return json_build_object('ok', true);
end $$;
grant execute on function public_feedback_status(text, text) to anon, authenticated;
grant execute on function public_feedback_submit(text, text, jsonb) to anon, authenticated;

do $$ begin alter publication supabase_realtime add table order_delay_rca; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table order_feedback; exception when others then null; end $$;
