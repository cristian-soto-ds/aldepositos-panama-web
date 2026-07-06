-- Bucket público para fotos de registro de RAs (registro fotográfico).
-- Ejecutar en Supabase Dashboard → SQL Editor después de las migraciones anteriores.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ra-photos',
  'ra-photos',
  true,
  8388608,
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Ruta esperada: "{task_id}/{photo_id}.jpg"
-- Lectura pública para generar PDF; escritura solo usuarios autenticados del panel.

drop policy if exists "ra_photos_public_read" on storage.objects;
create policy "ra_photos_public_read"
  on storage.objects
  for select
  to public
  using (bucket_id = 'ra-photos');

drop policy if exists "ra_photos_insert_authenticated" on storage.objects;
create policy "ra_photos_insert_authenticated"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'ra-photos');

drop policy if exists "ra_photos_update_authenticated" on storage.objects;
create policy "ra_photos_update_authenticated"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'ra-photos')
  with check (bucket_id = 'ra-photos');

drop policy if exists "ra_photos_delete_authenticated" on storage.objects;
create policy "ra_photos_delete_authenticated"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'ra-photos');
