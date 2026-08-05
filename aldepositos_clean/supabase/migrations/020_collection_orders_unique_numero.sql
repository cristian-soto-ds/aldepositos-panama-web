-- Unicidad del número OR (Magaya) en collection_orders.
-- Alineado a normalizeOrNumero: lower(trim(...)).
-- Si había duplicados, los más antiguos se renombran con sufijo -dup-<id>
-- para poder crear el índice sin perder filas.

with ranked as (
  select
    id,
    lower(trim(payload->>'numero')) as n,
    row_number() over (
      partition by lower(trim(payload->>'numero'))
      order by updated_at desc nulls last, id
    ) as rn
  from public.collection_orders
  where coalesce(trim(payload->>'numero'), '') <> ''
)
update public.collection_orders c
set
  payload = jsonb_set(
    c.payload,
    '{numero}',
    to_jsonb(
      coalesce(nullif(trim(c.payload->>'numero'), ''), 'OR')
      || '-dup-'
      || left(replace(c.id::text, '-', ''), 8)
    )
  ),
  updated_at = now()
from ranked r
where c.id = r.id
  and r.rn > 1;

create unique index if not exists collection_orders_numero_unique_idx
  on public.collection_orders (lower(trim(payload->>'numero')))
  where coalesce(trim(payload->>'numero'), '') <> '';
