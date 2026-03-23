# Configuración Supabase (Aldepositos)

## Variables de entorno

En `.env.local` (y en Vercel → Project → Settings → Environment Variables):

| Variable | Descripción |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave anónima (pública) |

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

- [ ] Ejecutar el SQL de migración una vez.
- [ ] Confirmar que **Authentication** está habilitado y los usuarios pueden iniciar sesión.
- [ ] Si usas políticas distintas (por ejemplo solo ciertos roles), ajusta las políticas RLS en Supabase.
- [ ] En Vercel, añade las mismas variables `NEXT_PUBLIC_*` y redeploy.

## Nota: borrador de despacho en el navegador

El módulo **Entrega de carga** puede seguir usando `localStorage` solo para el **borrador visual** del formulario de contenedor (campos no guardados como fila aparte). Los **RA y el estado de cada orden** sí se guardan en Supabase vía `payload`. Si quieres unificar también ese borrador en la nube, se puede añadir otra tabla o un campo en `user_metadata`; no está incluido en esta migración.
