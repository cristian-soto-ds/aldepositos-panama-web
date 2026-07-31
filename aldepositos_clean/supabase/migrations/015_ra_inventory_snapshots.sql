-- Historial de inventarios por RA (copias al completar / rectificar).
-- Si ya ejecutaste este SQL en el dashboard, este archivo es solo referencia del repo.

create table if not exists public.ra_inventory_snapshots (
  id uuid primary key default gen_random_uuid(),
  task_id text not null references public.tasks (id) on delete cascade,
  ra text not null,
  kind text not null check (kind in ('initial', 'rectification')),
  version integer not null check (version >= 1),
  saved_at timestamptz not null default now(),
  saved_by_email text,
  saved_by_name text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (task_id, version)
);

create index if not exists ra_inventory_snapshots_ra_idx
  on public.ra_inventory_snapshots (ra);

create index if not exists ra_inventory_snapshots_task_id_idx
  on public.ra_inventory_snapshots (task_id);

create index if not exists ra_inventory_snapshots_saved_at_idx
  on public.ra_inventory_snapshots (saved_at desc);

create index if not exists ra_inventory_snapshots_kind_idx
  on public.ra_inventory_snapshots (kind);

comment on table public.ra_inventory_snapshots is
  'Copias de inventario: initial = primer cierre; rectification = cierres posteriores.';

alter table public.ra_inventory_snapshots enable row level security;

drop policy if exists "ra_snapshots_select_authenticated" on public.ra_inventory_snapshots;
drop policy if exists "ra_snapshots_insert_authenticated" on public.ra_inventory_snapshots;
drop policy if exists "ra_snapshots_update_authenticated" on public.ra_inventory_snapshots;
drop policy if exists "ra_snapshots_delete_authenticated" on public.ra_inventory_snapshots;

create policy "ra_snapshots_select_authenticated"
  on public.ra_inventory_snapshots for select
  to authenticated
  using (true);

create policy "ra_snapshots_insert_authenticated"
  on public.ra_inventory_snapshots for insert
  to authenticated
  with check (true);

create policy "ra_snapshots_update_authenticated"
  on public.ra_inventory_snapshots for update
  to authenticated
  using (true)
  with check (true);

create policy "ra_snapshots_delete_authenticated"
  on public.ra_inventory_snapshots for delete
  to authenticated
  using (true);

-- Opcional: rellenar initial desde RAs ya completados que aún no tienen snapshot.
-- Descomenta y ejecuta una vez si quieres historial de lo ya cerrado:
/*
insert into public.ra_inventory_snapshots (
  task_id, ra, kind, version, saved_at, saved_by_email, saved_by_name, payload
)
select
  t.id,
  coalesce(nullif(trim(t.payload->>'ra'), ''), t.id),
  'initial',
  1,
  coalesce(
    (t.payload->'inventoryCompletedBy'->>'at')::timestamptz,
    t.updated_at,
    now()
  ),
  nullif(trim(t.payload->'inventoryCompletedBy'->>'email'), ''),
  nullif(trim(t.payload->'inventoryCompletedBy'->>'displayName'), ''),
  t.payload
from public.tasks t
where coalesce(t.payload->>'status', '') = 'completed'
  and not exists (
    select 1 from public.ra_inventory_snapshots s where s.task_id = t.id
  );
*/
