-- v85: part-delivery invoicing. Each dispatch batch (order_deliveries row) can be billed on exactly one
-- invoice; an order can have many invoices (one per batch or group of batches).

alter table order_deliveries add column if not exists invoice_id uuid references invoices(id) on delete set null;
create index if not exists order_deliveries_invoice_idx on order_deliveries(invoice_id);

-- Links the given dispatch batches to the invoice (replaces the invoice's earlier links).
-- Deleting an invoice frees its batches again (on delete set null).
create or replace function set_invoice_deliveries(p_invoice uuid, p_deliveries uuid[])
returns json language plpgsql security definer set search_path = public as $$
declare inv invoices%rowtype; v_bad int;
begin
  if not is_finance_admin() then return json_build_object('ok', false, 'error', 'Not allowed'); end if;
  select * into inv from invoices where id = p_invoice;
  if not found then return json_build_object('ok', false, 'error', 'Invoice not found'); end if;
  p_deliveries := coalesce(p_deliveries, '{}');
  if inv.linked_order_id is null and array_length(p_deliveries,1) > 0 then
    return json_build_object('ok', false, 'error', 'Link the invoice to an order first');
  end if;
  select count(*) into v_bad from order_deliveries d
   where d.id = any(p_deliveries) and (d.order_id is distinct from inv.linked_order_id or (d.invoice_id is not null and d.invoice_id <> p_invoice));
  if v_bad > 0 then
    return json_build_object('ok', false, 'error', 'One of the selected dispatches already belongs to another invoice (or another order)');
  end if;
  update order_deliveries set invoice_id = null where invoice_id = p_invoice and not (id = any(p_deliveries));
  update order_deliveries set invoice_id = p_invoice where id = any(p_deliveries);
  return json_build_object('ok', true);
end $$;
grant execute on function set_invoice_deliveries(uuid, uuid[]) to authenticated;
