-- v52: Production Manager full access, "Rejected by Customer" status, customer delivery acceptance link,
-- Garment Design & Size Master. Run after migration_46.sql. Safe to re-run.

-- ============================================================ 1. Production Manager: full access in Production Management
create or replace function is_quality_or_admin()
returns boolean as $$
  select is_admin() or exists (select 1 from profiles where id = auth.uid() and role in ('quality_manager','qc','pm'));
$$ language sql security definer stable;

create or replace function is_cutting_or_admin()
returns boolean as $$
  select is_admin() or exists (select 1 from profiles where id = auth.uid() and role in ('cutting_master','pm'));
$$ language sql security definer stable;

-- ============================================================ 2. Rejected by Customer (Shipped -> Rejected by Customer -> Completed)
alter table orders add column if not exists customer_reject_reason text;
alter table orders add column if not exists customer_rejected_at timestamptz;
alter table orders add column if not exists customer_rejected_by text;

create or replace function block_ship_without_quality()
returns trigger language plpgsql as $$
begin
  if new.status = 'Shipped' and old.status is distinct from 'Shipped' then
    if new.quality_status <> 'Approved' then
      raise exception 'Quality approval is required before this order can be shipped';
    end if;
    if new.dispatch_status <> 'Approved' then
      raise exception 'Dispatch approval (Production Manager, then General Manager) is required before this order can be shipped';
    end if;
  end if;
  if new.status = 'Rejected by Customer' and old.status is distinct from 'Rejected by Customer' then
    if old.status <> 'Shipped' then
      raise exception 'Only a Shipped order can be marked Rejected by Customer';
    end if;
    if auth.uid() is not null and my_role() not in ('admin','gm','pm') then
      raise exception 'Only the Admin, Production Manager or General Manager can mark an order Rejected by Customer';
    end if;
  end if;
  if new.status = 'Completed' and old.status is distinct from 'Completed' and old.status not in ('Shipped','Rejected by Customer') then
    raise exception 'The order must be Shipped before it can be marked Completed (delivered to the customer)';
  end if;
  return new;
end $$;

-- GM cannot update orders directly, so the customer-rejection steps go through these two functions.
create or replace function set_customer_rejection(p_order_id uuid, p_reason text)
returns json language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; v_name text;
begin
  if my_role() not in ('admin','gm','pm') then
    return json_build_object('ok', false, 'error', 'Only the Admin, Production Manager or General Manager can mark an order Rejected by Customer');
  end if;
  if length(trim(coalesce(p_reason,''))) < 3 then return json_build_object('ok', false, 'error', 'Write the reason the customer gave'); end if;
  select * into o from orders where id = p_order_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Order not found'); end if;
  if o.status <> 'Shipped' then return json_build_object('ok', false, 'error', 'Only a Shipped order can be marked Rejected by Customer'); end if;
  select name into v_name from profiles where id = auth.uid();
  update orders set status = 'Rejected by Customer', customer_reject_reason = left(trim(p_reason), 1000),
         customer_rejected_at = now(), customer_rejected_by = v_name
   where id = p_order_id;
  return json_build_object('ok', true);
end $$;

-- After a rejection: goods re-dispatched (back to Shipped) or the customer finally accepted (Completed).
create or replace function resolve_customer_rejection(p_order_id uuid, p_to text)
returns json language plpgsql security definer set search_path = public as $$
declare o orders%rowtype;
begin
  if my_role() not in ('admin','gm','pm') then
    return json_build_object('ok', false, 'error', 'Only the Admin, Production Manager or General Manager can do this');
  end if;
  if p_to not in ('Shipped','Completed') then return json_build_object('ok', false, 'error', 'Invalid status'); end if;
  select * into o from orders where id = p_order_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Order not found'); end if;
  if o.status <> 'Rejected by Customer' then return json_build_object('ok', false, 'error', 'This order is not marked Rejected by Customer'); end if;
  update orders set status = p_to where id = p_order_id;
  return json_build_object('ok', true);
end $$;
grant execute on function set_customer_rejection(uuid, text) to authenticated;
grant execute on function resolve_customer_rejection(uuid, text) to authenticated;

-- A rejected order is no longer "in production": keep it out of the alert and dispatch-sync rules.
do $$
declare fn text; oid_ oid; def text;
begin
  foreach fn in array array['factory_alerts','sync_dispatch_on_quality'] loop
    select p.oid into oid_ from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn limit 1;
    if oid_ is not null then
      def := pg_get_functiondef(oid_);
      if position('(''Shipped'',''Completed'')' in def) > 0 then
        execute replace(def, '(''Shipped'',''Completed'')', '(''Shipped'',''Completed'',''Rejected by Customer'')');
      end if;
    end if;
  end loop;
