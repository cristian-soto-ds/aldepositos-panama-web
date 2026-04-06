-- Foto de perfil pública vía URL (Storage). Ejecutar en Supabase → SQL Editor.

alter table public.profiles
  add column if not exists avatar_url text;

comment on column public.profiles.avatar_url is 'URL pública del avatar (bucket avatars).';

-- Actualizar solo la propia fila (avatar_url). Si ya tienes una política UPDATE equivalente, omite esto.

drop policy if exists "profiles_update_own_avatar" on public.profiles;
create policy "profiles_update_own_avatar"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);
