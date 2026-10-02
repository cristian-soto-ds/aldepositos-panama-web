-- Unicidad del número de RA en tasks (payload->>'ra').
-- Alineado a la validación del panel: upper(trim(...)).
-- Antes del índice se eliminan solo las copias VACÍAS (creadas desde
-- «Nueva orden manual» sin cliente, sin inventario ni OR vinculada) que
-- tengan otra fila con el mismo RA. Si queda algún duplicado con datos,
-- la creación del índice falla y hay que resolverlo a mano.

delete from public.tasks t
where coalesce(trim(t.payload->>'ra'), '') <> ''
  and coalesce(t.payload->>'status', 'pending') = 'pending'
  and coalesce(trim(t.payload->>'mainClient'), '') = ''
  and coalesce(trim(t.payload->>'provider'), '') = ''
  and coalesce(t.payload->>'linkedCollectionOrderId', '') = ''
  and jsonb_array_length(coalesce(t.payload->'measureData', '[]'::jsonb)) = 0
  and exists (
    select 1
    from public.tasks o
    where o.id <> t.id
      and upper(trim(o.payload->>'ra')) = upper(trim(t.payload->>'ra'))
  );

create unique index if not exists tasks_ra_unique_idx
  on public.tasks (upper(trim(payload->>'ra')))
  where coalesce(trim(payload->>'ra'), '') <> '';
