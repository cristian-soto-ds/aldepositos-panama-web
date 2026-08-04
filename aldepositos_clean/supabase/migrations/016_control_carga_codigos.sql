-- Control de carga por códigos de barras (AAA / JH / IMPOMEX)
-- Idempotente. No modifica tasks.payload ni migraciones anteriores.

-- ─── Helpers de rol (admin = full_access) ───────────────────────────────────
create or replace function public.current_user_role()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r text;
begin
  if auth.uid() is null then
    return null;
  end if;

  if to_regclass('public.profiles') is not null then
    select lower(trim(rol)) into r from public.profiles where id = auth.uid() limit 1;
  end if;

  if r is null and to_regclass('public.perfiles') is not null then
    select lower(trim(rol)) into r
    from public.perfiles
    where id = auth.uid() or uuid = auth.uid()
    limit 1;
  end if;

  if r is null or r = '' then
    return 'admin';
  end if;
  return r;
end;
$$;

create or replace function public.is_full_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role(), 'admin') in ('admin', 'full_access');
$$;

revoke all on function public.current_user_role() from public;
revoke all on function public.is_full_access() from public;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_full_access() to authenticated;

-- ─── Clientes canónicos ─────────────────────────────────────────────────────
create table if not exists public.warehouse_clients (
  code text primary key,
  display_name text not null,
  aliases jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.warehouse_clients (code, display_name, aliases)
values
  ('AAA', 'AAA', '["AAA"]'::jsonb),
  ('JH', 'JH', '["JH"]'::jsonb),
  ('IMPOMEX', 'IMPOMEX', '["IMPOMEX"]'::jsonb)
on conflict (code) do nothing;

-- ─── Grupos de expedidores ──────────────────────────────────────────────────
create table if not exists public.warehouse_shipper_groups (
  id uuid primary key default gen_random_uuid(),
  client_code text not null references public.warehouse_clients (code),
  barcode_code text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists warehouse_shipper_groups_client_idx
  on public.warehouse_shipper_groups (client_code);

-- ─── Expedidores ────────────────────────────────────────────────────────────
create table if not exists public.warehouse_shippers (
  id uuid primary key default gen_random_uuid(),
  client_code text not null references public.warehouse_clients (code),
  group_id uuid references public.warehouse_shipper_groups (id) on delete set null,
  barcode_code text not null unique,
  official_name text not null,
  normalized_name text not null,
  supplier text,
  aliases jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists warehouse_shippers_client_idx
  on public.warehouse_shippers (client_code);
create index if not exists warehouse_shippers_normalized_idx
  on public.warehouse_shippers (client_code, normalized_name);

-- Secuencia segura para códigos EXP-{CLIENT}-####
create table if not exists public.warehouse_shipper_seq (
  client_code text primary key references public.warehouse_clients (code),
  last_n integer not null default 0
);

insert into public.warehouse_shipper_seq (client_code, last_n)
values ('AAA', 0), ('JH', 0), ('IMPOMEX', 0)
on conflict (client_code) do nothing;

create or replace function public.next_shipper_barcode(p_client_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  code text := upper(trim(p_client_code));
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;
  if not public.is_full_access() then
    raise exception 'Solo full_access puede crear expedidores';
  end if;
  insert into public.warehouse_shipper_seq (client_code, last_n)
  values (code, 0)
  on conflict (client_code) do nothing;

  update public.warehouse_shipper_seq
  set last_n = last_n + 1
  where client_code = code
  returning last_n into n;

  return 'EXP-' || code || '-' || lpad(n::text, 4, '0');
end;
$$;

grant execute on function public.next_shipper_barcode(text) to authenticated;

-- ─── Ubicaciones ────────────────────────────────────────────────────────────
create table if not exists public.warehouse_locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.warehouse_locations (code, description)
values
  ('STAGING-01', 'Zona de staging 01'),
  ('PISO-BODEGA-01', 'Piso bodega 01'),
  ('RACK-A03-N02', 'Rack A03 nivel 02')
on conflict (code) do nothing;

-- ─── Unidades de carga (pallets) ────────────────────────────────────────────
create table if not exists public.warehouse_cargo_units (
  id uuid primary key default gen_random_uuid(),
  task_id text not null references public.tasks (id) on delete restrict,
  ra text not null,
  client_code text not null references public.warehouse_clients (code),
  shipper_id uuid references public.warehouse_shippers (id) on delete set null,
  provider text,
  order_ref text,
  barcode_code text not null unique,
  pallet_number integer not null check (pallet_number >= 1),
  initial_bultos numeric not null check (initial_bultos >= 0),
  received_bultos numeric not null default 0 check (received_bultos >= 0),
  available_bultos numeric not null default 0 check (available_bultos >= 0),
  loaded_bultos numeric not null default 0 check (loaded_bultos >= 0),
  weight numeric,
  cbm numeric,
  location_id uuid references public.warehouse_locations (id) on delete set null,
  status text not null default 'PREPARADA'
    check (status in (
      'PREPARADA', 'RECIBIDA', 'UBICADA', 'CARGA_PARCIAL', 'CARGADA', 'AJUSTADA'
    )),
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, pallet_number)
);

create index if not exists warehouse_cargo_units_client_idx
  on public.warehouse_cargo_units (client_code);
create index if not exists warehouse_cargo_units_ra_idx
  on public.warehouse_cargo_units (ra);
create index if not exists warehouse_cargo_units_task_idx
  on public.warehouse_cargo_units (task_id);

-- ─── Despachos ──────────────────────────────────────────────────────────────
create table if not exists public.warehouse_dispatches (
  id uuid primary key default gen_random_uuid(),
  dispatch_code text not null unique,
  container_number text,
  collection_order text,
  client_code text not null references public.warehouse_clients (code),
  shipper_id uuid references public.warehouse_shippers (id) on delete set null,
  ramp text,
  planned_bultos numeric not null default 0,
  scanned_bultos numeric not null default 0,
  status text not null default 'ABIERTO'
    check (status in ('ABIERTO', 'CERRADO', 'CERRADO_CON_DIFERENCIAS')),
  notes text,
  opened_by uuid,
  opened_at timestamptz not null default now(),
  closed_by uuid,
  closed_at timestamptz
);

create index if not exists warehouse_dispatches_client_idx
  on public.warehouse_dispatches (client_code);

create table if not exists public.warehouse_dispatch_seq (
  client_code text primary key references public.warehouse_clients (code),
  last_n integer not null default 0
);

insert into public.warehouse_dispatch_seq (client_code, last_n)
values ('AAA', 0), ('JH', 0), ('IMPOMEX', 0)
on conflict (client_code) do nothing;

create or replace function public.next_dispatch_code(p_client_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  code text := upper(trim(p_client_code));
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;
  insert into public.warehouse_dispatch_seq (client_code, last_n)
  values (code, 0)
  on conflict (client_code) do nothing;
  update public.warehouse_dispatch_seq
  set last_n = last_n + 1
  where client_code = code
  returning last_n into n;
  return 'DSP-' || code || '-' || lpad(n::text, 5, '0');
end;
$$;

grant execute on function public.next_dispatch_code(text) to authenticated;

-- ─── Eventos de escaneo (auditoría) ─────────────────────────────────────────
create table if not exists public.warehouse_scan_events (
  id uuid primary key default gen_random_uuid(),
  client_event_id uuid not null unique,
  cargo_unit_id uuid references public.warehouse_cargo_units (id) on delete restrict,
  dispatch_id uuid references public.warehouse_dispatches (id) on delete set null,
  operation text not null check (operation in ('RECIBIR', 'UBICAR', 'CARGAR', 'AJUSTAR')),
  quantity numeric not null,
  previous_balance numeric,
  new_balance numeric,
  previous_location_id uuid references public.warehouse_locations (id),
  new_location_id uuid references public.warehouse_locations (id),
  user_id uuid,
  notes text,
  is_incident boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists warehouse_scan_events_unit_idx
  on public.warehouse_scan_events (cargo_unit_id);
create index if not exists warehouse_scan_events_created_idx
  on public.warehouse_scan_events (created_at desc);

-- ─── RLS ────────────────────────────────────────────────────────────────────
alter table public.warehouse_clients enable row level security;
alter table public.warehouse_shipper_groups enable row level security;
alter table public.warehouse_shippers enable row level security;
alter table public.warehouse_locations enable row level security;
alter table public.warehouse_cargo_units enable row level security;
alter table public.warehouse_dispatches enable row level security;
alter table public.warehouse_scan_events enable row level security;
alter table public.warehouse_shipper_seq enable row level security;
alter table public.warehouse_dispatch_seq enable row level security;

-- Clients: todos autenticados leen; solo full_access escribe
drop policy if exists wh_clients_select on public.warehouse_clients;
create policy wh_clients_select on public.warehouse_clients
  for select to authenticated using (true);
drop policy if exists wh_clients_write on public.warehouse_clients;
create policy wh_clients_write on public.warehouse_clients
  for all to authenticated
  using (public.is_full_access())
  with check (public.is_full_access());

drop policy if exists wh_shipper_groups_select on public.warehouse_shipper_groups;
create policy wh_shipper_groups_select on public.warehouse_shipper_groups
  for select to authenticated using (true);
drop policy if exists wh_shipper_groups_write on public.warehouse_shipper_groups;
create policy wh_shipper_groups_write on public.warehouse_shipper_groups
  for all to authenticated
  using (public.is_full_access())
  with check (public.is_full_access());

drop policy if exists wh_shippers_select on public.warehouse_shippers;
create policy wh_shippers_select on public.warehouse_shippers
  for select to authenticated using (true);
drop policy if exists wh_shippers_write on public.warehouse_shippers;
create policy wh_shippers_write on public.warehouse_shippers
  for all to authenticated
  using (public.is_full_access())
  with check (public.is_full_access());

drop policy if exists wh_locations_select on public.warehouse_locations;
create policy wh_locations_select on public.warehouse_locations
  for select to authenticated using (true);
drop policy if exists wh_locations_write on public.warehouse_locations;
create policy wh_locations_write on public.warehouse_locations
  for all to authenticated
  using (public.is_full_access())
  with check (public.is_full_access());

drop policy if exists wh_units_select on public.warehouse_cargo_units;
create policy wh_units_select on public.warehouse_cargo_units
  for select to authenticated using (true);
drop policy if exists wh_units_insert on public.warehouse_cargo_units;
create policy wh_units_insert on public.warehouse_cargo_units
  for insert to authenticated with check (true);
drop policy if exists wh_units_update on public.warehouse_cargo_units;
create policy wh_units_update on public.warehouse_cargo_units
  for update to authenticated using (true) with check (true);
drop policy if exists wh_units_delete on public.warehouse_cargo_units;
create policy wh_units_delete on public.warehouse_cargo_units
  for delete to authenticated using (public.is_full_access());

drop policy if exists wh_dispatches_select on public.warehouse_dispatches;
create policy wh_dispatches_select on public.warehouse_dispatches
  for select to authenticated using (true);
drop policy if exists wh_dispatches_insert on public.warehouse_dispatches;
create policy wh_dispatches_insert on public.warehouse_dispatches
  for insert to authenticated with check (true);
drop policy if exists wh_dispatches_update on public.warehouse_dispatches;
create policy wh_dispatches_update on public.warehouse_dispatches
  for update to authenticated using (true) with check (true);
drop policy if exists wh_dispatches_delete on public.warehouse_dispatches;
create policy wh_dispatches_delete on public.warehouse_dispatches
  for delete to authenticated using (public.is_full_access());

drop policy if exists wh_events_select on public.warehouse_scan_events;
create policy wh_events_select on public.warehouse_scan_events
  for select to authenticated using (true);
drop policy if exists wh_events_insert on public.warehouse_scan_events;
create policy wh_events_insert on public.warehouse_scan_events
  for insert to authenticated with check (true);
-- Sin UPDATE/DELETE de eventos (auditoría permanente); ajustes vía AJUSTAR

drop policy if exists wh_shipper_seq_all on public.warehouse_shipper_seq;
create policy wh_shipper_seq_all on public.warehouse_shipper_seq
  for all to authenticated
  using (public.is_full_access())
  with check (public.is_full_access());

drop policy if exists wh_dispatch_seq_all on public.warehouse_dispatch_seq;
create policy wh_dispatch_seq_all on public.warehouse_dispatch_seq
  for all to authenticated using (true) with check (true);

-- ─── RPC atómica de escaneo ─────────────────────────────────────────────────
create or replace function public.process_warehouse_scan(
  p_client_event_id uuid,
  p_barcode_code text,
  p_operation text,
  p_quantity numeric default 0,
  p_location_code text default null,
  p_dispatch_id uuid default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_unit public.warehouse_cargo_units%rowtype;
  v_dispatch public.warehouse_dispatches%rowtype;
  v_loc_id uuid;
  v_prev_bal numeric;
  v_new_bal numeric;
  v_prev_loc uuid;
  v_qty numeric := coalesce(p_quantity, 0);
  v_op text := upper(trim(p_operation));
  v_existing uuid;
  v_shipper_name text;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'message', 'No autenticado');
  end if;

  v_role := public.current_user_role();

  if v_op not in ('RECIBIR', 'UBICAR', 'CARGAR', 'AJUSTAR') then
    return jsonb_build_object('success', false, 'message', 'Operación inválida');
  end if;

  if v_op = 'AJUSTAR' and not public.is_full_access() then
    return jsonb_build_object('success', false, 'message', 'Sin permiso para AJUSTAR');
  end if;

  select id into v_existing
  from public.warehouse_scan_events
  where client_event_id = p_client_event_id;
  if v_existing is not null then
    return jsonb_build_object(
      'success', true,
      'message', 'Evento ya registrado (idempotente)',
      'operation', v_op,
      'duplicate', true
    );
  end if;

  select * into v_unit
  from public.warehouse_cargo_units
  where barcode_code = upper(trim(p_barcode_code))
  for update;

  if not found then
    return jsonb_build_object('success', false, 'message', 'Código no encontrado');
  end if;

  v_prev_bal := v_unit.available_bultos;
  v_prev_loc := v_unit.location_id;

  if p_location_code is not null and trim(p_location_code) <> '' then
    select id into v_loc_id
    from public.warehouse_locations
    where code = upper(trim(p_location_code)) and active = true;
    if v_loc_id is null then
      return jsonb_build_object('success', false, 'message', 'Ubicación no encontrada');
    end if;
  end if;

  if p_dispatch_id is not null then
    select * into v_dispatch
    from public.warehouse_dispatches
    where id = p_dispatch_id
    for update;
    if not found then
      return jsonb_build_object('success', false, 'message', 'Despacho no encontrado');
    end if;
    if v_dispatch.status <> 'ABIERTO' then
      return jsonb_build_object('success', false, 'message', 'Despacho cerrado');
    end if;
    if v_dispatch.client_code <> v_unit.client_code then
      return jsonb_build_object('success', false, 'message', 'Cliente del despacho no coincide');
    end if;
    if v_dispatch.shipper_id is not null
       and v_unit.shipper_id is not null
       and v_dispatch.shipper_id <> v_unit.shipper_id then
      return jsonb_build_object('success', false, 'message', 'Expedidor del despacho no coincide');
    end if;
  end if;

  if v_op = 'RECIBIR' then
    if v_qty <= 0 then
      v_qty := v_unit.initial_bultos - v_unit.received_bultos;
    end if;
    if v_qty <= 0 then
      return jsonb_build_object('success', false, 'message', 'Nada por recibir');
    end if;
    if v_unit.received_bultos + v_qty > v_unit.initial_bultos then
      return jsonb_build_object('success', false, 'message', 'No se puede recibir más de lo esperado');
    end if;
    v_unit.received_bultos := v_unit.received_bultos + v_qty;
    v_unit.available_bultos := v_unit.available_bultos + v_qty;
    v_unit.status := 'RECIBIDA';
    if v_loc_id is not null then
      v_unit.location_id := v_loc_id;
    end if;

  elsif v_op = 'UBICAR' then
    if v_loc_id is null then
      return jsonb_build_object('success', false, 'message', 'Ubicación requerida');
    end if;
    v_unit.location_id := v_loc_id;
    if v_unit.status in ('PREPARADA', 'RECIBIDA') then
      v_unit.status := 'UBICADA';
    end if;
    v_qty := 0;

  elsif v_op = 'CARGAR' then
    if p_dispatch_id is null then
      return jsonb_build_object('success', false, 'message', 'Despacho requerido para CARGAR');
    end if;
    if v_qty <= 0 then
      v_qty := v_unit.available_bultos;
    end if;
    if v_qty <= 0 or v_unit.available_bultos < v_qty then
      return jsonb_build_object('success', false, 'message', 'Saldo insuficiente');
    end if;
    v_unit.available_bultos := v_unit.available_bultos - v_qty;
    v_unit.loaded_bultos := v_unit.loaded_bultos + v_qty;
    if v_unit.available_bultos = 0 then
      v_unit.status := 'CARGADA';
    else
      v_unit.status := 'CARGA_PARCIAL';
    end if;
    update public.warehouse_dispatches
    set scanned_bultos = scanned_bultos + v_qty
    where id = p_dispatch_id;

  elsif v_op = 'AJUSTAR' then
    -- p_quantity = nuevo saldo disponible absoluto
    if v_qty < 0 then
      return jsonb_build_object('success', false, 'message', 'Saldo no puede ser negativo');
    end if;
    v_unit.available_bultos := v_qty;
    v_unit.status := 'AJUSTADA';
  end if;

  v_new_bal := v_unit.available_bultos;
  v_unit.updated_at := now();

  update public.warehouse_cargo_units set
    received_bultos = v_unit.received_bultos,
    available_bultos = v_unit.available_bultos,
    loaded_bultos = v_unit.loaded_bultos,
    location_id = v_unit.location_id,
    status = v_unit.status,
    updated_at = v_unit.updated_at
  where id = v_unit.id;

  insert into public.warehouse_scan_events (
    client_event_id, cargo_unit_id, dispatch_id, operation, quantity,
    previous_balance, new_balance, previous_location_id, new_location_id,
    user_id, notes, is_incident
  ) values (
    p_client_event_id, v_unit.id, p_dispatch_id, v_op, v_qty,
    v_prev_bal, v_new_bal, v_prev_loc, v_unit.location_id,
    v_uid, p_notes, false
  );

  select official_name into v_shipper_name
  from public.warehouse_shippers where id = v_unit.shipper_id;

  return jsonb_build_object(
    'success', true,
    'message', 'OK',
    'operation', v_op,
    'ra', v_unit.ra,
    'client', v_unit.client_code,
    'shipper', coalesce(v_shipper_name, 'PENDIENTE DE ASIGNAR'),
    'provider', coalesce(v_unit.provider, ''),
    'order_ref', coalesce(v_unit.order_ref, ''),
    'pallet', v_unit.pallet_number,
    'barcode', v_unit.barcode_code,
    'previous_balance', v_prev_bal,
    'new_balance', v_new_bal,
    'status', v_unit.status,
    'duplicate', false
  );
end;
$$;

grant execute on function public.process_warehouse_scan(uuid, text, text, numeric, text, uuid, text)
  to authenticated;

comment on table public.warehouse_cargo_units is
  'Unidades/pallets con código corto ALD-{RA}-P{nn}; etiqueta muestra expedidor/pedido/ref.';
