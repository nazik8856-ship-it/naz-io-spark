-- User & data isolation, front 1: who owns every table, and a report of anything that lets one account reach another's rows.
-- Nothing here changes what anyone can read or write (front 2 closes the gaps); it makes them visible. See docs/data-isolation.md.
--
-- 1. website_pages had no owner column (a page belongs to its website). It gets user_id, always copied from the website by a
--    trigger, so it can not be set to another account and no writer has to change.
-- 2. isolation_tables: one row per public table with its access type and owner column.
-- 3. isolation_report(): the gaps, one row each (server only).

-- 1. ------------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.website_pages ADD COLUMN IF NOT EXISTS user_id uuid;
UPDATE public.website_pages p SET user_id = w.user_id FROM public.websites w WHERE w.id = p.website_id AND p.user_id IS DISTINCT FROM w.user_id;
CREATE INDEX IF NOT EXISTS website_pages_user_id_idx ON public.website_pages (user_id);

CREATE OR REPLACE FUNCTION public.website_pages_owner_from_website()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  NEW.user_id := (SELECT w.user_id FROM public.websites w WHERE w.id = NEW.website_id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.website_pages_owner_from_website() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS website_pages_owner_from_website ON public.website_pages;
CREATE TRIGGER website_pages_owner_from_website BEFORE INSERT OR UPDATE OF website_id, user_id ON public.website_pages
  FOR EACH ROW EXECUTE FUNCTION public.website_pages_owner_from_website();
-- Every page has a website (website_id is required and must exist), so every page now has an owner.
ALTER TABLE public.website_pages ALTER COLUMN user_id SET NOT NULL;

-- 2. ------------------------------------------------------------------------------------------------------------------------
-- access:
--   owner             only the account owner (owner_column = auth.uid())
--   team              the owner, or an active member of the owner's team at the role the table needs (is_account_member)
--   public_by_link    one item can be opened by anyone who has its link; owner-only otherwise
--   self              a person's own row (owner_column is their user id)
--   membership        team membership rows, keyed by the team owner and the member
--   platform          NazAI staff only (has_role admin/owner)
--   shared_aggregate  combined numbers across accounts, nothing that identifies one
--   system_only       no browser access; edge functions and scheduled jobs only
CREATE TABLE IF NOT EXISTS public.isolation_tables (
  table_name text PRIMARY KEY,
  access text NOT NULL CHECK (access IN ('owner', 'team', 'public_by_link', 'self', 'membership', 'platform', 'shared_aggregate', 'system_only')),
  owner_column text,
  read_all_reason text,
  note text,
  CHECK (access IN ('platform', 'shared_aggregate', 'system_only') OR owner_column IS NOT NULL)
);
ALTER TABLE public.isolation_tables ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.isolation_tables FROM anon, authenticated;

INSERT INTO public.isolation_tables (table_name, access, owner_column, read_all_reason, note)
SELECT t, a, o, r, n FROM (VALUES
  -- team: the owner, or a team member at the role the table needs
  ('action_reversals', 'team', 'user_id', NULL, NULL),
  ('agent_decisions', 'team', 'user_id', NULL, NULL),
  ('agent_events', 'team', 'user_id', NULL, NULL),
  ('agent_integrations', 'team', 'user_id', NULL, 'connected accounts; tokens are in Vault'),
  ('agent_strictness_overrides', 'team', 'user_id', NULL, NULL),
  ('agents', 'team', 'user_id', NULL, NULL),
  ('ai_spend_caps', 'team', 'user_id', NULL, NULL),
  ('ai_spend_daily', 'team', 'user_id', NULL, NULL),
  ('api_key_action_policies', 'team', 'user_id', NULL, NULL),
  ('api_key_context_entries', 'team', 'user_id', NULL, NULL),
  ('api_key_response_rules', 'team', 'user_id', NULL, NULL),
  ('api_key_shadow_observations', 'team', 'user_id', NULL, NULL),
  ('api_keys', 'team', 'user_id', NULL, NULL),
  ('api_response_cache', 'team', 'user_id', NULL, NULL),
  ('api_response_generations', 'team', 'user_id', NULL, NULL),
  ('circuit_breakers', 'team', 'user_id', NULL, NULL),
  ('clean_allow_counts', 'team', 'user_id', NULL, NULL),
  ('content_gap_clusters', 'team', 'user_id', NULL, NULL),
  ('decision_embeddings', 'team', 'user_id', NULL, NULL),
  ('external_tools', 'team', 'user_id', NULL, 'Outer Control tools; keys are in Vault'),
  ('hard_rule_shadow_hits', 'team', 'user_id', NULL, NULL),
  ('hard_rules', 'team', 'user_id', NULL, NULL),
  ('imported_projects', 'team', 'user_id', NULL, NULL),
  ('incident_thresholds', 'team', 'user_id', NULL, NULL),
  ('incidents', 'team', 'user_id', NULL, NULL),
  ('knowledge_base_entries', 'team', 'user_id', NULL, NULL),
  ('meaning_rules', 'team', 'user_id', NULL, NULL),
  ('outer_control_completion_checks', 'team', 'user_id', NULL, NULL),
  ('outer_control_corrections', 'team', 'user_id', NULL, NULL),
  ('outer_control_evaluations', 'team', 'user_id', NULL, NULL),
  ('outer_control_memory', 'team', 'user_id', NULL, NULL),
  ('outer_control_session_steps', 'team', 'user_id', NULL, NULL),
  ('outer_control_sessions', 'team', 'user_id', NULL, NULL),
  ('outer_control_task_handoffs', 'team', 'user_id', NULL, NULL),
  ('outer_control_workflows', 'team', 'user_id', NULL, NULL),
  ('pending_approval_events', 'team', 'user_id', NULL, NULL),
  ('pending_approvals', 'team', 'user_id', NULL, NULL),
  ('policy_change_requests', 'team', 'user_id', NULL, NULL),
  ('policy_versions', 'team', 'user_id', NULL, NULL),
  ('policy_watch_observations', 'team', 'user_id', NULL, NULL),
  ('project_events', 'team', 'user_id', NULL, NULL),
  ('project_rules', 'team', 'user_id', NULL, NULL),
  ('safety_rules', 'team', 'user_id', NULL, NULL),
  ('webhook_deliveries', 'team', 'user_id', NULL, NULL),
  ('webhooks', 'team', 'user_id', NULL, NULL),
  -- owner: only the account owner
  ('agent_artifacts', 'owner', 'user_id', NULL, NULL),
  ('agent_clients', 'owner', 'user_id', NULL, NULL),
  ('agent_memory', 'owner', 'user_id', NULL, NULL),
  ('agent_reports', 'owner', 'user_id', NULL, NULL),
  ('agent_runs', 'owner', 'user_id', NULL, NULL),
  ('audit_integrity_runs', 'owner', 'user_id', NULL, NULL),
  ('business_profiles', 'owner', 'user_id', NULL, NULL),
  ('confidence_bucket_flags', 'owner', 'user_id', NULL, NULL),
  ('confidence_calibration', 'owner', 'user_id', NULL, NULL),
  ('config_changes', 'owner', 'user_id', NULL, NULL),
  ('control_test_runs', 'owner', 'user_id', NULL, NULL),
  ('credit_transactions', 'owner', 'user_id', NULL, NULL),
  ('critical_alerts', 'owner', 'user_id', NULL, NULL),
  ('data_deletion_requests', 'owner', 'user_id', NULL, NULL),
  ('decision_outcomes', 'owner', 'user_id', NULL, NULL),
  ('generation_cache', 'owner', 'user_id', NULL, NULL),
  ('generation_progress', 'owner', 'user_id', NULL, NULL),
  ('integration_issues', 'owner', 'user_id', NULL, NULL),
  ('integration_snapshots', 'owner', 'user_id', NULL, NULL),
  ('missions', 'owner', 'user_id', NULL, NULL),
  ('org_insights', 'owner', 'user_id', NULL, NULL),
  ('project_time', 'owner', 'user_id', NULL, NULL),
  ('projects', 'owner', 'user_id', NULL, NULL),
  ('safety_rule_matches', 'owner', 'user_id', NULL, NULL),
  ('safety_rule_shadow_hits', 'owner', 'user_id', NULL, NULL),
  ('scenario_simulations', 'owner', 'user_id', NULL, NULL),
  ('website_form_submissions', 'owner', 'user_id', NULL, 'what visitors typed into the owner''s site'),
  ('website_versions', 'owner', 'user_id', NULL, NULL),
  -- public_by_link: one site opened by its link; everything else owner-only
  ('websites', 'public_by_link', 'user_id', NULL, 'a published site is opened by id, subdomain or custom domain'),
  ('website_pages', 'public_by_link', 'user_id', NULL, 'owner copied from the website by a trigger'),
  ('shared_websites', 'public_by_link', 'user_id', NULL, 'a share link opens one site'),
  -- self / membership
  ('profiles', 'self', 'id', NULL, 'team members can read the profile of the account they belong to'),
  ('user_roles', 'self', 'user_id', NULL, NULL),
  ('account_members', 'membership', 'account_owner_id', NULL, 'the member (member_id) reads their own membership'),
  ('notification_preferences', 'membership', 'account_owner_id', NULL, 'one row per recipient (recipient_id) of an account'),
  -- platform staff / shared numbers
  ('platform_incidents', 'platform', NULL, NULL, NULL),
  ('scheduled_job_requests', 'platform', NULL, NULL, NULL),
  ('platform_settings', 'platform', NULL, 'the platform-wide kill switch, which every signed-in screen checks; no account data', NULL),
  ('cross_account_precedent_stats', 'shared_aggregate', NULL, 'combined counts per action type across accounts; no account or decision ids', NULL),
  -- system_only: edge functions and scheduled jobs only
  ('automation_readiness_signal_state', 'system_only', 'user_id', NULL, NULL),
  ('canva_oauth_transactions', 'system_only', 'user_id', NULL, NULL),
  ('figma_oauth_transactions', 'system_only', 'user_id', NULL, NULL),
  ('gmail_oauth_transactions', 'system_only', 'user_id', NULL, NULL),
  ('notion_oauth_transactions', 'system_only', 'user_id', NULL, NULL),
  ('shopify_oauth_transactions', 'system_only', 'user_id', NULL, NULL),
  ('slack_oauth_transactions', 'system_only', 'user_id', NULL, NULL),
  ('email_send_log', 'system_only', NULL, NULL, NULL),
  ('email_send_state', 'system_only', NULL, NULL, NULL),
  ('email_unsubscribe_tokens', 'system_only', NULL, NULL, NULL),
  ('suppressed_emails', 'system_only', NULL, NULL, NULL),
  ('encrypted_columns', 'system_only', NULL, NULL, NULL),
  ('encryption_exempt_columns', 'system_only', NULL, NULL, NULL),
  ('isolation_tables', 'system_only', NULL, NULL, NULL),
  ('generation_canary_runs', 'system_only', NULL, NULL, NULL),
  ('idempotency_keys', 'system_only', 'user_id', NULL, NULL),
  ('ip_rate_limit_windows', 'system_only', NULL, NULL, NULL),
  ('rate_limit_windows', 'system_only', 'user_id', NULL, NULL),
  ('secret_events', 'system_only', 'user_id', NULL, NULL)
) AS v(t, a, o, r, n)
ON CONFLICT (table_name) DO UPDATE SET access = EXCLUDED.access, owner_column = EXCLUDED.owner_column,
  read_all_reason = EXCLUDED.read_all_reason, note = EXCLUDED.note;

-- 3. ------------------------------------------------------------------------------------------------------------------------
-- One row per gap:
--   unregistered_table   a public table missing from isolation_tables (or registered but gone)
--   rls_off              row level security is off
--   read_all             a policy lets visitors or signed-in users read every row (USING true) without a recorded reason
--   no_identity_check    a policy for visitors or signed-in users checks neither the caller, their team, nor their role
--   system_table_exposed a system_only table has a policy that lets visitors or signed-in users in
--   owner_nullable       the owner column of an owner/team/public_by_link table can be empty
--   unchecked_function   a SECURITY DEFINER function that visitors or signed-in users can call never checks who is calling
CREATE OR REPLACE FUNCTION public.isolation_report()
RETURNS TABLE(kind text, object text, detail text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH tbl AS (
    SELECT c.oid, c.relname::text AS name, c.relrowsecurity AS rls, i.access, i.owner_column, i.read_all_reason
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN public.isolation_tables i ON i.table_name = c.relname
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  ),
  pol AS (
    SELECT t.name, t.access, t.read_all_reason, p.polname::text AS polname, p.polcmd::text AS cmd,
      coalesce(pg_get_expr(p.polqual, p.polrelid), '') AS q, coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') AS w
    FROM tbl t JOIN pg_policy p ON p.polrelid = t.oid
    -- policies that apply to visitors or signed-in users: PUBLIC (0), anon or authenticated
    WHERE p.polroles && ARRAY[0::oid, 'anon'::regrole::oid, 'authenticated'::regrole::oid]
  )
  SELECT 'unregistered_table', name, 'add it to isolation_tables with its access type' FROM tbl WHERE access IS NULL
  UNION ALL
  SELECT 'unregistered_table', i.table_name, 'registered but no longer exists' FROM public.isolation_tables i
    WHERE to_regclass(format('public.%I', i.table_name)) IS NULL
  UNION ALL
  SELECT 'rls_off', name, 'row level security is off' FROM tbl WHERE NOT rls
  UNION ALL
  SELECT 'read_all', name || ' / ' || polname, 'every row readable (' || cmd || ': ' || q || ')'
    FROM pol WHERE (q = 'true' OR (cmd IN ('a', '*') AND w = 'true')) AND read_all_reason IS NULL
  UNION ALL
  SELECT 'no_identity_check', name || ' / ' || polname, left(cmd || ': ' || coalesce(nullif(q, ''), w), 200)
    FROM pol WHERE q <> 'true' AND w <> 'true'
      AND (q || ' ' || w) !~ '(auth\.uid\(\)|auth\.role\(\)|auth\.jwt\(\)|is_account_member\(|has_role\()'
  UNION ALL
  SELECT 'system_table_exposed', name || ' / ' || polname, left(cmd || ': ' || coalesce(nullif(q, ''), w), 200)
    FROM pol WHERE access = 'system_only' AND (q || ' ' || w) !~ 'auth\.role\(\) = ''service_role'''
  UNION ALL
  SELECT 'owner_nullable', t.name || '.' || t.owner_column, 'the owner column can be empty'
    FROM tbl t JOIN information_schema.columns k ON k.table_schema = 'public' AND k.table_name = t.name AND k.column_name = t.owner_column
    WHERE t.access IN ('owner', 'team', 'public_by_link') AND k.is_nullable = 'YES'
  UNION ALL
  SELECT 'unchecked_function', p.oid::regprocedure::text,
    'SECURITY DEFINER, callable by ' || concat_ws(' and ',
      CASE WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'visitors' END,
      CASE WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'signed-in users' END)
      || ', never checks the caller'
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef AND p.prorettype <> 'trigger'::regtype
      AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      AND p.prosrc !~ '(auth\.uid\(\)|auth\.role\(\)|auth\.jwt\(\)|is_account_member\()'
  ORDER BY 1, 2;
$$;
REVOKE ALL ON FUNCTION public.isolation_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.isolation_report() TO service_role;
