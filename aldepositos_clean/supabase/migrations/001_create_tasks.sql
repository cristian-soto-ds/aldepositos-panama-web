-- Tabla principal de órdenes (RA). El campo `payload` guarda el objeto Task completo en JSON.
-- Ejecuta este script en: Supabase Dashboard → SQL Editor → New query → Run

create table if not exists public.tasks (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists tasks_updated_at_idx on public.tasks (updated_at desc);

alter table public.tasks enable row level security;

-- Solo usuarios autenticados (misma sesión que /login con Supabase Auth)
create policy "tasks_select_authenticated"
  on public.tasks for select
  to authenticated
  using (true);

create policy "tasks_insert_authenticated"
  on public.tasks for insert
  to authenticated
  with check (true);

create policy "tasks_update_authenticated"
  on public.tasks for update
  to authenticated
  using (true)
  with check (true);

create policy "tasks_delete_authenticated"
  on public.tasks for delete
  to authenticated
  using (true);

-- Realtime: añade la tabla a la publicación (Supabase Dashboard → Database → Replication,
-- o ejecuta la línea siguiente si tu proyecto lo permite)
alter publication supabase_realtime add table public.tasks;
