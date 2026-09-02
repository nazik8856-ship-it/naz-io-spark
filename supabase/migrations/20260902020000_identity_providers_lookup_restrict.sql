-- get_identity_providers_for_email was directly callable by anyone holding
-- the public anon key via PostgREST RPC. GoTrue's own signIn/signUp endpoints
-- are rate-limited, but a bare RPC call isn't -- that made this an
-- unthrottled email-enumeration oracle (which email exists, and which
-- provider it uses). It's now only invoked server-side by the
-- identity-providers-lookup edge function, which enforces its own IP-based
-- rate limit before calling it, so the direct grants can be revoked.
REVOKE EXECUTE ON FUNCTION public.get_identity_providers_for_email(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_identity_providers_for_email(text) TO service_role;
