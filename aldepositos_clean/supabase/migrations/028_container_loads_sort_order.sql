-- Orden en que se trabajan los cargues (1 = primero). Lo define el admin.
alter table public.container_loads
  add column if not exists sort_order integer not null default 0;

with ranked as (
  select id, row_number() over (order by created_at asc) as rn
  from public.container_loads
)
update public.container_loads c
set sort_order = ranked.rn
from ranked
where ranked.id = c.id
  and c.sort_order = 0;
