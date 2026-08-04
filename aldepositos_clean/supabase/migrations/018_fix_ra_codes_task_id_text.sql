-- Fix: tasks.id es TEXT (ej. "k3x9abc12"), no UUID.
-- warehouse_ra_codes.task_id debe ser text para poder guardar el id de la RA.
-- Idempotente.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'warehouse_ra_codes'
      and column_name = 'task_id'
      and udt_name = 'uuid'
  ) then
    alter table public.warehouse_ra_codes
      alter column task_id type text using task_id::text;
  end if;
end $$;