end $$;

-- ============================================================ 3. Customer acceptance of dispatched goods
alter table order_deliveries add column if not exists customer_status text not null default 'Pending';
alter table order_deliveries drop constraint if exists order_deliveries_customer_status_check;
alter table order_deliveries add constraint order_deliveries_customer_status_check
  check (customer_status in ('Pending','Accepted','Partly accepted','Rejected'));
alter table order_deliveries add column if not exists accepted_qty numeric not null default 0;
alter table order_deliveries add column if not exists rejected_qty numeric not null default 0;
alter table order_deliveries add column if not exists customer_reason text;
alter table order_deliveries add column if not exists customer_responded_at timestamptz;
alter table order_deliveries add column if not exists customer_responder text;

-- The customer's answer can only be written by the customer's link or reset by Admin/PM/GM.
create or replace function guard_delivery_customer_fields()
returns trigger language plpgsql as $$
declare via_rpc boolean := coalesce(current_setting('tp.cust_rpc', true), '') = '1';
begin
  if tg_op = 'INSERT' then
    new.customer_status := 'Pending'; new.accepted_qty := 0; new.rejected_qty := 0;
    new.customer_reason := null; new.customer_responded_at := null; new.customer_responder := null;
  elsif not via_rpc then
    if (new.customer_status, new.accepted_qty, new.rejected_qty, new.customer_reason, new.customer_responded_at, new.customer_responder)
       is distinct from
       (old.customer_status, old.accepted_qty, old.rejected_qty, old.customer_reason, old.customer_responded_at, old.customer_responder) then
      raise exception 'The customer''s response can only be given from the customer link, or reset by the Admin / Production Manager / General Manager';
    end if;
    if old.customer_status <> 'Pending' and new.quantity is distinct from old.quantity then
      raise exception 'The customer has already answered for this dispatch. Reset the response before changing the quantity.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_delivery_customer on order_deliveries;
create trigger guard_delivery_customer before insert or update on order_deliveries
  for each row execute procedure guard_delivery_customer_fields();

