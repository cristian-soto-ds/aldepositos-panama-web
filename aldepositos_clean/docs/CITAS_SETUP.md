# Sistema de solicitud de citas — checklist de setup

La app guarda citas en Supabase (`public.citas` + Storage `cita-adjuntos`) y, si configuras Google, sincroniza cada alta/cambio a un Google Sheet. Si faltan variables de Google, **la cita igual se guarda**; el sync solo se registra en logs.

## 1. Supabase (SQL + Storage + roles)

1. Abre **Supabase → SQL Editor**.
2. Pega y ejecuta el contenido de  
   [`supabase/migrations/013_citas.sql`](../supabase/migrations/013_citas.sql).
3. Verifica en **Storage** que existe el bucket `cita-adjuntos` (privado, ~15 MB).
4. En **Table Editor → `profiles` o `perfiles`** (la que exista), confirma la columna `rol` (`staff` | `proveedor`). Por defecto todos quedan como `staff`.
5. Copia `SUPABASE_SERVICE_ROLE_KEY` a `.env.local` y a Vercel (solo servidor). Es **obligatoria** para crear citas con adjuntos.

### Crear un usuario proveedor

1. **Auth → Users** → crea el usuario (mismo flujo de usuario/contraseña que el resto).
2. En **Table Editor → `profiles` o `perfiles`**, localiza la fila del usuario y pon `rol = 'proveedor'`.
3. Al iniciar sesión irá a `/proveedor` (no al panel de inventarios).

## 2. Variables de entorno

En `.env.local` / Vercel:

```bash
# Ya usadas por la app
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Google Sheets (opcional; sin ellas el sync se omite)
GOOGLE_SHEETS_SPREADSHEET_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=
```

`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`: pega la clave privada del JSON; en env vars suele ir con `\n` escapados (una sola línea).

## 3. Google Sheets

1. Crea un Google Sheet vacío llamado p. ej. **Citas AlDepósitos**.
2. Copia el **ID** de la URL (`https://docs.google.com/spreadsheets/d/<ID>/edit`).
3. [Google Cloud Console](https://console.cloud.google.com/) → proyecto → habilita **Google Sheets API**.
4. Crea una **Service Account** → genera **JSON key**.
5. Comparte el Sheet con el email de la service account (`...@....iam.gserviceaccount.com`) como **Editor**.
6. Rellena las tres variables `GOOGLE_*` anteriores.
7. Si la hoja está vacía, la app escribe la fila de encabezados al primer sync:

`id | created_at | empresa | contacto | email | telefono | fecha_preferida | bultos_est | peso_est | cbm_est | estado | fecha_cita | respuesta | codigo_seguimiento | adjuntos_urls | updated_at`

## 4. Rutas de la app

| Ruta | Quién |
|------|--------|
| `/solicitar-cita` | Público (enlace bajo el login) |
| `/login` | Todos; `rol=proveedor` → `/proveedor`, resto → `/panel` |
| `/proveedor` | Portal proveedor (KPIs + lista) |
| `/panel` → módulo **Citas** | Staff AlDepósitos (lista + responder) |

APIs:

- `POST /api/citas` — crear (multipart + adjuntos)
- `GET /api/citas` — listar (staff todas / proveedor propias)
- `PATCH /api/citas/[id]` — staff responde
- `GET /api/me/role` — `staff` \| `proveedor`

## 5. Prueba de punta a punta

1. Sin login: abre `/solicitar-cita`, envía una solicitud con un PDF/imagen.
2. Comprueba fila en Supabase `citas` y (si Google está configurado) en el Sheet.
3. Login staff → panel → **Citas** → abre la solicitud → **Confirmar** con fecha/hora y mensaje.
4. Login proveedor (`rol=proveedor`) → `/proveedor` → ve estado, respuesta y descarga de adjuntos.
5. Verifica que el Sheet actualizó `estado`, `fecha_cita` y `respuesta`.

## 6. Adjuntos permitidos

PDF, JPEG/PNG, Excel (`.xlsx` / `.xls`), CSV. Máximo ~15 MB por archivo (hasta 8 archivos por solicitud).
