-- Rol de panel: admin (todo) | inventariador (Inventarios + Foto + Ranking + Opciones).
-- IMPORTANTE: quitar el CHECK antes de normalizar filas (staff/proveedor/worker/etc.).

do $$
begin
  if to_regclass('public.profiles') is not null then
    alter table public.profiles
      add column if not exists rol text;

    -- 1) Quitar restricción vieja PRIMERO
    alter table public.profiles drop constraint if exists profiles_rol_check;

    -- 2) Rellenar nulos y normalizar valores no válidos
    update public.profiles set rol = 'admin' where rol is null or trim(rol) = '';
    update public.profiles
    set rol = 'admin'
    where lower(trim(rol)) not in ('admin', 'inventariador');

    -- 3) NOT NULL + default
    alter table public.profiles
      alter column rol set default 'admin';
    alter table public.profiles
      alter column rol set not null;

    -- 4) CHECK solo al final
    alter table public.profiles
      add constraint profiles_rol_check
      check (rol in ('admin', 'inventariador'));

    comment on column public.profiles.rol is
      'admin = panel completo; inventariador = Inventarios + Foto + Ranking + Opciones';
  end if;

  if to_regclass('public.perfiles') is not null then
    alter table public.perfiles
      add column if not exists rol text;

    alter table public.perfiles drop constraint if exists perfiles_rol_check;

    update public.perfiles set rol = 'admin' where rol is null or trim(rol) = '';
    update public.perfiles
    set rol = 'admin'
    where lower(trim(rol)) not in ('admin', 'inventariador');

    alter table public.perfiles
      alter column rol set default 'admin';
    alter table public.perfiles
      alter column rol set not null;

    alter table public.perfiles
      add constraint perfiles_rol_check
      check (rol in ('admin', 'inventariador'));

    comment on column public.perfiles.rol is
      'admin = panel completo; inventariador = Inventarios + Foto + Ranking + Opciones';
  end if;
end $$;
