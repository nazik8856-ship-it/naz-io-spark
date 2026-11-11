-- Two-step sign-in (docs/two-step-sign-in.md).
--
-- A person who has turned on an authenticator app (a verified TOTP factor) must use it to act as owner or admin. A session signed in with
-- only a password or Google is aal1; one that also passed the code is aal2. For the owner and admin roles, has_role() now answers true only
-- for an aal2 session once that person has a verified factor. So a stolen password or a hijacked Google session can look at the site but
-- can not reach anything an owner or admin can.
--
-- Not changed:
--   * People without a verified factor: nothing changes for them (turning it on is the person's own choice, in Account settings).
--   * The 'user' role.
--   * The server key and database jobs: they have no sign-in, and they were already outside the caller check.
--
-- Turning two-step sign-in off needs an aal2 session too (Supabase requires it to remove a verified factor), so an aal1 session can not
-- switch the protection off.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
    AND (coalesce(auth.role(), '') NOT IN ('anon', 'authenticated') OR (auth.uid() IS NOT NULL AND auth.uid() = _user_id))
    AND (
      _role::text NOT IN ('owner', 'admin')
      OR coalesce(auth.role(), '') <> 'authenticated'
      OR coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      OR NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = _user_id AND f.status = 'verified')
    )
$$;
