
INSERT INTO storage.buckets (id, name, public)
VALUES ('mission-assets', 'mission-assets', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Anyone can view mission assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'mission-assets');

CREATE POLICY "Authenticated users can upload mission assets"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'mission-assets' AND auth.role() = 'authenticated');

CREATE POLICY "Users can update their own mission assets"
ON storage.objects FOR UPDATE
USING (bucket_id = 'mission-assets' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own mission assets"
ON storage.objects FOR DELETE
USING (bucket_id = 'mission-assets' AND auth.uid()::text = (storage.foldername(name))[1]);
