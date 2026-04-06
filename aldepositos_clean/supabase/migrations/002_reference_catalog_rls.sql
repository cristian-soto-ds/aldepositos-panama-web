-- Políticas RLS para public.reference_catalog (catálogo maestro).
-- Ejecuta en Supabase → SQL Editor si aún no tienes políticas.
-- Ajusta los roles o condiciones si necesitas restringir quién puede editar.

alter table public.reference_catalog enable row level security;

drop policy if exists "reference_catalog_select_authenticated" on public.reference_catalog;
drop policy if exists "reference_catalog_insert_authenticated" on public.reference_catalog;
drop policy if exists "reference_catalog_update_authenticated" on public.reference_catalog;
drop policy if exists "reference_catalog_delete_authenticated" on public.reference_catalog;

create policy "reference_catalog_select_authenticated"
  on public.reference_catalog
  for select
  to authenticated
  using (true);

create policy "reference_catalog_insert_authenticated"
  on public.reference_catalog
  for insert
  to authenticated
  with check (true);

create policy "reference_catalog_update_authenticated"
  on public.reference_catalog
  for update
  to authenticated
  using (true)
  with check (true);

create policy "reference_catalog_delete_authenticated"
  on public.reference_catalog
  for delete
  to authenticated
  using (true);
