-- Corrige el error: imagen subida OK pero "la base rechazó guardar avatar_url (RLS)".
-- Ejecuta TODO este script en Supabase → SQL Editor (una vez).
--
-- Causa habitual: la política UPDATE usa auth.uid() = id pero tu fila enlaza por la columna `uuid`,
-- o no hay ninguna política UPDATE para usuarios autenticados.

alter table public.perfiles
  add column if not exists avatar_url text;

alter table public.perfiles enable row level security;

drop policy if exists "perfiles_update_own_avatar" on public.perfiles;
drop policy if exists "perfiles_update_own_row" on public.perfiles;

-- Crea una sola política según qué columnas existan en public.perfiles
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'perfiles'
      and column_name = 'id'
  )
     and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'perfiles'
      and column_name = 'uuid'
  ) then
    execute $pol$
      create policy "perfiles_update_own_row"
        on public.perfiles
        for update
        to authenticated
        using (auth.uid() = id or auth.uid() = uuid)
        with check (auth.uid() = id or auth.uid() = uuid)
    $pol$;
  elsif exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'perfiles'
      and column_name = 'uuid'
  ) then
    execute $pol$
      create policy "perfiles_update_own_row"
        on public.perfiles
        for update
        to authenticated
        using (auth.uid() = uuid)
        with check (auth.uid() = uuid)
    $pol$;
  elsif exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'perfiles'
      and column_name = 'user_id'
  ) then
    execute $pol$
      create policy "perfiles_update_own_row"
        on public.perfiles
        for update
        to authenticated
        using (auth.uid() = user_id)
        with check (auth.uid() = user_id)
    $pol$;
  elsif exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'perfiles'
      and column_name = 'id'
  ) then
    execute $pol$
      create policy "perfiles_update_own_row"
        on public.perfiles
        for update
        to authenticated
        using (auth.uid() = id)
        with check (auth.uid() = id)
    $pol$;
  end if;
end $$;

comment on column public.perfiles.avatar_url is 'URL pública del avatar (bucket avatars).';
