-- v84: one cutting entry can use several fabrics (body / sleeves / collar …) and
-- duplicate entries made for the same cut can be merged into one.

alter table fabric_usage add column if not exists part text;   -- e.g. Body, Sleeves, Collar

-- p_fabrics: [{ "fabric_id": "...", "kg": 5, "meters": 0, "part": "Body" }, ...]
create or replace function submit_cutting_multi(
  p_order_id uuid, p_item text, p_cut_date date, p_sizes jsonb, p_fabrics jsonb, p_submitted_by text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; r record; f inventory_fabric%rowtype;
  v_kg numeric := 0; v_m numeric := 0; v_first uuid;
begin
  if not (is_cutting_or_admin() or is_gm_pm_or_admin()) then raise exception 'Not allowed to log cutting'; end if;
  if p_fabrics is null or jsonb_typeof(p_fabrics) <> 'array' or jsonb_array_length(p_fabrics) = 0 then
    raise exception 'Select the fabric used before logging cutting';
  end if;
  if p_sizes is null or p_sizes = '{}'::jsonb then raise exception 'Enter the cut quantity for at least one size'; end if;

  -- check stock for every fabric (the same fabric listed twice is added up)
  for r in
    select (x->>'fabric_id')::uuid as fid, sum(coalesce((x->>'kg')::numeric,0)) as kg, sum(coalesce((x->>'meters')::numeric,0)) as m
      from jsonb_array_elements(p_fabrics) x group by 1
  loop
    if r.fid is null then raise exception 'Select the fabric for every line'; end if;
    if r.kg <= 0 and r.m <= 0 then raise exception 'Enter the fabric used (kg or meters) for every line'; end if;
    select * into f from inventory_fabric where id = r.fid for update;
    if not found then raise exception 'Fabric not found in inventory'; end if;
    if r.kg > coalesce(f.stock_kg,0) then raise exception 'Only % kg available of % %', coalesce(f.stock_kg,0), f.fabric_type, coalesce(f.color,''); end if;
    if r.m > coalesce(f.stock_meters,0) then raise exception 'Only % m available of % %', coalesce(f.stock_meters,0), f.fabric_type, coalesce(f.color,''); end if;
    v_kg := v_kg + r.kg; v_m := v_m + r.m;
  end loop;
  v_first := (p_fabrics->0->>'fabric_id')::uuid;

  insert into cutting_entries (order_id, item_description, cut_date, sizes, submitted_by, fabric_id, fabric_kg_used, fabric_meters_used)
  values (p_order_id, p_item, p_cut_date, p_sizes, p_submitted_by, v_first, v_kg, v_m) returning id into v_id;

  for r in select (x->>'fabric_id')::uuid as fid, coalesce((x->>'kg')::numeric,0) as kg, coalesce((x->>'meters')::numeric,0) as m, nullif(trim(x->>'part'),'') as part
             from jsonb_array_elements(p_fabrics) x
  loop
    update inventory_fabric set stock_kg = coalesce(stock_kg,0) - r.kg, stock_meters = coalesce(stock_meters,0) - r.m where id = r.fid;
    insert into fabric_usage (fabric_id, order_id, cutting_entry_id, kg_used, meters_used, used_by, part)
    values (r.fid, p_order_id, v_id, r.kg, r.m, p_submitted_by, r.part);
  end loop;
  return v_id;
end $$;
grant execute on function submit_cutting_multi(uuid, text, date, jsonb, jsonb, text) to authenticated;

create or replace function resubmit_cutting_multi(p_id uuid, p_cut_date date, p_sizes jsonb, p_fabrics jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare e cutting_entries%rowtype; r record; f inventory_fabric%rowtype; v_name text;
        v_kg numeric := 0; v_m numeric := 0;
begin
  if not (is_cutting_or_admin() or is_gm_pm_or_admin()) then return json_build_object('ok', false, 'error', 'Not allowed to resend cutting'); end if;
  select * into e from cutting_entries where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Entry not found'); end if;
  if e.status <> 'Rejected' then return json_build_object('ok', false, 'error', 'Only a rejected entry can be resent'); end if;
  if p_fabrics is null or jsonb_typeof(p_fabrics) <> 'array' or jsonb_array_length(p_fabrics) = 0 then
    return json_build_object('ok', false, 'error', 'Select the fabric used');
  end if;
  if p_sizes is null or p_sizes = '{}'::jsonb then return json_build_object('ok', false, 'error', 'Enter the cut quantity for at least one size'); end if;
  for r in
    select (x->>'fabric_id')::uuid as fid, sum(coalesce((x->>'kg')::numeric,0)) as kg, sum(coalesce((x->>'meters')::numeric,0)) as m
      from jsonb_array_elements(p_fabrics) x group by 1
  loop
    if r.fid is null then return json_build_object('ok', false, 'error', 'Select the fabric for every line'); end if;
    if r.kg <= 0 and r.m <= 0 then return json_build_object('ok', false, 'error', 'Enter the fabric used (kg or meters) for every line'); end if;
    select * into f from inventory_fabric where id = r.fid for update;
    if not found then return json_build_object('ok', false, 'error', 'Fabric not found in inventory'); end if;
    if r.kg > coalesce(f.stock_kg,0) then return json_build_object('ok', false, 'error', 'Only ' || coalesce(f.stock_kg,0) || ' kg available of ' || f.fabric_type); end if;
    if r.m > coalesce(f.stock_meters,0) then return json_build_object('ok', false, 'error', 'Only ' || coalesce(f.stock_meters,0) || ' m available of ' || f.fabric_type); end if;
    v_kg := v_kg + r.kg; v_m := v_m + r.m;
  end loop;
  select name into v_name from profiles where id = auth.uid();
  for r in select (x->>'fabric_id')::uuid as fid, coalesce((x->>'kg')::numeric,0) as kg, coalesce((x->>'meters')::numeric,0) as m, nullif(trim(x->>'part'),'') as part
             from jsonb_array_elements(p_fabrics) x
  loop
    update inventory_fabric set stock_kg = coalesce(stock_kg,0) - r.kg, stock_meters = coalesce(stock_meters,0) - r.m where id = r.fid;
    insert into fabric_usage (fabric_id, order_id, cutting_entry_id, kg_used, meters_used, used_by, part)
    values (r.fid, e.order_id, e.id, r.kg, r.m, v_name, r.part);
  end loop;
  update cutting_entries
     set status = 'Submitted', cut_date = coalesce(p_cut_date, cut_date), sizes = p_sizes,
         fabric_id = (p_fabrics->0->>'fabric_id')::uuid, fabric_kg_used = v_kg, fabric_meters_used = v_m,
         completed_sizes = '{}'::jsonb, reviewed_by = null, reviewed_at = null, resend_count = resend_count + 1
   where id = p_id;
  return json_build_object('ok', true);
end $$;
grant execute on function resubmit_cutting_multi(uuid, date, jsonb, jsonb) to authenticated;

-- Merge entries that are really ONE cut made from several fabrics.
-- The kept entry stays; the others' fabric usage moves onto it; piece counts are NOT added
-- (they are the same pieces) — per size the larger number is kept. Stitching logs move over too.
create or replace function merge_cutting_entries(p_keep uuid, p_merge uuid[])
returns json language plpgsql security definer set search_path = public as $$
declare k cutting_entries%rowtype; m cutting_entries%rowtype; v_name text; v_sizes jsonb; v_done jsonb; x record;
        v_kg numeric; v_mt numeric;
begin
  if p_merge is null or coalesce(array_length(p_merge,1),0) = 0 then return json_build_object('ok', false, 'error', 'Pick the entries to merge'); end if;
  select * into k from cutting_entries where id = p_keep for update;
  if not found then return json_build_object('ok', false, 'error', 'Entry not found'); end if;
  select name into v_name from profiles where id = auth.uid();
  if not (is_gm_pm_or_admin() or (my_role() = 'cutting_master' and k.status = 'Submitted' and k.submitted_by is not distinct from v_name)) then
    return json_build_object('ok', false, 'error', 'You cannot merge these cutting entries');
  end if;
  if k.status = 'Rejected' then return json_build_object('ok', false, 'error', 'Rejected entries cannot be merged'); end if;
  v_sizes := coalesce(k.sizes, '{}'::jsonb); v_done := coalesce(k.completed_sizes, '{}'::jsonb);
  for m in select * from cutting_entries where id = any(p_merge) and id <> p_keep for update loop
    if m.order_id is distinct from k.order_id or m.item_description is distinct from k.item_description then
      return json_build_object('ok', false, 'error', 'Only entries of the same order and item can be merged');
    end if;
    if m.status <> k.status then
      return json_build_object('ok', false, 'error', 'All entries must have the same status (approve or review them together first)');
    end if;
    if not (is_gm_pm_or_admin() or (m.status = 'Submitted' and m.submitted_by is not distinct from v_name)) then
      return json_build_object('ok', false, 'error', 'You cannot merge these cutting entries');
    end if;
    for x in select key, value from jsonb_each_text(coalesce(m.sizes,'{}'::jsonb)) loop
      v_sizes := jsonb_set(v_sizes, array[x.key], to_jsonb(greatest(coalesce((v_sizes->>x.key)::numeric,0), coalesce(nullif(x.value,'')::numeric,0))));
    end loop;
    for x in select key, value from jsonb_each_text(coalesce(m.completed_sizes,'{}'::jsonb)) loop
      v_done := jsonb_set(v_done, array[x.key], to_jsonb(greatest(coalesce((v_done->>x.key)::numeric,0), coalesce(nullif(x.value,'')::numeric,0))));
    end loop;
    update fabric_usage set cutting_entry_id = p_keep where cutting_entry_id = m.id;
    update cutting_stitch_log set cutting_entry_id = p_keep where cutting_entry_id = m.id;
    delete from cutting_entries where id = m.id;
  end loop;
  select coalesce(sum(kg_used),0), coalesce(sum(meters_used),0) into v_kg, v_mt from fabric_usage where cutting_entry_id = p_keep and restored = false;
  update cutting_entries set sizes = v_sizes, completed_sizes = v_done, fabric_kg_used = v_kg, fabric_meters_used = v_mt where id = p_keep;
  return json_build_object('ok', true);
end $$;
grant execute on function merge_cutting_entries(uuid, uuid[]) to authenticated;
