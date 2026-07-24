# Configuración Supabase (Aldepositos)

## Sesión en el navegador (cookies)

La app usa `@supabase/ssr` con **`createBrowserClient`**: la sesión vive en **cookies** para que el **middleware de Next** pueda refrescar el token y proteger `/panel` y `/welcome` antes de servir la página.

- Tras este cambio, los usuarios pueden tener que **iniciar sesión una vez más** (antes la sesión podía estar solo en `localStorage`).
- En producción usá **HTTPS** para que las cookies de autenticación se envíen de forma segura.

## Variables de entorno

En `.env.local` (y en Vercel → Project → Settings → Environment Variables):

| Variable | Descripción |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave anónima (pública) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Solo servidor** (no uses el prefijo `NEXT_PUBLIC_`). Opcional pero recomendada: el panel llama a `/api/me/display-name` para leer `perfiles.nombre_completo` y el avatar aunque RLS no permita `SELECT` al cliente. Obtén la clave en Supabase → Project Settings → API → `service_role`. |

## Crear la tabla

1. Abre el **SQL Editor** en el dashboard de Supabase.
2. Copia y ejecuta el contenido de `supabase/migrations/001_create_tasks.sql`.

Eso crea la tabla `public.tasks` con políticas RLS para usuarios **autenticados** (coincide con el login por email de la app).

## Tabla `tasks`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | `text` | PK; mismo `id` que usa la app para cada RA |
| `payload` | `jsonb` | Objeto **Task** completo (medidas, despacho, etc.) |
| `updated_at` | `timestamptz` | Última actualización (orden de listado) |

No hace falta definir columnas por campo: todo el estado del RA viaja en `payload`.

## Realtime (opcional pero recomendado)

Para que los cambios se vean en otros dispositivos sin recargar:

1. Tras crear la tabla, en **Database → Replication**, activa la réplica para `tasks`, **o** asegúrate de que el script ejecutó:
   `alter publication supabase_realtime add table public.tasks;`
2. La app se suscribe en `subscribeTasksRealtime` y vuelve a cargar la lista al cambiar datos.

## Qué debes hacer manualmente

- [ ] Ejecutar el SQL de migración una vez (`001_create_tasks.sql` y, según módulos usados, `007_collection_orders.sql`, **`009_reception_trucks.sql`**, etc.).
- [ ] Confirmar que **Authentication** está habilitado y los usuarios pueden iniciar sesión.
- [ ] Si usas políticas distintas (por ejemplo solo ciertos roles), ajusta las políticas RLS en Supabase.
- [ ] En Vercel, añade las mismas variables `NEXT_PUBLIC_*` y redeploy.

## Tabla `collection_orders` (orden de recolección)

El panel guarda las **órdenes de recolección** (antes del RA en almacén) en `public.collection_orders`, mismo patrón que `tasks`: `id`, `payload` (JSON), `updated_at`.

- Ejecuta **`supabase/migrations/007_collection_orders.sql`** en el SQL Editor.
- Activa **Replication** para esta tabla si quieres tiempo real entre dispositivos (el script intenta añadirla a `supabase_realtime`; si falla, hazlo desde el dashboard).

## Tabla `reception_trucks` (recepción de camiones y estado de rampas)

**Obligatoria** para la recepción de camiones (`/direccion-camiones`), la pantalla TV (`/direccion-camiones/tv`) y la sincronización del estado **LIBRE/OCUPADA** entre todos los usuarios del panel.

- Ejecuta **`supabase/migrations/009_reception_trucks.sql`** en el SQL Editor.
- Crea `public.reception_trucks` con RLS: usuarios autenticados lectura/escritura; `anon` solo lectura (TV sin login).
- Añade la tabla a `supabase_realtime` para sincronización instantánea.
- La cola de camiones usa ids normales; el estado de rampas vive en la fila meta `id = meta-ramp-occupancy`.

**Verificación tras aplicar:**

