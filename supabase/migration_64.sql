-- v77: barcodes on order items, finished-goods stock per order, own products with barcodes + sale stock deduction.
-- Run after migration_63.sql. Safe to re-run.

create or replace function stock_user() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('admin','hr','gm','pm','cutting_master','finance','tl'))
$$;

-- ---------- barcodes for order items ----------
create table if not exists item_barcodes (
  code text primary key,
  order_id uuid not null references orders(id) on delete cascade,
  item_index int not null,
  item_description text not null,
  created_at timestamptz default now(),
  unique (order_id, item_index)
);
alter table item_barcodes enable row level security;
drop policy if exists "item_barcodes_select" on item_barcodes;
create policy "item_barcodes_select" on item_barcodes for select using (stock_user());

create or replace function ensure_order_barcodes(p_order uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; i int := 0; it jsonb; c text; base text;
begin
  if not stock_user() then return '[]'::jsonb; end if;
  select * into o from orders where id = p_order;
  if not found then return '[]'::jsonb; end if;
  base := 'O' || regexp_replace(coalesce(o.order_number, ''), '[^0-9A-Za-z]', '', 'g');
  for it in select * from jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) loop
    i := i + 1;
    c := base || '-' || i;
    if exists (select 1 from item_barcodes b where b.code = c and b.order_id <> p_order) then c := c || 'X' || substr(p_order::text, 1, 4); end if;
    insert into item_barcodes (code, order_id, item_index, item_description)
    values (c, p_order, i, coalesce(it->>'description', 'Item ' || i))
    on conflict (order_id, item_index) do update set item_description = excluded.item_description;
  end loop;
  return coalesce((select jsonb_agg(to_jsonb(b) order by b.item_index) from item_barcodes b where b.order_id = p_order), '[]'::jsonb);
end $$;
grant execute on function ensure_order_barcodes(uuid) to authenticated;

-- ---------- finished goods (dresses made) per order ----------
create table if not exists finished_goods_log (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  item_description text not null,
  kind text not null check (kind in ('in','out')),
  qty numeric not null check (qty > 0),
  source text not null default 'manual' check (source in ('scan','manual','production')),
  note text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists finished_goods_log_order on finished_goods_log(order_id);
alter table finished_goods_log enable row level security;
drop policy if exists "fg_log_select" on finished_goods_log;
create policy "fg_log_select" on finished_goods_log for select using (stock_user());

-- one row per order item: ordered, stitched (production), in store, dispatched, balance
create or replace function fg_items(p_order uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if not stock_user() then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.order_number desc, t.item_index), '[]'::jsonb) into out from (
    select o.id as order_id, o.order_number, o.customer_name, o.status, x.idx::int as item_index, x.it->>'description' as item_description,
           coalesce(nullif(x.it->>'quantity','')::numeric, 0) as ordered,
           coalesce((select sum(quantity) from order_progress p where p.order_id = o.id and p.item_description = x.it->>'description'), 0) as stitched,
           coalesce((select sum(qty) from finished_goods_log l where l.order_id = o.id and l.item_description = x.it->>'description' and l.kind = 'in'), 0) as made,
           coalesce((select sum(quantity) from order_deliveries d where d.order_id = o.id and d.item_description = x.it->>'description'), 0) as delivered,
           coalesce((select sum(qty) from finished_goods_log l where l.order_id = o.id and l.item_description = x.it->>'description' and l.kind = 'out'), 0) as scanned_out,
           (select code from item_barcodes b where b.order_id = o.id and b.item_index = x.idx::int) as barcode
      from orders o
      cross join lateral jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) with ordinality as x(it, idx)
     where (p_order is null or o.id = p_order)
       and (p_order is not null or o.status not in ('Rejected by Customer'))
  ) t;
  -- dispatched = whichever is larger: recorded deliveries or scanned/manual out; balance = made - dispatched
  return (select coalesce(jsonb_agg(e || jsonb_build_object(
            'dispatched', greatest((e->>'delivered')::numeric, (e->>'scanned_out')::numeric),
            'balance', (e->>'made')::numeric - greatest((e->>'delivered')::numeric, (e->>'scanned_out')::numeric))), '[]'::jsonb)
            from jsonb_array_elements(out) e);
end $$;
grant execute on function fg_items(uuid) to authenticated;

