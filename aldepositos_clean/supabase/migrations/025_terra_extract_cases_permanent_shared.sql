-- Casos Terra permanentes y compartidos (archivo del equipo).
-- Antes: solo veías tus casos + límite de ~100 en la app → parecía que “se borraban”.
-- Ahora: todos los autenticados leen/actualizan; no hay borrado por RLS; user_id
-- no cascadea al borrar un usuario.

-- 1) Conservar filas si se elimina el usuario autor
alter table public.terra_extract_cases
  alter column user_id drop not null;

alter table public.terra_extract_cases
  drop constraint if exists terra_extract_cases_user_id_fkey;

alter table public.terra_extract_cases
  add constraint terra_extract_cases_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;

-- 2) RLS: archivo compartido (sin delete)
drop policy if exists "terra_extract_cases_select_own" on public.terra_extract_cases;
drop policy if exists "terra_extract_cases_insert_own" on public.terra_extract_cases;
drop policy if exists "terra_extract_cases_update_own" on public.terra_extract_cases;
drop policy if exists "terra_extract_cases_delete_own" on public.terra_extract_cases;

create policy "terra_extract_cases_select_authenticated"
  on public.terra_extract_cases for select
  to authenticated
  using (true);

create policy "terra_extract_cases_insert_authenticated"
  on public.terra_extract_cases for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "terra_extract_cases_update_authenticated"
  on public.terra_extract_cases for update
  to authenticated
  using (true)
  with check (true);

-- Sin policy DELETE: los casos no se borran desde la app autenticada.

-- 3) Storage: cualquier autenticado puede leer evidencias del equipo;
--    subir/actualizar/borrar archivos solo en su carpeta.
drop policy if exists "terra_extract_cases_select_own" on storage.objects;
create policy "terra_extract_cases_select_authenticated"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'terra-extract-cases');

-- Insert/update/delete de storage se mantienen scoped al uid (ya creados en 024).
-- Renombrar no hace falta si siguen existiendo.

create index if not exists terra_extract_cases_created_idx
  on public.terra_extract_cases (created_at desc);

create index if not exists terra_extract_cases_status_created_idx
  on public.terra_extract_cases (status, created_at desc);
