-- migration_54.sql — v62: the Cutting Master / Cutters can add a missing item (and its size range) to an order from the
-- Cutting module, without access to the Orders module. Run after migration_53.sql. Safe to run twice.
create or replace function cutting_add_item(
  p_order uuid, p_description text, p_quantity numeric default 0,
  p_size_mode text default null, p_size_from text default null, p_size_to text default null, p_size_custom text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_role text; v_name text; o orders%rowtype; v_desc text := trim(coalesce(p_description, ''));
  v_items jsonb; v_idx int := -1; i int; v_new jsonb; v_size jsonb := '{}'::jsonb;
begin
  select role, name into v_role, v_name from profiles where id = auth.uid();
  if v_role not in ('cutting_master','cutting','admin','hr','gm','pm') then
    return json_build_object('ok', false, 'error', 'Only the Cutting Master, a Cutter, the Production Manager, General Manager or Admin can add items from the Cutting module');
  end if;
  select * into o from orders where id = p_order for update;
  if not found then return json_build_object('ok', false, 'error', 'Order not found'); end if;
  if o.status in ('Completed','Shipped','Rejected by Customer') then
    return json_build_object('ok', false, 'error', 'This order is already ' || o.status || '; items can no longer be added');
  end if;
  if v_desc = '' then return json_build_object('ok', false, 'error', 'Enter the item name'); end if;
  if coalesce(p_quantity, 0) < 0 then return json_build_object('ok', false, 'error', 'Quantity cannot be negative'); end if;

  if coalesce(p_size_mode, '') <> '' then
    if p_size_mode not in ('num','let','custom') then return json_build_object('ok', false, 'error', 'Unknown size range type'); end if;
    if p_size_mode = 'custom' and coalesce(trim(p_size_custom), '') = '' then return json_build_object('ok', false, 'error', 'Enter the custom sizes'); end if;
    if p_size_mode in ('num','let') and (coalesce(trim(p_size_from), '') = '' or coalesce(trim(p_size_to), '') = '') then
      return json_build_object('ok', false, 'error', 'Enter the size range from and to'); end if;
    if p_size_mode = 'num' and (p_size_from !~ '^[0-9]+$' or p_size_to !~ '^[0-9]+$' or p_size_from::int > p_size_to::int or p_size_to::int > 200) then
      return json_build_object('ok', false, 'error', 'Check the size range numbers'); end if;
    v_size := jsonb_build_object('size_mode', p_size_mode, 'size_from', coalesce(p_size_from, ''), 'size_to', coalesce(p_size_to, ''), 'size_custom', coalesce(p_size_custom, ''));
  end if;

  v_items := coalesce(o.items::jsonb, '[]'::jsonb);
  for i in 0 .. jsonb_array_length(v_items) - 1 loop
    if lower(trim(v_items->i->>'description')) = lower(v_desc) then v_idx := i; exit; end if;
  end loop;

  if v_idx >= 0 then
    -- the item is already on the order: only a missing size range can be filled in
    if coalesce(v_items->v_idx->>'size_mode', '') <> '' then
      return json_build_object('ok', false, 'error', '"' || v_desc || '" is already on this order with a size range');
    end if;
    if v_size = '{}'::jsonb then return json_build_object('ok', false, 'error', '"' || v_desc || '" is already on this order. Add a size range to it, or use a different item name'); end if;
    v_items := jsonb_set(v_items, array[v_idx::text], (v_items->v_idx) || v_size || jsonb_build_object('size_added_by', v_name, 'size_added_by_role', v_role, 'size_added_at', now()));
  else
    v_new := jsonb_build_object('description', v_desc, 'quantity', coalesce(p_quantity, 0)) || v_size
             || jsonb_build_object('added_by', v_name, 'added_by_role', v_role, 'added_at', now());
    v_items := v_items || jsonb_build_array(v_new);
  end if;
  update orders set items = v_items where id = p_order;
  return json_build_object('ok', true, 'existing', v_idx >= 0);
end $$;
grant execute on function cutting_add_item(uuid, text, numeric, text, text, text, text) to authenticated;
