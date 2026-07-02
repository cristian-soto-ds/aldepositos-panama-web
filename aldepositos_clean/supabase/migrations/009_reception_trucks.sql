-- Tabla para sincronización en tiempo real — Dirección de camiones
-- Ejecuta en Supabase SQL Editor para sincronizar operador y pantalla TV.

create table if not exists public.reception_trucks (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists reception_trucks_updated_at_idx
  on public.reception_trucks (updated_at desc);

alter table public.reception_trucks enable row level security;

create policy "reception_trucks_auth_all"
  on public.reception_trucks
  for all
  to authenticated
  using (true)
  with check (true);

create policy "reception_trucks_anon_read"
  on public.reception_trucks
  for select
  to anon
  using (true);

do $$
begin
  alter publication supabase_realtime add table public.reception_trucks;
exception
  when duplicate_object then null;
end $$;