create or replace function reset_delivery_response(p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  if my_role() not in ('admin','gm','pm') then
    return json_build_object('ok', false, 'error', 'Only the Admin, Production Manager or General Manager can reset a customer response');
  end if;
  perform set_config('tp.cust_rpc', '1', true);
  update order_deliveries set customer_status = 'Pending', accepted_qty = 0, rejected_qty = 0,
         customer_reason = null, customer_responded_at = null, customer_responder = null
   where id = p_id;
  return json_build_object('ok', true);
end $$;
grant execute on function reset_delivery_response(uuid) to authenticated;

create or replace function public_delivery_status(p_order_number text, p_tracking_code text)
returns json language plpgsql security definer set search_path = public as $$
declare o orders%rowtype;
begin
  select * into o from orders where order_number = p_order_number and tracking_code = p_tracking_code;
  if not found then return null; end if;
  return json_build_object(
    'order_number', o.order_number, 'customer_name', o.customer_name, 'status', o.status, 'due_date', o.due_date,
    'items', (select coalesce(json_agg(row_to_json(x)), '[]'::json) from (
        select it->>'description' as description,
               coalesce((it->>'quantity')::numeric, 0) as ordered,
               coalesce((select sum(d.quantity) from order_deliveries d where d.order_id = o.id and d.item_description = it->>'description'), 0) as dispatched,
               coalesce((select sum(d.accepted_qty) from order_deliveries d where d.order_id = o.id and d.item_description = it->>'description'), 0) as accepted,
               coalesce((select sum(d.rejected_qty) from order_deliveries d where d.order_id = o.id and d.item_description = it->>'description'), 0) as rejected,
               coalesce((select sum(d.quantity) from order_deliveries d where d.order_id = o.id and d.item_description = it->>'description' and d.customer_status = 'Pending'), 0) as awaiting
          from jsonb_array_elements(o.items) with ordinality as t(it, n) order by n) x),
    'deliveries', (select coalesce(json_agg(row_to_json(y)), '[]'::json) from (
        select d.id, d.date, d.item_description, d.quantity, d.customer_status, d.accepted_qty, d.rejected_qty,
               d.customer_reason, d.customer_responded_at, d.customer_responder
          from order_deliveries d where d.order_id = o.id order by d.date desc, d.created_at desc) y),
    'payments', (select coalesce(json_agg(row_to_json(z)), '[]'::json) from (
        select p.payment_date, p.amount, p.mode from order_payments p where p.order_id = o.id order by p.payment_date desc, p.created_at desc) z),
    'payments_total', coalesce((select sum(amount) from order_payments where order_id = o.id), 0),
    'invoices', (select coalesce(json_agg(row_to_json(w)), '[]'::json) from (
        select i.invoice_number, i.issue_date, i.amount, i.status from invoices i where i.linked_order_id = o.id order by i.issue_date desc) w)
  );
end $$;

create or replace function public_delivery_respond(p_order_number text, p_tracking_code text, p_delivery_id uuid, p_accepted numeric, p_reason text, p_name text)
returns json language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; d order_deliveries%rowtype; v_rej numeric; v_status text;
begin
  select * into o from orders where order_number = p_order_number and tracking_code = p_tracking_code;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  select * into d from order_deliveries where id = p_delivery_id and order_id = o.id for update;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if d.customer_status <> 'Pending' then return json_build_object('ok', false, 'error', 'already_answered'); end if;
  if length(trim(coalesce(p_name,''))) < 2 then return json_build_object('ok', false, 'error', 'name_required'); end if;
  if p_accepted is null or p_accepted < 0 or p_accepted > d.quantity or p_accepted <> floor(p_accepted) then
    return json_build_object('ok', false, 'error', 'bad_quantity');
  end if;
  v_rej := d.quantity - p_accepted;
  if v_rej > 0 and length(trim(coalesce(p_reason,''))) < 3 then return json_build_object('ok', false, 'error', 'reason_required'); end if;
  v_status := case when v_rej = 0 then 'Accepted' when p_accepted = 0 then 'Rejected' else 'Partly accepted' end;
  perform set_config('tp.cust_rpc', '1', true);
  update order_deliveries set customer_status = v_status, accepted_qty = p_accepted, rejected_qty = v_rej,
         customer_reason = nullif(left(trim(coalesce(p_reason,'')), 1000), ''),
         customer_responded_at = now(), customer_responder = left(trim(p_name), 120)
   where id = d.id;
  return json_build_object('ok', true, 'status', v_status, 'accepted', p_accepted, 'rejected', v_rej);
end $$;
grant execute on function public_delivery_status(text, text) to anon, authenticated;
grant execute on function public_delivery_respond(text, text, uuid, numeric, text, text) to anon, authenticated;

-- ============================================================ 4. Garment Design & Size Master
create table if not exists garment_types (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'Dress types',
  name text not null unique,
  models text[] not null default '{}',
  gender text,
  size_prefix text not null unique check (size_prefix ~ '^[A-Z0-9]{1,14}$'),
  sizes text[] not null default '{}',
  start_size text,
  end_size text,
  typical_length text,
  sleeve_type text,
  collar_type text,
  pocket_config text,
  fabric_type text,
  colour text,
  measurements text,
  compliance_note text,
  sku text,
  purchase_price numeric,
  selling_price numeric,
  active boolean not null default true,
  sort_no int not null default 0,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table if not exists size_chart_ref (
  letter_size text primary key,
  chest text,
  waist text,
  sort_no int not null default 0
);
create table if not exists size_systems (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  start_size text,
  end_size text,
  sort_no int not null default 0
);
alter table garment_types enable row level security;
alter table size_chart_ref enable row level security;
alter table size_systems enable row level security;
do $$
declare t text;
begin
  foreach t in array array['garment_types','size_chart_ref','size_systems'] loop
    execute format('drop policy if exists "%1$s_select" on %1$s', t);
    execute format('drop policy if exists "%1$s_write" on %1$s', t);
    execute format('create policy "%1$s_select" on %1$s for select using (auth.role() = ''authenticated'')', t);
    execute format('create policy "%1$s_write" on %1$s for all using (is_admin() or my_role() in (''gm'',''pm'')) with check (is_admin() or my_role() in (''gm'',''pm''))', t);
  end loop;
end $$;
do $$ begin alter publication supabase_realtime add table garment_types; exception when others then null; end $$;

insert into garment_types (category, name, models, size_prefix, sizes, start_size, end_size, typical_length, compliance_note, active, sort_no) values
  ('Dress types','Knicker / Shorts',array['Regular','Boxer','Denim','School shorts']::text[],'KNICKER',array['9','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26']::text[],'9','26',null,null,true,1),
  ('Dress types','Frock',array['Baby frock','A-line','Party wear','Gown','Layered']::text[],'FROCK',array['0–3 M','3–6 M','6–9 M','9–12 M','1 Y','2 Y','3 Y','4 Y','5 Y','6 Y','7 Y','8 Y','9 Y','10 Y','11 Y','12 Y','13 Y','14 Y','15 Y','16 Y']::text[],'0–3 months','16 years',null,null,true,2),
  ('Dress types','Chudidhar',array['Straight cut','Anarkali','Umbrella','Palazzo set']::text[],'CHUD',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,3),
  ('Dress types','T-shirt',array['Round neck','V-neck','Polo','Oversized','Printed']::text[],'T',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,4),
  ('Dress types','Pant / Trouser',array['Formal','Casual','Slim fit','Straight fit','Cargo']::text[],'P',array['28','30','32','34','36','38','40','42','44']::text[],'28','44',null,null,true,5),
  ('Dress types','Skirt',array['Mini','Midi','Maxi','Pleated','Pencil','Circular']::text[],'SKIRT',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,6),
  ('Dress types','Track pant',array['Jogger','Slim fit','Regular','Zipper','Cuffed']::text[],'TRACK',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,7),
  ('Dress types','Coat / Blazer',array['Formal','Slim fit','Double-breasted','Casual blazer']::text[],'COAT',array['34','36','38','40','42','44','46','48','50']::text[],'34','50',null,null,true,8),
  ('Dress types','Safari shirt',array['Half sleeve','Full sleeve','Utility pocket','Formal']::text[],'SAFARISHIRT',array['36','38','40','42','44','46','48','50']::text[],'36','50',null,null,true,9),
  ('Dress types','Safari pant',array['Regular fit','Pleated','Flat front','Cargo style']::text[],'SAFARIPANT',array['28','30','32','34','36','38','40','42','44']::text[],'28','44',null,null,true,10),
  ('Dress types','Shirt',array['Formal','Casual','Checked','Printed','Slim fit']::text[],'SHIRT',array['36','38','40','42','44','46','48','50']::text[],'36','50',null,null,true,11),
  ('Dress types','Jeans',array['Skinny','Slim','Straight','Bootcut','Relaxed']::text[],'JEANS',array['28','30','32','34','36','38','40','42','44']::text[],'28','44',null,null,true,12),
  ('Dress types','Kurti',array['Straight','A-line','Anarkali','Short','Long']::text[],'KURTI',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,13),
  ('Dress types','Salwar',array['Patiala','Straight salwar','Churidar','Dhoti style']::text[],'SALWAR',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,14),
  ('Dress types','Leggings',array['Ankle length','Full length','Capri','Cotton']::text[],'LEGGINGS',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,15),
  ('Dress types','Nightwear',array['Nighty','Pajama set','Night suit','Shorts set']::text[],'NIGHTWEAR',array['S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'S','5XL',null,null,true,16),
  ('Dress types','Innerwear',array['Brief','Boxer','Vest','Camisole']::text[],'INNERWEAR',array['S','M','L','XL','XXL']::text[],'S','XXL',null,null,true,17),
  ('Dress types','Jacket',array['Denim','Bomber','Hoodie jacket','Winter jacket']::text[],'JACKET',array['S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'S','5XL',null,null,true,18),
  ('Dress types','Suit',array['Two-piece','Three-piece','Wedding suit']::text[],'SUIT',array['34','36','38','40','42','44','46','48','50']::text[],'34','50',null,null,true,19),
  ('Dress types','Dhoti',array['Traditional','Readymade','Double border','Silk']::text[],'DHOTI',array['Free size','Custom']::text[],'Dhoti-specific sizing','Dhoti-specific sizing',null,null,true,20),
  ('Medical & hospital','Doctor coat / Doctor dress',array['Classic white coat','Short coat','Long coat','Fitted coat','Mandarin collar','Notched collar']::text[],'DOCTORCOATDO',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL','30–42 inches',null,true,21),
  ('Medical & hospital','Scrub suit',array['V-neck','Round neck','Crossover top','Jogger scrub','Unisex scrub','Surgical scrub']::text[],'SCRUBSUIT',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,'Components: scrub top and scrub pant',true,22),
  ('Medical & hospital','Nurse dress / Nursing uniform',array['Button-front dress','Tunic uniform','Nursing top and pant','Maternity nursing uniform']::text[],'NURSEDRESSNU',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,23),
  ('Medical & hospital','Patient gown',array['Back-open gown','Side-tie gown','Examination gown','Patient nightgown']::text[],'PATIENTGOWN',array['S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'S','5XL',null,'Adjustable ties can provide a wider fit',true,24),
  ('Medical & hospital','Surgical gown',array['Reusable cotton gown','Sterile surgical gown','Disposable gown','Reinforced surgical gown']::text[],'SURGICALGOWN',array['M','L','XL','XXL','3XL','4XL']::text[],'M','4XL',null,'Manufacturer-specific sizes possible. Sterile and fluid-resistant gowns require appropriately validated materials and construction.',true,25),
  ('Aprons & laboratory','Apron',array['Bib apron','Waist apron','Cross-back apron','Sleeveless apron','Full-length apron','Pocket apron']::text[],'APRON',array['Free size','S','M','L','XL','XXL','Custom']::text[],'Free size','Custom',null,'Hospitals, laboratories, kitchens, salons and factories',true,26),
  ('Aprons & laboratory','Lab coat',array['Short lab coat','Knee-length coat','Long lab coat','Unisex coat','Women''s fitted coat','Men''s coat']::text[],'LABCOAT',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,'Research laboratories, colleges, pharmaceutical companies and testing centres',true,27),
  ('Aprons & laboratory','Chemical safety coat',array['Chemical-resistant coat','Splash-resistant coat','Coated-fabric coat','Disposable protective gown']::text[],'CHEMICALSAFE',array['S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'S','5XL',null,'Choose the fabric based on the actual chemicals and exposure risks. Manufacturer-specific sizing possible.',true,28),
  ('Aprons & laboratory','Pharmacist coat',array['Half coat','Full coat','Short fitted coat','Unisex pharmacy coat']::text[],'PHARMACISTCO',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,29),
  ('Industrial & safety','Safety coat',array['Reflective coat','High-visibility coat','Industrial coat']::text[],'SAFETYCOAT',array['S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'S','5XL',null,null,true,30),
  ('Industrial & safety','Boiler suit / Coverall',array['Full sleeve','Half sleeve','Zipper','Button-front','Disposable']::text[],'BOILERSUITCO',array['S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'S','5XL',null,null,true,31),
  ('Industrial & safety','Industrial uniform',array['Shirt-pant set','Two-piece uniform','Colour-coded uniform']::text[],'INDUSTRIALUN',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,32),
  ('Industrial & safety','Safety vest',array['Reflective vest','Mesh vest','Multi-pocket vest']::text[],'SAFETYVEST',array['S','M','L','XL','XXL','3XL','4XL','5XL','Adjustable']::text[],'S','5XL; adjustable',null,null,true,33),
  ('Industrial & safety','Flame-resistant coverall',array['Arc-rated','Flame-resistant','Industrial protective']::text[],'FLAMERESISTA',array['Custom']::text[],'Manufacturer-specific','Manufacturer-specific',null,'Flame-resistant, arc-rated, chemical-protective and cleanroom garments are not ordinary coats: material, seams, closures and protective performance must meet the workplace requirement.',true,34),
  ('Industrial & safety','Chemical coverall',array['Splash protection','Disposable','Reusable chemical suit']::text[],'CHEMICALCOVE',array['Custom']::text[],'Manufacturer-specific','Manufacturer-specific',null,'Flame-resistant, arc-rated, chemical-protective and cleanroom garments are not ordinary coats: material, seams, closures and protective performance must meet the workplace requirement.',true,35),
  ('Industrial & safety','Welding apron',array['Leather apron','Split-leg apron','Full-body apron']::text[],'WELDINGAPRON',array['Adjustable','Custom']::text[],'Adjustable','Custom',null,null,true,36),
  ('Industrial & safety','Industrial apron',array['PVC apron','Canvas apron','Coated-fabric apron']::text[],'INDUSTRIALAP',array['Free size','Custom']::text[],'Free size','Custom',null,null,true,37),
  ('Industrial & safety','High-visibility jacket',array['Reflective jacket','Padded safety jacket','Rain jacket']::text[],'HIGHVISIBILI',array['S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'S','5XL',null,null,true,38),
  ('Industrial & safety','Rain suit',array['Jacket and pant set','Hooded suit','PVC rainwear']::text[],'RAINSUIT',array['S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'S','5XL',null,null,true,39),
  ('Industrial & safety','ESD / Antistatic coat',array['Lab coat','ESD jacket','Cleanroom coat']::text[],'ESDANTISTATI',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,40),
  ('Industrial & safety','Cleanroom suit',array['Coverall','Hooded suit','Cleanroom gown']::text[],'CLEANROOMSUI',array['Custom']::text[],'Manufacturer-specific','Manufacturer-specific',null,'Flame-resistant, arc-rated, chemical-protective and cleanroom garments are not ordinary coats: material, seams, closures and protective performance must meet the workplace requirement.',true,41),
  ('Industrial & safety','Dust coat',array['Cotton dust coat','Industrial dust coat','Workshop coat']::text[],'DUSTCOAT',array['S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'S','5XL',null,null,true,42),
  ('Industrial & safety','Security uniform',array['Security shirt','Trouser','Blazer','Winter jacket']::text[],'SECURITYUNIF',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,43),
  ('Industrial & safety','Housekeeping uniform',array['Tunic','Shirt-pant set','Dress uniform','Apron set']::text[],'HOUSEKEEPING',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,44),
  ('Professional uniforms','Chef coat',array['Double-breasted','Single-breasted','Short sleeve','Long sleeve']::text[],'CHEFCOAT',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,45),
  ('Professional uniforms','Kitchen apron',array['Bib','Waist','Cross-back','Waterproof']::text[],'KITCHENAPRON',array['Free size','Custom']::text[],'Free size','Custom',null,null,true,46),
  ('Professional uniforms','Hotel uniform',array['Reception coat','Housekeeping dress','Service shirt']::text[],'HOTELUNIFORM',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,47),
  ('Professional uniforms','Salon uniform',array['Tunic','Beauty therapist coat','Salon apron']::text[],'SALONUNIFORM',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,48),
  ('Professional uniforms','Dental coat',array['Short coat','Long coat','Dental tunic','Scrub suit']::text[],'DENTALCOAT',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,49),
  ('Professional uniforms','Veterinary coat',array['Lab coat','Scrub suit','Protective apron']::text[],'VETERINARYCO',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,50),
  ('Professional uniforms','Factory coat',array['Button coat','Zipper coat','Pocket coat']::text[],'FACTORYCOAT',array['S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'S','5XL',null,null,true,51),
  ('Professional uniforms','Workshop uniform',array['Shirt-pant set','Coverall','Mechanic coat']::text[],'WORKSHOPUNIF',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,52),
  ('Professional uniforms','School lab coat',array['Student coat','College lab coat','Junior lab coat']::text[],'SCHOOLLABCOA',array['6 Y','8 Y','10 Y','12 Y','14 Y','16 Y','XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'Children''s sizes','5XL',null,null,true,53),
  ('Professional uniforms','Maternity uniform',array['Maternity scrub','Adjustable tunic','Nursing gown']::text[],'MATERNITYUNI',array['S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'S','5XL',null,null,true,54),
  ('Professional uniforms','Patient attendant gown',array['Wrap gown','Tie gown','Washable gown']::text[],'PATIENTATTEN',array['M','L','XL','XXL','3XL','4XL','5XL','Adjustable']::text[],'M','5XL; adjustable',null,null,true,55),
  ('Professional uniforms','Laundry uniform',array['Tunic','Shirt-pant set','Apron']::text[],'LAUNDRYUNIFO',array['XS','S','M','L','XL','XXL','3XL','4XL','5XL']::text[],'XS','5XL',null,null,true,56)
on conflict (name) do nothing;

insert into size_chart_ref (letter_size, chest, waist, sort_no) values
  ('XS','32–34','26–28',1),('S','34–36','28–30',2),('M','38–40','32–34',3),('L','42–44','36–38',4),('XL','46–48','40–42',5),
  ('XXL','50–52','44–46',6),('3XL','54–56','48–50',7),('4XL','58–60','52–54',8),('5XL','62–64','56–58',9)
on conflict (letter_size) do nothing;

insert into size_systems (name, start_size, end_size, sort_no) values
  ('Children''s uniforms','0–3 months','16 years',1),
  ('Adult letter sizes','XS','5XL',2),
  ('Men''s trousers','26 inches waist','44 inches waist',3),
  ('Men''s shirts','36 inches chest','50 inches chest',4),
  ('Coats and blazers','34 inches chest','50 inches chest',5),
  ('Adjustable aprons','Free size','Custom size',6),
  ('Special protective clothing','Manufacturer-defined','Manufacturer-defined',7)
on conflict (name) do nothing;
