-- Lista de OR para Recepcionista sin líneas Magaya (payload liviano).
-- Seguridad: SECURITY INVOKER → aplica RLS de public.collection_orders.

create or replace function public.fetch_collection_orders_receptionist_slim()
returns table (
  id text,
  updated_at timestamptz,
  payload jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    co.id,
    co.updated_at,
    (co.payload - 'lines') || jsonb_build_object('lines', '[]'::jsonb) as payload
  from public.collection_orders co
  order by co.updated_at desc;
$$;

revoke all on function public.fetch_collection_orders_receptionist_slim() from public;
grant execute on function public.fetch_collection_orders_receptionist_slim() to authenticated;

-- Lookup rápido de OR por camión unificado (receptionGroupId en payload).
create index if not exists collection_orders_reception_group_id_idx
  on public.collection_orders ((payload->>'receptionGroupId'))
  where coalesce(payload->>'receptionGroupId', '') <> '';
