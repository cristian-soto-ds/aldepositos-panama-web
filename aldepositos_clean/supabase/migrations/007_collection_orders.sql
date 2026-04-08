-- Órdenes de recolección (antes del RA en almacén). Mismo patrón que `tasks`: JSON en `payload`.
create table if not exists public.collection_orders (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists collection_orders_updated_at_idx
  on public.collection_orders (updated_at desc);

alter table public.collection_orders enable row level security;

create policy "collection_orders_select_authenticated"
  on public.collection_orders for select
  to authenticated
  using (true);

create policy "collection_orders_insert_authenticated"
  on public.collection_orders for insert
  to authenticated
  with check (true);

create policy "collection_orders_update_authenticated"
  on public.collection_orders for update
  to authenticated
  using (true)
  with check (true);

create policy "collection_orders_delete_authenticated"
  on public.collection_orders for delete
  to authenticated
  using (true);

-- Replica en tiempo real (si falla en tu proyecto, añade manualmente en Dashboard → Replication)
do $$
begin
  alter publication supabase_realtime add table public.collection_orders;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