create or replace function fg_add(p_order uuid, p_item text, p_kind text, p_qty numeric, p_note text default null, p_source text default 'manual') returns jsonb
language plpgsql security definer set search_path = public as $$
declare cur jsonb; bal numeric;
begin
  if not stock_user() then return jsonb_build_object('ok', false, 'error', 'Not allowed.'); end if;
  if p_kind not in ('in','out') or coalesce(p_qty, 0) <= 0 then return jsonb_build_object('ok', false, 'error', 'Enter a quantity above zero.'); end if;
  select e into cur from jsonb_array_elements(fg_items(p_order)) e where e->>'item_description' = p_item limit 1;
  if cur is null then return jsonb_build_object('ok', false, 'error', 'Item not on this order.'); end if;
  bal := (cur->>'balance')::numeric;
  if p_kind = 'out' and p_qty > bal then
    return jsonb_build_object('ok', false, 'error', 'Only ' || bal || ' in finished stock for this item.');
  end if;
  insert into finished_goods_log (order_id, item_description, kind, qty, source, note, created_by)
  values (p_order, p_item, p_kind, p_qty, case when p_source in ('scan','manual','production') then p_source else 'manual' end, p_note, auth.uid());
  select e into cur from jsonb_array_elements(fg_items(p_order)) e where e->>'item_description' = p_item limit 1;
  return jsonb_build_object('ok', true, 'item', cur);
end $$;
grant execute on function fg_add(uuid, text, text, numeric, text, text) to authenticated;

-- bring the store count up to what production has stitched
create or replace function fg_take_production(p_order uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e jsonb; gap numeric; n int := 0;
begin
  if not stock_user() then return jsonb_build_object('ok', false, 'error', 'Not allowed.'); end if;
  for e in select * from jsonb_array_elements(fg_items(p_order)) loop
    gap := (e->>'stitched')::numeric - (e->>'made')::numeric;
    if gap > 0 then
      insert into finished_goods_log (order_id, item_description, kind, qty, source, note, created_by)
      values (p_order, e->>'item_description', 'in', gap, 'production', 'Taken from production count', auth.uid());
      n := n + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'items', n);
end $$;
grant execute on function fg_take_production(uuid) to authenticated;

