-- v80: dresses stitched in production count as made automatically (Made = stitched + any extra added/scanned in; never below what was dispatched).
-- Run after migration_65.sql. Safe to re-run.

create or replace function fg_items(p_order uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if not stock_user() then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.order_number desc, t.item_index), '[]'::jsonb) into out from (
    select o.id as order_id, o.order_number, o.customer_name, o.status, x.idx::int as item_index, x.it->>'description' as item_description,
           coalesce(nullif(x.it->>'quantity','')::numeric, 0) as ordered,
           coalesce((select sum(quantity) from order_progress p where p.order_id = o.id and p.item_description = x.it->>'description'), 0) as stitched,
           coalesce((select sum(qty) from finished_goods_log l where l.order_id = o.id and l.item_description = x.it->>'description' and l.kind = 'in' and l.source <> 'production'), 0) as made_logged,
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
            'made', greatest((e->>'stitched')::numeric + (e->>'made_logged')::numeric, (e->>'delivered')::numeric, (e->>'scanned_out')::numeric),
            'balance', greatest((e->>'stitched')::numeric + (e->>'made_logged')::numeric, (e->>'delivered')::numeric, (e->>'scanned_out')::numeric)
                       - greatest((e->>'delivered')::numeric, (e->>'scanned_out')::numeric))), '[]'::jsonb)
            from jsonb_array_elements(out) e);
end $$;
grant execute on function fg_items(uuid) to authenticated;
