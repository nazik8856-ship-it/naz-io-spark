
-- Drop ALL existing policies on websites (legacy names unknown)
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='websites' LOOP
    EXECUTE format('DROP POLICY %I ON public.websites', p.policyname);
  END LOOP;
END $$;

ALTER TABLE public.websites ALTER COLUMN user_id DROP DEFAULT;
ALTER TABLE public.websites
  ALTER COLUMN user_id TYPE uuid USING NULLIF(user_id, '00000000-0000-0000-0000-000000000000')::uuid;
ALTER TABLE public.websites ALTER COLUMN user_id SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE public.websites
    ADD CONSTRAINT websites_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE POLICY "Users can view their own websites" ON public.websites
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own websites" ON public.websites
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own websites" ON public.websites
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own websites" ON public.websites
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- shared_websites: purge orphans and require owner going forward
DELETE FROM public.shared_websites WHERE user_id IS NULL;
ALTER TABLE public.shared_websites ALTER COLUMN user_id SET NOT NULL;

-- mission-assets storage: restrict SELECT to owner folder
DROP POLICY IF EXISTS "Mission assets owner read" ON storage.objects;
CREATE POLICY "Mission assets owner read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'mission-assets'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