1. En Recepcionista (`/panel`), marca una rampa como OCUPADA.
2. En Supabase → Table Editor → `reception_trucks`, confirma la fila `meta-ramp-occupancy` con `payload.RAMPA_1` / `RAMPA_2`.
3. Abre `/direccion-camiones` en otro navegador: debe verse la tarjeta naranja de rampa ocupada.

Sin esta migración, los cambios de rampa solo quedan en `localStorage` de cada dispositivo y **los demás usuarios no verán el cambio**.

## Tabla `reference_catalog` (catálogo maestro)

La app consulta `public.reference_catalog` para autocompletar medidas y peso al capturar **referencia** en ingreso rápido/detallado. No sustituye a `tasks`.

- El cliente usa la clave `numero_parte_normalizado` (mayúsculas, sin espacios extra).
- Asegura **RLS** en Supabase: al menos `SELECT` para usuarios **autenticados** (misma sesión que el panel). Si no hay política de lectura, el autocompletado fallará en silencio (`console.warn`).
- Para el módulo **Catálogo de referencias** (CRUD en el panel), hacen falta también `INSERT`, `UPDATE` y `DELETE` para `authenticated`, o políticas equivalentes. Puedes aplicar `supabase/migrations/002_reference_catalog_rls.sql` (revisa que encaje con tus reglas de negocio).

## Foto de perfil (avatar) visible para el equipo

El panel lee nombres desde **`public.perfiles`**, columna **`nombre_completo`** (no `profiles` / `full_name`).

Las fotos se guardan en **Storage** (`bucket` `avatars`, ruta `{user_uuid}/avatar`) y la URL pública queda en **`perfiles.avatar_url`**.

1. Si usas la tabla en español: ejecuta `supabase/migrations/005_perfiles_avatar_url.sql` (columna + política `UPDATE`). Si tu proyecto sigue usando `public.profiles` en inglés, usa `003_profiles_avatar_url.sql` en su lugar.
2. Ejecuta `supabase/migrations/004_storage_avatars_bucket.sql` (bucket público + políticas de lectura/escritura solo en la carpeta del usuario).
3. Si la foto **sí sube** a Storage pero el panel dice que la base **rechazó guardar `avatar_url` (RLS)**, ejecuta **`supabase/migrations/006_perfiles_update_avatar_rls_fix.sql`**. Ajusta la política `UPDATE` para que coincida con la columna que enlaza tu fila con `auth.users` (`id`, `uuid` o ambas).
4. Para que el **Ranking Inventariadores** muestre las fotos de todos (no solo iniciales), ejecuta **`supabase/migrations/012_perfiles_select_avatars_authenticated.sql`**. Ese script aplica la política `SELECT` en **`perfiles` o `profiles`** (la que exista). Sin ella, el ranking no puede leer `avatar_url` ajenos. Opcional: añade `SUPABASE_SERVICE_ROLE_KEY` en `.env.local` (solo servidor) como respaldo.

Si la política `UPDATE` en `perfiles` choca con las tuyas, ajusta o elimina la duplicada.

## Bucket `ra-photos` (registro fotográfico de RAs)

Las fotos de inventario se guardan en **Storage** (`bucket` `ra-photos`, ruta `{task_id}/{photo_id}.jpg`). La metadata (URL, caption, categoría) vive en `tasks.payload.photoRecord`.

Ejecuta `supabase/migrations/010_ra_photos_bucket.sql` en el SQL Editor (bucket público de lectura; escritura para usuarios autenticados del panel).

## Nota: borrador de despacho en el navegador

El módulo **Entrega de carga** puede seguir usando `localStorage` solo para el **borrador visual** del formulario de contenedor (campos no guardados como fila aparte). Los **RA y el estado de cada orden** sí se guardan en Supabase vía `payload`. Si quieres unificar también ese borrador en la nube, se puede añadir otra tabla o un campo en `user_metadata`; no está incluido en esta migración.
