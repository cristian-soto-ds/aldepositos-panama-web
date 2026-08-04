-- Control de Carga: sesiones Carga/Descarga + pistoleo por bulto
-- Idempotente. Requiere is_full_access() (016/017).

create table if not exists public.warehouse_load_sessions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('carga', 'descarga')),
  container_number text not null default '',
  notes text not null default '',
  status text not null default 'abierta' check (status in ('abierta', 'cerrada')),
  created_by text null,
  created_at timestamptz not null default now(),
  closed_at timestamptz null,
  updated_at timestamptz not null default now()
);

create index if not exists warehouse_load_sessions_kind_status_idx
  on public.warehouse_load_sessions (kind, status, created_at desc);

create table if not exists public.warehouse_load_session_ras (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.warehouse_load_sessions (id) on delete cascade,
  task_id text not null default '',
  ra text not null,
  order_barcode text null,
  expected_bultos integer not null default 0 check (expected_bultos >= 0),
  client_display text null,
  shipper_label text null,
  provider text null,
  order_ref text null,
  created_at timestamptz not null default now(),
  unique (session_id, ra)
);

create index if not exists warehouse_load_session_ras_session_idx
  on public.warehouse_load_session_ras (session_id);

create table if not exists public.warehouse_package_scans (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.warehouse_load_sessions (id) on delete cascade,
  ra text not null,
  package_seq integer not null check (package_seq >= 1),
  package_barcode text not null,
  scanned_at timestamptz not null default now(),
  scanned_by_label text null,
  unique (session_id, ra, package_seq)
);

create index if not exists warehouse_package_scans_session_idx
  on public.warehouse_package_scans (session_id, scanned_at);

create index if not exists warehouse_package_scans_barcode_idx
  on public.warehouse_package_scans (package_barcode);

alter table public.warehouse_load_sessions enable row level security;
alter table public.warehouse_load_session_ras enable row level security;
alter table public.warehouse_package_scans enable row level security;

drop policy if exists wh_load_sessions_select on public.warehouse_load_sessions;
create policy wh_load_sessions_select on public.warehouse_load_sessions
  for select to authenticated using (true);
drop policy if exists wh_load_sessions_insert on public.warehouse_load_sessions;
create policy wh_load_sessions_insert on public.warehouse_load_sessions
  for insert to authenticated with check (true);
drop policy if exists wh_load_sessions_update on public.warehouse_load_sessions;
create policy wh_load_sessions_update on public.warehouse_load_sessions
  for update to authenticated using (true) with check (true);
drop policy if exists wh_load_sessions_delete on public.warehouse_load_sessions;
create policy wh_load_sessions_delete on public.warehouse_load_sessions
  for delete to authenticated using (public.is_full_access());

drop policy if exists wh_load_session_ras_select on public.warehouse_load_session_ras;
create policy wh_load_session_ras_select on public.warehouse_load_session_ras
  for select to authenticated using (true);
drop policy if exists wh_load_session_ras_insert on public.warehouse_load_session_ras;
create policy wh_load_session_ras_insert on public.warehouse_load_session_ras
  for insert to authenticated with check (true);
drop policy if exists wh_load_session_ras_update on public.warehouse_load_session_ras;
create policy wh_load_session_ras_update on public.warehouse_load_session_ras
  for update to authenticated using (true) with check (true);
drop policy if exists wh_load_session_ras_delete on public.warehouse_load_session_ras;
create policy wh_load_session_ras_delete on public.warehouse_load_session_ras
  for delete to authenticated using (true);

drop policy if exists wh_package_scans_select on public.warehouse_package_scans;
create policy wh_package_scans_select on public.warehouse_package_scans
  for select to authenticated using (true);
drop policy if exists wh_package_scans_insert on public.warehouse_package_scans;
create policy wh_package_scans_insert on public.warehouse_package_scans
  for insert to authenticated with check (true);
-- Append-only: sin update. Delete solo full_access.
drop policy if exists wh_package_scans_delete on public.warehouse_package_scans;
create policy wh_package_scans_delete on public.warehouse_package_scans
  for delete to authenticated using (public.is_full_access());

grant select, insert, update, delete on public.warehouse_load_sessions to authenticated;
grant select, insert, update, delete on public.warehouse_load_session_ras to authenticated;
grant select, insert, delete on public.warehouse_package_scans to authenticated;
