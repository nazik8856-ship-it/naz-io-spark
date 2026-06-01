
-- 1. Revoke EXECUTE on all SECURITY DEFINER functions from public/anon/authenticated.
--    Edge functions use the service role and are unaffected.
REVOKE EXECUTE ON FUNCTION public.add_credits(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.deduct_credit(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;

-- 2. Pin search_path on the email functions that were missing it.
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public, pg_temp;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, pg_temp;

-- 3. credit_transactions: remove user INSERT (self-crediting risk). Server writes via service role.
DROP POLICY IF EXISTS "Users can insert own transactions" ON public.credit_transactions;

-- 4. shared_websites: require authentication to create; anyone can still view (intentional share links).
DROP POLICY IF EXISTS "Anyone can create shared websites" ON public.shared_websites;
CREATE POLICY "Authenticated users can create shared websites"
  ON public.shared_websites FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 5. Storage: drop the broad SELECT policy that allows listing mission-assets.
--    Files remain reachable via their public URLs because the bucket is public.
DROP POLICY IF EXISTS "Anyone can view mission assets" ON storage.objects;
