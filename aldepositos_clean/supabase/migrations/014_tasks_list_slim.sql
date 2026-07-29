-- Lista de tasks sin measureData (payload más liviano para el panel).
-- Seguridad: SECURITY INVOKER → aplica RLS de public.tasks.

create or replace function public.fetch_tasks_list(p_include_measure boolean default false)
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
    t.id,
    t.updated_at,
    case
      when p_include_measure then t.payload
      else t.payload - 'measureData'
    end as payload
  from public.tasks t
  order by t.updated_at desc;
$$;

revoke all on function public.fetch_tasks_list(boolean) from public;
grant execute on function public.fetch_tasks_list(boolean) to authenticated;
