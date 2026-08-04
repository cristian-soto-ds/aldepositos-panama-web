# Control de Carga (códigos expedidor + RA)

Módulo para **RA completas** (`status = completed`) de AAA, JH e IMPOMEX DE COLOMBIA LTDA.

Códigos Code 128 para la impresora **Xellent Series X-1000VL**.

## Aplicar migraciones

1. Supabase → **SQL Editor**
2. Ejecutar `supabase/migrations/017_control_carga_ra_codes.sql`
3. Ejecutar `supabase/migrations/018_fix_ra_codes_task_id_text.sql`  
   (obligatorio si ya corriste 017: `task_id` debe ser **text** porque `tasks.id` no es UUID)
4. Ejecutar `supabase/migrations/018_warehouse_shippers_unique_name.sql` (si aplica)
5. Ejecutar `supabase/migrations/019_warehouse_load_sessions.sql`  
   (**obligatorio** para Carga/Descarga: tablas `warehouse_load_sessions`, `warehouse_load_session_ras`, `warehouse_package_scans`)

Sin el paso 5 verás el error `PGRST205` / `Could not find the table 'public.warehouse_load_sessions'`.

## Uso — códigos

1. Panel → **Control de Carga** → **Actualizar**
2. Al cargar se crean solos: expedidores `EXP-…` y pedidos `EXP-…-64368`
3. Unificar nombres en **Expedidores** si hace falta
4. **Etiquetas / Xellent** → copiar o CSV

## Uso — Carga / Descarga (dos operarios)

1. **Operario montaje** → pestaña Carga → modo **Montar RAs**
   - Crea la sesión con el nº de contenedor
   - Agrega los RA (por número o lista)
2. **Operario pistola** → mismo contenedor → modo **Pistolear**
   - Escanea cada etiqueta de bulto (`64368-001`)
   - El contador sube y valida contra los bultos esperados de cada RA
3. Exportar Excel y cerrar la sesión cuando termine

Los dos dispositivos se sincronizan solos cada pocos segundos.

## Notas

- No modifica `tasks.payload`.
- Código de pedido = código expedidor + número RA.
- Etiqueta de bulto = `RA-NNN` (no usar el código EXP del pedido para pistolear).
