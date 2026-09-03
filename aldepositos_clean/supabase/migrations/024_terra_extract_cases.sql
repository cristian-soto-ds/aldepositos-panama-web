-- Casos / feedback de extracciones AldeGpt Terra (órdenes de recolección).
-- Evidencia en Storage (privado, path scoped a auth.uid()).
-- Asegura reglas de aprendizaje (008) por si no se aplicó en el proyecto remoto.

create table if not exists public.gemini_learning_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint gemini_learning_notes_body_len check (char_length(body) between 1 and 2000)
);

create index if not exists gemini_learning_notes_user_created_idx
  on public.gemini_learning_notes (user_id, created_at desc);

alter table public.gemini_learning_notes enable row level security;

drop policy if exists "gemini_learning_notes_select_own" on public.gemini_learning_notes;
create policy "gemini_learning_notes_select_own"
  on public.gemini_learning_notes for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "gemini_learning_notes_insert_own" on public.gemini_learning_notes;
create policy "gemini_learning_notes_insert_own"
  on public.gemini_learning_notes for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "gemini_learning_notes_delete_own" on public.gemini_learning_notes;
create policy "gemini_learning_notes_delete_own"
  on public.gemini_learning_notes for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.terra_extract_cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  collection_order_id text null,
  order_numero text null,
  proveedor text null,
  cliente text null,
  model text not null default 'terra',
  extract_mode text not null default 'full',
  status text not null default 'failed'
    check (status in ('ok', 'failed', 'resolved')),
  note text not null default ''
    check (char_length(note) <= 4000),
  lines_snapshot jsonb not null default '[]'::jsonb,
  file_names text[] not null default '{}'::text[],
  storage_paths text[] not null default '{}'::text[],
  learning_note_id uuid null references public.gemini_learning_notes (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz null,
  constraint terra_extract_cases_failed_note
    check (status <> 'failed' or char_length(trim(note)) >= 1)
);

create index if not exists terra_extract_cases_user_created_idx
  on public.terra_extract_cases (user_id, created_at desc);

create index if not exists terra_extract_cases_status_idx
  on public.terra_extract_cases (user_id, status, created_at desc);

alter table public.terra_extract_cases enable row level security;

drop policy if exists "terra_extract_cases_select_own" on public.terra_extract_cases;
create policy "terra_extract_cases_select_own"
  on public.terra_extract_cases for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "terra_extract_cases_insert_own" on public.terra_extract_cases;
create policy "terra_extract_cases_insert_own"
  on public.terra_extract_cases for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "terra_extract_cases_update_own" on public.terra_extract_cases;
create policy "terra_extract_cases_update_own"
  on public.terra_extract_cases for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "terra_extract_cases_delete_own" on public.terra_extract_cases;
create policy "terra_extract_cases_delete_own"
  on public.terra_extract_cases for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Bucket privado para PDFs / imágenes de evidencia.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'terra-extract-cases',
  'terra-extract-cases',
  false,
  41943040,
  array[
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Ruta: "{user_uuid}/{case_id}/{filename}"

drop policy if exists "terra_extract_cases_select_own" on storage.objects;
create policy "terra_extract_cases_select_own"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'terra-extract-cases'
    and split_part(name, '/', 1) = (select auth.uid())::text
  );

drop policy if exists "terra_extract_cases_insert_own" on storage.objects;
create policy "terra_extract_cases_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'terra-extract-cases'
    and split_part(name, '/', 1) = (select auth.uid())::text
  );

drop policy if exists "terra_extract_cases_update_own" on storage.objects;
create policy "terra_extract_cases_update_own"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'terra-extract-cases'
    and split_part(name, '/', 1) = (select auth.uid())::text
  )
  with check (
    bucket_id = 'terra-extract-cases'
    and split_part(name, '/', 1) = (select auth.uid())::text
  );

drop policy if exists "terra_extract_cases_delete_own" on storage.objects;
create policy "terra_extract_cases_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'terra-extract-cases'
    and split_part(name, '/', 1) = (select auth.uid())::text
  );
