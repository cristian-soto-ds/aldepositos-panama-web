-- Avatar en `public.perfiles` (tabla en español). Ejecutar en Supabase → SQL Editor
-- si aún no tienes `avatar_url` ahí. La app ya no usa `public.profiles`.

alter table public.perfiles
  add column if not exists avatar_url text;

comment on column public.perfiles.avatar_url is 'URL pública del avatar (bucket avatars).';

-- Si la FK a auth.users es la columna `uuid` y no `id`, cambia ambas líneas a: auth.uid() = uuid

drop policy if exists "perfiles_update_own_avatar" on public.perfiles;
create policy "perfiles_update_own_avatar"
  on public.perfiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);
