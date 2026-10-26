-- Secrets handling, front 1: no browser role can read a secret column, even an empty one.
--
-- A column-level REVOKE does nothing while the role holds SELECT on the whole table, so each table loses its table-wide SELECT
-- and gets back the safe columns by name (every website query names its columns). Row level security already kept these rows
-- from strangers; this removes the column itself, so a mistake in a policy can not hand out a secret.
--
--   account_members.invite_token      the link that joins an account; only the invite functions (service role) use it
--   agent_integrations.credentials    an old column from before Vault, unused and empty; credentials live in Vault
--   api_keys.key_hash, callback_secret anon still held table-wide SELECT; authenticated already could not read these two
--   email_unsubscribe_tokens.token    only the email functions (service role) use it; no browser access at all

REVOKE SELECT ON TABLE public.account_members FROM anon, authenticated;
GRANT SELECT (id, account_owner_id, member_id, email, role, status, invited_by, invited_at, accepted_at, created_at, ooo_until,
  ooo_fallback_member_id, permissions, invite_expires_at) ON public.account_members TO authenticated;

REVOKE SELECT ON TABLE public.agent_integrations FROM anon, authenticated;
GRANT SELECT (id, user_id, agent_id, provider, metadata, status, last_verified_at, last_error, created_at, updated_at, revoked_alerted_at)
  ON public.agent_integrations TO authenticated;

REVOKE SELECT ON TABLE public.api_keys FROM anon;
REVOKE SELECT (key_hash, callback_secret) ON public.api_keys FROM anon, authenticated;

REVOKE ALL ON TABLE public.email_unsubscribe_tokens FROM anon, authenticated;
-- The insert policy applied to every role; tokens are written by the server only.
ALTER POLICY "Service role can insert tokens" ON public.email_unsubscribe_tokens TO service_role;

-- Every column whose name says it holds a secret and that anon or a signed-in user can read. Expected: no rows. Run after each
-- migration (and in CI); a row here is a secret one policy mistake away from a browser.
CREATE OR REPLACE FUNCTION public.secrets_exposure_report()
RETURNS TABLE(table_name text, column_name text, readable_by text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.table_name::text, c.column_name::text, r.role::text
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type IN ('BASE TABLE', 'VIEW')
  CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
  WHERE c.table_schema = 'public'
    AND c.column_name ~* '(secret|token|password|passwd|api_key|private_key|signing_key|access_key|refresh|credential|key_hash|content_enc)'
    AND c.column_name !~* '(_id|_at|_count|_used|tokens|_prefix)$'
    AND has_column_privilege(r.role, format('%I.%I', c.table_schema, c.table_name), c.column_name, 'SELECT')
  ORDER BY 1, 2, 3;
$$;
REVOKE ALL ON FUNCTION public.secrets_exposure_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.secrets_exposure_report() TO service_role;
