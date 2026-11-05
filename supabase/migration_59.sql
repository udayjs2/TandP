-- migration_59.sql — v68: customers see their order's student measurements from the tracking link. Run after migration_58.sql.
-- Read-only; needs the order number + tracking code, like the dispatch / payments pages.
create or replace function public_order_measurements(p_order_number text, p_tracking_code text)
returns json language plpgsql security definer set search_path = public as $$
declare o orders%rowtype;
begin
  select * into o from orders where order_number = p_order_number and tracking_code = p_tracking_code;
  if not found then return null; end if;
  return json_build_object(
    'order_number', o.order_number, 'customer_name', o.customer_name,
    'items', (select coalesce(json_agg(json_build_object('name', i.name, 'fields', i.fields) order by i.sort_no, i.name), '[]'::json) from measurement_items i),
    'students', (select coalesce(json_agg(json_build_object(
        'name', s.student_name, 'class_name', s.class_name, 'section', s.section, 'roll_no', s.roll_no,
        'records', (select coalesce(json_object_agg(r.item, json_build_object('size', r.size, 'm', r.m)), '{}'::json) from measurement_records r where r.student_id = s.id))
        order by s.class_name, s.section, s.student_name), '[]'::json)
      from measurement_students s where s.order_id = o.id));
end $$;
grant execute on function public_order_measurements(text, text) to anon, authenticated;
