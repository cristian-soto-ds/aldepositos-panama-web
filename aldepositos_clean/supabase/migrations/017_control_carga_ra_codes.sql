-- Control de Carga: códigos por RA + aliases IMPOMEX DE COLOMBIA LTDA
-- Idempotente. No modifica tasks.payload.
-- Requiere 016 (warehouse_clients / warehouse_shippers) si ya está aplicada;
-- si no, crea lo mínimo necesario para clientes y expedidores.

-- ─── Helpers de rol (por si 016 aún no se aplicó) ───────────────────────────
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

-- ─── Clientes (mínimo si 016 no existe) ─────────────────────────────────────
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
  (
    'IMPOMEX',
    'IMPOMEX DE COLOMBIA LTDA',
    '["IMPOMEX", "IMPOMEX DE COLOMBIA LTDA"]'::jsonb
  )
on conflict (code) do nothing;

-- Actualizar display + aliases IMPOMEX (sin inventar otros nombres)
update public.warehouse_clients
set
  display_name = 'IMPOMEX DE COLOMBIA LTDA',
  aliases = (
    select jsonb_agg(distinct v)
    from jsonb_array_elements_text(
      coalesce(aliases, '[]'::jsonb)
      || '["IMPOMEX", "IMPOMEX DE COLOMBIA LTDA"]'::jsonb
    ) as t(v)
  ),
  updated_at = now()
where code = 'IMPOMEX';

-- ─── Expedidores (mínimo si 016 no existe) ──────────────────────────────────
create table if not exists public.warehouse_shippers (
  id uuid primary key default gen_random_uuid(),
  client_code text not null references public.warehouse_clients (code),
  group_id uuid,
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
  if code is null or code = '' then
    raise exception 'client_code requerido';
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

-- ─── Códigos únicos por RA (task_id) ────────────────────────────────────────
create table if not exists public.warehouse_ra_code_seq (
  client_code text primary key references public.warehouse_clients (code),
  last_n integer not null default 0
);

insert into public.warehouse_ra_code_seq (client_code, last_n)
values ('AAA', 0), ('JH', 0), ('IMPOMEX', 0)
on conflict (client_code) do nothing;

create or replace function public.next_ra_barcode(p_client_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  code text := upper(trim(p_client_code));
begin
  if code is null or code = '' then
    raise exception 'client_code requerido';
  end if;
  insert into public.warehouse_ra_code_seq (client_code, last_n)
  values (code, 0)
  on conflict (client_code) do nothing;
  update public.warehouse_ra_code_seq
  set last_n = last_n + 1
  where client_code = code
  returning last_n into n;
  return 'RA-' || code || '-' || lpad(n::text, 6, '0');
end;
$$;

grant execute on function public.next_ra_barcode(text) to authenticated;

create table if not exists public.warehouse_ra_codes (
  id uuid primary key default gen_random_uuid(),
  task_id text not null unique,
  ra text not null,
  client_code text not null references public.warehouse_clients (code),
  shipper_id uuid references public.warehouse_shippers (id) on delete set null,
  barcode_code text not null unique,
  provider text,
  order_ref text,
  shipper_label text,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists warehouse_ra_codes_client_idx
  on public.warehouse_ra_codes (client_code);
create index if not exists warehouse_ra_codes_ra_idx
  on public.warehouse_ra_codes (ra);

alter table public.warehouse_clients enable row level security;
alter table public.warehouse_shippers enable row level security;
alter table public.warehouse_shipper_seq enable row level security;
alter table public.warehouse_ra_codes enable row level security;
alter table public.warehouse_ra_code_seq enable row level security;

drop policy if exists wh_clients_select on public.warehouse_clients;
create policy wh_clients_select on public.warehouse_clients
  for select to authenticated using (true);
drop policy if exists wh_clients_write on public.warehouse_clients;
create policy wh_clients_write on public.warehouse_clients
  for all to authenticated
  using (public.is_full_access())
  with check (public.is_full_access());

drop policy if exists wh_shippers_select on public.warehouse_shippers;
create policy wh_shippers_select on public.warehouse_shippers
  for select to authenticated using (true);
drop policy if exists wh_shippers_write on public.warehouse_shippers;
create policy wh_shippers_write on public.warehouse_shippers
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists wh_shipper_seq_all on public.warehouse_shipper_seq;
create policy wh_shipper_seq_all on public.warehouse_shipper_seq
  for all to authenticated using (true) with check (true);

drop policy if exists wh_ra_codes_select on public.warehouse_ra_codes;
create policy wh_ra_codes_select on public.warehouse_ra_codes
  for select to authenticated using (true);
drop policy if exists wh_ra_codes_insert on public.warehouse_ra_codes;
create policy wh_ra_codes_insert on public.warehouse_ra_codes
  for insert to authenticated with check (true);
drop policy if exists wh_ra_codes_update on public.warehouse_ra_codes;
create policy wh_ra_codes_update on public.warehouse_ra_codes
  for update to authenticated using (true) with check (true);

drop policy if exists wh_ra_code_seq_all on public.warehouse_ra_code_seq;
create policy wh_ra_code_seq_all on public.warehouse_ra_code_seq
  for all to authenticated using (true) with check (true);

grant select, insert, update on public.warehouse_ra_codes to authenticated;
grant select, insert, update on public.warehouse_shippers to authenticated;
grant select, update on public.warehouse_clients to authenticated;
grant select, insert, update on public.warehouse_shipper_seq to authenticated;
grant select, insert, update on public.warehouse_ra_code_seq to authenticated;
