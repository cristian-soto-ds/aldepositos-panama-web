-- Reglas / aprendizajes persistentes por usuario para Alde.IA (orden de recolección).
-- El servidor las lee con el JWT del usuario y las añade al contexto de Gemini.

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

create policy "gemini_learning_notes_select_own"
  on public.gemini_learning_notes for select
  to authenticated
  using (auth.uid() = user_id);

create policy "gemini_learning_notes_insert_own"
  on public.gemini_learning_notes for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "gemini_learning_notes_delete_own"
  on public.gemini_learning_notes for delete
  to authenticated
  using (auth.uid() = user_id);
