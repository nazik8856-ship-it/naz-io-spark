-- Lets the sign-in form distinguish "wrong password" from "this email is
-- linked to Google/Apple, not a password" -- today both cases hit the exact
-- same misleading "already registered" / "wrong password" message, because
-- signInWithPassword failing tells the client nothing about *why* (no
-- password identity exists at all vs. a real password mismatch).
--
-- SECURITY DEFINER is required: auth.identities isn't exposed to PostgREST,
-- and this needs to run pre-auth (an anonymous visitor typing an email into
-- the sign-in form). Returns ONLY the linked provider names -- never emails,
-- user ids, or anything else about the account -- to keep the disclosure to
-- the same "does this email have an account" signal signUp's own "already
-- registered" error already leaks today, not a full account fingerprint.
CREATE OR REPLACE FUNCTION public.get_identity_providers_for_email(_email text)
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(array_agg(DISTINCT provider), ARRAY[]::text[])
  FROM auth.identities
  WHERE lower(email) = lower(_email);
$$;

REVOKE ALL ON FUNCTION public.get_identity_providers_for_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_identity_providers_for_email(text) TO anon, authenticated;
