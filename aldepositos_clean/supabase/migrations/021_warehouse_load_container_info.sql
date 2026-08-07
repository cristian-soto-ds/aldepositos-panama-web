-- Datos logísticos del contenedor (tipo, consignación, sellos, etc.)
-- Idempotente. Requiere warehouse_load_sessions (019/020).

alter table public.warehouse_load_sessions
  add column if not exists container_info jsonb not null default '{}'::jsonb;

comment on column public.warehouse_load_sessions.container_info is
  'Metadatos de contenedor: type, consignment, number, bl, seal1, seal2, responsible, date, tare';
