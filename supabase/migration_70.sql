-- v91: per-invoice choice — print the earlier (previous) dispatch details on this invoice or not.
alter table invoices add column if not exists include_previous_dispatches boolean not null default false;
-- invoices made before part-delivery billing (not linked to any dispatch) used to print every dispatch: keep that
update invoices set include_previous_dispatches = true
 where linked_order_id is not null and not exists (select 1 from order_deliveries d where d.invoice_id = invoices.id);
