-- =====================================================================================================
-- Site-wide background (image / video) storage.
-- Run ONCE in Supabase → SQL Editor (safe to re-run). Requires public.is_admin() from setup.sql.
--
-- Why: the admin panel used to stuff the whole file into the site_settings row as a base64 string.
-- A video is far too big for that and Postgres gave up with "canceling statement due to statement timeout".
-- Now the file lives in Storage and the row only holds its short public URL.
--
-- NOTE: Supabase has a project-wide max file size (50 MB on the free plan). To upload bigger files,
--       raise it under Dashboard → Storage → Settings → "Upload file size limit" (needs a paid plan).
-- =====================================================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-assets', 'site-assets', true,
  null,       -- no per-bucket limit (the project-wide limit in Storage → Settings still applies)
  array['image/png','image/jpeg','image/webp','image/gif','image/avif','video/mp4','video/webm','video/ogg']
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- everyone can read (the wallpaper is shown to every visitor); only admins can write
drop policy if exists site_assets_read   on storage.objects;
drop policy if exists site_assets_insert on storage.objects;
drop policy if exists site_assets_update on storage.objects;
drop policy if exists site_assets_delete on storage.objects;

create policy site_assets_read   on storage.objects for select to anon, authenticated
  using (bucket_id = 'site-assets');
create policy site_assets_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'site-assets' and public.is_admin());
create policy site_assets_update on storage.objects for update to authenticated
  using (bucket_id = 'site-assets' and public.is_admin());
create policy site_assets_delete on storage.objects for delete to authenticated
  using (bucket_id = 'site-assets' and public.is_admin());
