-- Inventarios parciales (RA → contenedor / EN ALMACÉN).
-- Payload JSON: InventoryPartialJob

create table if not exists public.inventory_partials (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists inventory_partials_updated_at_idx
  on public.inventory_partials (updated_at desc);

create index if not exists inventory_partials_task_id_idx
  on public.inventory_partials ((payload->>'taskId'));

create index if not exists inventory_partials_status_idx
  on public.inventory_partials ((payload->>'status'));

comment on table public.inventory_partials is
  'Jobs de inventario parcial: admin asigna contenedor; inventariador marca EN ALMACÉN.';

alter table public.inventory_partials enable row level security;

drop policy if exists "inventory_partials_select_authenticated" on public.inventory_partials;
drop policy if exists "inventory_partials_insert_authenticated" on public.inventory_partials;
drop policy if exists "inventory_partials_update_authenticated" on public.inventory_partials;
drop policy if exists "inventory_partials_delete_authenticated" on public.inventory_partials;

create policy "inventory_partials_select_authenticated"
  on public.inventory_partials for select
  to authenticated
  using (true);

create policy "inventory_partials_insert_authenticated"
  on public.inventory_partials for insert
  to authenticated
  with check (true);

create policy "inventory_partials_update_authenticated"
  on public.inventory_partials for update
  to authenticated
  using (true)
  with check (true);

create policy "inventory_partials_delete_authenticated"
  on public.inventory_partials for delete
  to authenticated
  using (true);
