-- Ajustes compartidos del panel (JSON en payload). Misma idea que collection_orders / reception meta.
create table if not exists public.panel_settings (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.panel_settings enable row level security;

create policy "panel_settings_select_authenticated"
  on public.panel_settings for select
  to authenticated
  using (true);

create policy "panel_settings_insert_authenticated"
  on public.panel_settings for insert
  to authenticated
  with check (true);

create policy "panel_settings_update_authenticated"
  on public.panel_settings for update
  to authenticated
  using (true)
  with check (true);

create policy "panel_settings_delete_authenticated"
  on public.panel_settings for delete
  to authenticated
  using (true);

do $$
begin
  alter publication supabase_realtime add table public.panel_settings;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
