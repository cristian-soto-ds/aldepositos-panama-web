-- Cargues de contenedores (relación de cargue): lista ordenada de RA por contenedor.
-- La pertenencia vive solo aquí (items), no en tasks.payload.
create table if not exists public.container_loads (
  id text primary key,
  name text not null check (char_length(trim(name)) between 1 and 200),
  status text not null default 'open' check (status in ('open', 'closed')),
  source_file_name text null,
  items jsonb not null default '[]'::jsonb,
  created_by_email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz null
);

create index if not exists container_loads_status_created_idx
  on public.container_loads (status, created_at desc);

alter table public.container_loads enable row level security;

drop policy if exists "container_loads_select_authenticated" on public.container_loads;
create policy "container_loads_select_authenticated"
  on public.container_loads for select
  to authenticated
  using (true);

drop policy if exists "container_loads_insert_authenticated" on public.container_loads;
create policy "container_loads_insert_authenticated"
  on public.container_loads for insert
  to authenticated
  with check (true);

drop policy if exists "container_loads_update_authenticated" on public.container_loads;
create policy "container_loads_update_authenticated"
  on public.container_loads for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "container_loads_delete_authenticated" on public.container_loads;
create policy "container_loads_delete_authenticated"
  on public.container_loads for delete
  to authenticated
  using (true);

do $$
begin
  alter publication supabase_realtime add table public.container_loads;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
