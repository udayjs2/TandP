-- DIAGNOSTIC — run this in Supabase SQL Editor and paste me the full result.
-- This is READ-ONLY: it changes nothing, just reports what exists.
-- It will tell us exactly which migration(s) still need to be run.

select 'table' as kind, t as name,
  exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) as exists
from unnest(array[
  'profiles','employees','orders','order_progress','order_deliveries','invoices',
  'attendance','payroll','sales_targets','settings','expense_claims','investors',
  'investments','expenditures','order_finance','order_labor','role_invitations',
  'loans','loan_payments','order_payments','device_sync_keys','garment_rates',
  'offer_letters','sales_customers','customer_visits','customer_reminders'
]) as t

union all

select 'column', table_name || '.' || column_name,
  true
from information_schema.columns
where table_schema='public' and (
  (table_name='orders' and column_name in ('items','daily_target','planned_start_date','planned_end_date','tracking_code','planned_resources')) or
  (table_name='profiles' and column_name in ('employee_id','role')) or
  (table_name='expenditures' and column_name in ('linked_order_id','investor_id')) or
  (table_name='invoices' and column_name in ('items','linked_order_id','advance_received')) or
  (table_name='settings' and column_name in ('total_workforce','avg_seconds_per_operation','line_efficiency_pct')) or
  (table_name='garment_rates' and column_name in ('operations')) or
  (table_name='attendance' and column_name in ('check_in','check_out','check_in_location','check_out_location'))
)

order by kind, name;

-- ---------------------------------------------------------------
-- If you're specifically debugging "Database error saving new user"
-- on signup, also run this separately and paste the result:

select
  p.prosrc as function_body,
  t.tgenabled as trigger_enabled
from pg_proc p
join pg_trigger t on t.tgfoid = p.oid
where p.proname = 'handle_new_user';

-- Also check Supabase Dashboard -> Logs -> Postgres Logs (or Auth Logs)
-- around the time of the failed signup — that shows the exact underlying
-- error, which "Database error saving new user" hides from the browser.

