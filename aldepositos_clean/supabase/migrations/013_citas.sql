-- Sistema de solicitud de citas de entrega.
-- Ejecutar en Supabase Dashboard → SQL Editor.
-- Compatible con public.perfiles O public.profiles (la que exista).

-- Rol (staff | proveedor) en la tabla de perfiles que exista
do $$
begin
  if to_regclass('public.perfiles') is not null then
    alter table public.perfiles
      add column if not exists rol text not null default 'staff';
    if not exists (
      select 1 from pg_constraint where conname = 'perfiles_rol_check'
    ) then
      alter table public.perfiles
        add constraint perfiles_rol_check
        check (rol in ('staff', 'proveedor'));
    end if;
  end if;

  if to_regclass('public.profiles') is not null then
    alter table public.profiles
      add column if not exists rol text not null default 'staff';
    if not exists (
      select 1 from pg_constraint where conname = 'profiles_rol_check'
    ) then
      alter table public.profiles
        add constraint profiles_rol_check
        check (rol in ('staff', 'proveedor'));
    end if;
  end if;

  if to_regclass('public.perfiles') is null and to_regclass('public.profiles') is null then
    raise exception
      'No existe public.perfiles ni public.profiles. Revisa Table Editor.';
  end if;
end $$;

-- Tabla principal
create table if not exists public.citas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  empresa text not null,
  contacto_nombre text not null,
  email text not null,
  telefono text not null,

  fecha_preferida date not null,
  hora_preferida text,
  bultos_estimados int,
  peso_kg_estimado numeric,
  cbm_estimado numeric,
  observaciones text,

  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'confirmada', 'rechazada', 'completada')),

  fecha_cita date,
  hora_cita text,
  respuesta_mensaje text,
  respondido_por uuid references auth.users (id) on delete set null,
  respondido_at timestamptz,

  proveedor_user_id uuid references auth.users (id) on delete set null,
  codigo_seguimiento text not null unique,

  adjuntos jsonb not null default '[]'::jsonb
);

create index if not exists citas_estado_idx on public.citas (estado);
create index if not exists citas_created_at_idx on public.citas (created_at desc);
create index if not exists citas_proveedor_user_id_idx on public.citas (proveedor_user_id);
create index if not exists citas_email_idx on public.citas (lower(email));

create or replace function public.citas_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists citas_updated_at on public.citas;
create trigger citas_updated_at
  before update on public.citas
  for each row
  execute function public.citas_set_updated_at();

alter table public.citas enable row level security;

-- ¿El usuario autenticado es staff? (lee perfiles o profiles)
create or replace function public.citas_viewer_is_staff()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rol text;
begin
  if to_regclass('public.perfiles') is not null then
    execute
      'select rol from public.perfiles where id = $1 limit 1'
      into v_rol
      using auth.uid();
    if found then
      return coalesce(v_rol, 'staff') = 'staff';
    end if;
  end if;

  if to_regclass('public.profiles') is not null then
    execute
      'select rol from public.profiles where id = $1 limit 1'
      into v_rol
      using auth.uid();
    if found then
      return coalesce(v_rol, 'staff') = 'staff';
    end if;
  end if;

  -- Sin fila de perfil: tratar como staff (comportamiento histórico del panel)
  return true;
end;
$$;

drop policy if exists "citas_select_staff_or_own" on public.citas;
create policy "citas_select_staff_or_own"
  on public.citas
  for select
  to authenticated
  using (
    proveedor_user_id = auth.uid()
    or public.citas_viewer_is_staff()
  );

drop policy if exists "citas_insert_pendiente" on public.citas;
create policy "citas_insert_pendiente"
  on public.citas
  for insert
  to anon, authenticated
  with check (estado = 'pendiente');

drop policy if exists "citas_update_staff" on public.citas;
create policy "citas_update_staff"
  on public.citas
  for update
  to authenticated
  using (public.citas_viewer_is_staff())
  with check (public.citas_viewer_is_staff());

-- Bucket Storage para adjuntos (privado; URLs firmadas o service role)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cita-adjuntos',
  'cita-adjuntos',
  false,
  15728640,
  array[
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "cita_adjuntos_select_authenticated" on storage.objects;
create policy "cita_adjuntos_select_authenticated"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'cita-adjuntos');

drop policy if exists "cita_adjuntos_insert_authenticated" on storage.objects;
create policy "cita_adjuntos_insert_authenticated"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'cita-adjuntos');

drop policy if exists "cita_adjuntos_update_staff" on storage.objects;
create policy "cita_adjuntos_update_staff"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'cita-adjuntos')
  with check (bucket_id = 'cita-adjuntos');

drop policy if exists "cita_adjuntos_delete_staff" on storage.objects;
create policy "cita_adjuntos_delete_staff"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'cita-adjuntos');