-- ---------- own products ----------
create sequence if not exists own_product_seq start 1;
create table if not exists own_products (
  id uuid primary key default gen_random_uuid(),
  barcode text unique not null default ('P' || lpad(nextval('own_product_seq')::text, 6, '0')),
  name text not null,
  category text not null default 'Kids wear',        -- Kids wear | Women wear | Doctors dress | Other
  size text,
  color text,
  price numeric not null default 0,                  -- selling price before GST
  gst_rate numeric not null default 0,
  hsn_code text,
  stock_qty numeric not null default 0,
  reorder_level numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz default now()
);
create table if not exists product_moves (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references own_products(id) on delete cascade,
  qty numeric not null,                              -- + stock in, - stock out
  reason text not null check (reason in ('sale','stock_in','adjust')),
  invoice_id uuid,
  note text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists product_moves_invoice on product_moves(invoice_id);
alter table own_products enable row level security;
alter table product_moves enable row level security;
drop policy if exists "own_products_select" on own_products;
drop policy if exists "product_moves_select" on product_moves;
create policy "own_products_select" on own_products for select using (stock_user());
create policy "product_moves_select" on product_moves for select using (stock_user());
do $$ begin alter publication supabase_realtime add table own_products; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table finished_goods_log; exception when others then null; end $$;

create or replace function save_product(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid uuid := nullif(p->>'id','')::uuid; opening numeric := coalesce(nullif(p->>'opening_stock','')::numeric, 0);
begin
  if not stock_user() then return jsonb_build_object('ok', false, 'error', 'Not allowed.'); end if;
  if nullif(btrim(p->>'name'), '') is null then return jsonb_build_object('ok', false, 'error', 'Enter the product name.'); end if;
  if pid is null then
    insert into own_products (name, category, size, color, price, gst_rate, hsn_code, reorder_level, stock_qty)
    values (btrim(p->>'name'), coalesce(nullif(p->>'category',''), 'Other'), nullif(p->>'size',''), nullif(p->>'color',''),
            coalesce(nullif(p->>'price','')::numeric, 0), coalesce(nullif(p->>'gst_rate','')::numeric, 0), nullif(p->>'hsn_code',''),
            coalesce(nullif(p->>'reorder_level','')::numeric, 0), opening)
    returning id into pid;
    if opening <> 0 then insert into product_moves (product_id, qty, reason, note, created_by) values (pid, opening, 'stock_in', 'Opening stock', auth.uid()); end if;
  else
    update own_products set name = btrim(p->>'name'), category = coalesce(nullif(p->>'category',''), category), size = nullif(p->>'size',''),
           color = nullif(p->>'color',''), price = coalesce(nullif(p->>'price','')::numeric, 0), gst_rate = coalesce(nullif(p->>'gst_rate','')::numeric, 0),
           hsn_code = nullif(p->>'hsn_code',''), reorder_level = coalesce(nullif(p->>'reorder_level','')::numeric, 0),
           active = coalesce((p->>'active')::boolean, active)
     where id = pid;
  end if;
  return jsonb_build_object('ok', true, 'id', pid);
end $$;
grant execute on function save_product(jsonb) to authenticated;

create or replace function product_adjust(p_product uuid, p_qty numeric, p_reason text default 'stock_in', p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cur numeric;
begin
  if not stock_user() then return jsonb_build_object('ok', false, 'error', 'Not allowed.'); end if;
  if coalesce(p_qty, 0) = 0 then return jsonb_build_object('ok', false, 'error', 'Enter a quantity.'); end if;
  select stock_qty into cur from own_products where id = p_product for update;
  if cur is null then return jsonb_build_object('ok', false, 'error', 'Product not found.'); end if;
  if cur + p_qty < 0 then return jsonb_build_object('ok', false, 'error', 'Only ' || cur || ' in stock.'); end if;
  update own_products set stock_qty = stock_qty + p_qty where id = p_product;
  insert into product_moves (product_id, qty, reason, note, created_by) values (p_product, p_qty, case when p_reason in ('stock_in','adjust') then p_reason else 'adjust' end, p_note, auth.uid());
  return jsonb_build_object('ok', true, 'stock', cur + p_qty);
end $$;
grant execute on function product_adjust(uuid, numeric, text, text) to authenticated;

-- stock goes down when an invoice with product lines is saved; re-saving or deleting the invoice puts it back first
create or replace function restore_invoice_stock(p_invoice uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m record;
begin
  for m in select * from product_moves where invoice_id = p_invoice and reason = 'sale' loop
    update own_products set stock_qty = stock_qty - m.qty where id = m.product_id;   -- m.qty is negative
  end loop;
  delete from product_moves where invoice_id = p_invoice and reason = 'sale';
end $$;
revoke execute on function restore_invoice_stock(uuid) from public, anon, authenticated;

create or replace function record_product_sale(p_invoice uuid, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l jsonb; pid uuid; q numeric; cur numeric; nm text;
begin
  if not (stock_user() or is_finance_admin()) then return jsonb_build_object('ok', false, 'error', 'Not allowed.'); end if;
  perform restore_invoice_stock(p_invoice);
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    pid := nullif(l->>'product_id','')::uuid; q := coalesce(nullif(l->>'qty','')::numeric, 0);
    if pid is null or q <= 0 then continue; end if;
    select stock_qty, name into cur, nm from own_products where id = pid for update;
    if cur is null then continue; end if;
    if cur < q then raise exception 'Only % of "%" in stock (invoice needs %).', cur, nm, q; end if;
    update own_products set stock_qty = stock_qty - q where id = pid;
    insert into product_moves (product_id, qty, reason, invoice_id, created_by) values (pid, -q, 'sale', p_invoice, auth.uid());
  end loop;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function record_product_sale(uuid, jsonb) to authenticated;

create or replace function trg_invoice_delete_restore() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform restore_invoice_stock(old.id); return old; end $$;
drop trigger if exists invoice_delete_restore_stock on invoices;
create trigger invoice_delete_restore_stock before delete on invoices for each row execute function trg_invoice_delete_restore();

-- ---------- one scanner for everything ----------
create or replace function scan_code(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c text := btrim(coalesce(p_code, '')); b item_barcodes%rowtype; pr own_products%rowtype; it jsonb;
begin
  if not (stock_user() or is_finance_admin()) then return jsonb_build_object('kind', 'denied'); end if;
  select * into pr from own_products where barcode = c or upper(barcode) = upper(c);
  if found then return jsonb_build_object('kind', 'product', 'product', to_jsonb(pr)); end if;
  select * into b from item_barcodes where code = c or upper(code) = upper(c);
  if found then
    select e into it from jsonb_array_elements(fg_items(b.order_id)) e where (e->>'item_index')::int = b.item_index;
    return jsonb_build_object('kind', 'order_item', 'item', it);
  end if;
  return jsonb_build_object('kind', 'unknown');
end $$;
grant execute on function scan_code(text) to authenticated;
