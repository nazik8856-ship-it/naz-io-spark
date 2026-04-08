
-- 1. Fix profiles: prevent users from directly updating credits
-- Drop the existing permissive UPDATE policy
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- Create a restrictive UPDATE policy that only allows updating non-credits columns
-- Since profiles only has id, credits, created_at — there's nothing useful for users to update directly
-- Credits should ONLY be modified via the deduct_credit RPC (SECURITY DEFINER)
-- So we remove direct UPDATE access entirely
-- (The deduct_credit function uses SECURITY DEFINER and bypasses RLS)

-- 2. Fix websites table: replace permissive policies with scoped ones
DROP POLICY IF EXISTS "Anyone can insert websites" ON public.websites;
DROP POLICY IF EXISTS "Anyone can read websites" ON public.websites;

-- Allow only authenticated users to insert their own websites
CREATE POLICY "Authenticated users can insert own websites"
ON public.websites
FOR INSERT
TO authenticated
WITH CHECK (auth.uid()::text = user_id);

-- Allow only authenticated users to read their own websites
CREATE POLICY "Users can read own websites"
ON public.websites
FOR SELECT
TO authenticated
USING (auth.uid()::text = user_id);

-- Allow users to update their own websites
CREATE POLICY "Users can update own websites"
ON public.websites
FOR UPDATE
TO authenticated
USING (auth.uid()::text = user_id);

-- Allow users to delete their own websites
CREATE POLICY "Users can delete own websites"
ON public.websites
FOR DELETE
TO authenticated
USING (auth.uid()::text = user_id);

-- 3. Fix mission-assets storage: add ownership check to INSERT policy
DROP POLICY IF EXISTS "Allow authenticated uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated inserts" ON storage.objects;

-- Find and replace the INSERT policy for mission-assets with ownership check
CREATE POLICY "Authenticated users can upload to own folder"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'mission-assets'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
