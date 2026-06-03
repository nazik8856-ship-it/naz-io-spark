-- 1. Drop the duplicate, overly permissive INSERT policy on mission-assets storage
DROP POLICY IF EXISTS "Authenticated users can upload mission assets" ON storage.objects;

-- 2. Add ownership to shared_websites
ALTER TABLE public.shared_websites
  ADD COLUMN IF NOT EXISTS user_id uuid;

DROP POLICY IF EXISTS "Authenticated users can create shared websites" ON public.shared_websites;

CREATE POLICY "Authenticated users can create own shared websites"
  ON public.shared_websites
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);