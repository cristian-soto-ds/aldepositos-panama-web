-- Lectura de avatar/nombre para el ranking y presencia del equipo.
-- Usa public.perfiles O public.profiles (la que exista en tu proyecto).
-- Sin SELECT el ranking solo muestra iniciales.

do $$
begin
  -- Tabla en español
  if to_regclass('public.perfiles') is not null then
    alter table public.perfiles enable row level security;

    drop policy if exists "perfiles_select_authenticated_avatars" on public.perfiles;
    create policy "perfiles_select_authenticated_avatars"
      on public.perfiles
      for select
      to authenticated
      using (true);

    comment on policy "perfiles_select_authenticated_avatars" on public.perfiles is
      'Usuarios del panel pueden ver perfiles (avatar/nombre) para ranking y equipo.';
  end if;

  -- Tabla en inglés (muchos proyectos de producción)
  if to_regclass('public.profiles') is not null then
    alter table public.profiles enable row level security;

    drop policy if exists "profiles_select_authenticated_avatars" on public.profiles;
    create policy "profiles_select_authenticated_avatars"
      on public.profiles
      for select
      to authenticated
      using (true);

    comment on policy "profiles_select_authenticated_avatars" on public.profiles is
      'Panel users can read profiles (avatar/name) for ranking and team.';
  end if;

  if to_regclass('public.perfiles') is null and to_regclass('public.profiles') is null then
    raise exception
      'No existe public.perfiles ni public.profiles. Revisa el nombre de la tabla de usuarios en Table Editor.';
  end if;
end
$$;
