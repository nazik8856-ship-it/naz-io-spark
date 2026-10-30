-- User & data isolation: files users attach (prompt images, clarification answers, brand assets, mission files) move to a
-- private bucket. Only the owner can upload, read, replace or delete files in their own folder (<user id>/...), nobody can list
-- anyone else's, and links to them are short-lived signed links. An image a generated site places is published with that site
-- by the site generator (a copy under mission-assets/website-images/<user>/<site>/uploads/), so published sites keep working.
--
-- mission-assets stays public for generated website images, which only the server writes: browser uploads to it are closed.
INSERT INTO storage.buckets (id, name, public)
VALUES ('user-uploads', 'user-uploads', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Own uploads: upload" ON storage.objects;
DROP POLICY IF EXISTS "Own uploads: read" ON storage.objects;
DROP POLICY IF EXISTS "Own uploads: replace" ON storage.objects;
DROP POLICY IF EXISTS "Own uploads: delete" ON storage.objects;
CREATE POLICY "Own uploads: upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'user-uploads' AND (storage.foldername(name))[1] = (auth.uid())::text);
CREATE POLICY "Own uploads: read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'user-uploads' AND (storage.foldername(name))[1] = (auth.uid())::text);
CREATE POLICY "Own uploads: replace" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'user-uploads' AND (storage.foldername(name))[1] = (auth.uid())::text)
  WITH CHECK (bucket_id = 'user-uploads' AND (storage.foldername(name))[1] = (auth.uid())::text);
CREATE POLICY "Own uploads: delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'user-uploads' AND (storage.foldername(name))[1] = (auth.uid())::text);

-- Nothing in the website uploads to the public bucket any more; only the server (generated site images) writes there.
DROP POLICY IF EXISTS "Authenticated users can upload to own folder" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own mission assets" ON storage.objects;
