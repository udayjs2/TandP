-- v78: finished-goods balance never goes negative, invoice scans reduce finished stock, unit price for the dress inventory report.
-- Run after migration_64.sql. Safe to re-run.

-- made = what was added to store, but never less than what has gone out (you cannot dispatch what was not made)
create or replace function fg_items(p_order uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if not stock_user() then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.order_number desc, t.item_index), '[]'::jsonb) into out from (
    select o.id as order_id, o.order_number, o.customer_name, o.status, x.idx::int as item_index, x.it->>'description' as item_description,
           coalesce(nullif(x.it->>'quantity','')::numeric, 0) as ordered,
           coalesce((select sum(quantity) from order_progress p where p.order_id = o.id and p.item_description = x.it->>'description'), 0) as stitched,
           coalesce((select sum(qty) from finished_goods_log l where l.order_id = o.id and l.item_description = x.it->>'description' and l.kind = 'in'), 0) as made_logged,
           coalesce((select sum(quantity) from order_deliveries d where d.order_id = o.id and d.item_description = x.it->>'description'), 0) as delivered,
           coalesce((select sum(qty) from finished_goods_log l where l.order_id = o.id and l.item_description = x.it->>'description' and l.kind = 'out'), 0) as scanned_out,
           coalesce((select avg(nullif(ii->>'price','')::numeric) from invoices v, jsonb_array_elements(coalesce(v.items,'[]'::jsonb)) ii
                      where v.linked_order_id = o.id and ii->>'description' = x.it->>'description' and nullif(ii->>'price','')::numeric > 0),
                    nullif(x.it->>'price','')::numeric, 0) as unit_price,
           (select code from item_barcodes b where b.order_id = o.id and b.item_index = x.idx::int) as barcode
      from orders o
      cross join lateral jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) with ordinality as x(it, idx)
     where (p_order is null or o.id = p_order)
       and (p_order is not null or o.status not in ('Rejected by Customer'))
  ) t;
  return (select coalesce(jsonb_agg(e || jsonb_build_object(
            'dispatched', greatest((e->>'delivered')::numeric, (e->>'scanned_out')::numeric),
            'made', greatest((e->>'made_logged')::numeric, (e->>'delivered')::numeric, (e->>'scanned_out')::numeric),
            'balance', greatest((e->>'made_logged')::numeric, (e->>'delivered')::numeric, (e->>'scanned_out')::numeric)
                       - greatest((e->>'delivered')::numeric, (e->>'scanned_out')::numeric))), '[]'::jsonb)
            from jsonb_array_elements(out) e);
end $$;
grant execute on function fg_items(uuid) to authenticated;

-- scanning order-item barcodes on an invoice counts those dresses as sold (out of finished stock); re-saving replaces them
create or replace function fg_invoice_sync(p_invoice uuid, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l jsonb; q numeric;
begin
  if not (stock_user() or is_finance_admin()) then return jsonb_build_object('ok', false, 'error', 'Not allowed.'); end if;
  delete from finished_goods_log where note = 'invoice:' || p_invoice::text;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    q := coalesce(nullif(l->>'qty','')::numeric, 0);
    if q > 0 and nullif(l->>'order_id','') is not null then
      insert into finished_goods_log (order_id, item_description, kind, qty, source, note, created_by)
      values ((l->>'order_id')::uuid, l->>'item', 'out', q, 'scan', 'invoice:' || p_invoice::text, auth.uid());
    end if;
  end loop;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function fg_invoice_sync(uuid, jsonb) to authenticated;

create or replace function trg_invoice_delete_fg() returns trigger
language plpgsql security definer set search_path = public as $$
begin delete from finished_goods_log where note = 'invoice:' || old.id::text; return old; end $$;
drop trigger if exists invoice_delete_fg on invoices;
create trigger invoice_delete_fg before delete on invoices for each row execute function trg_invoice_delete_fg();
