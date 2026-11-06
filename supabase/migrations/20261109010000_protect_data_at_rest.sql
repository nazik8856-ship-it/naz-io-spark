-- General data security, task 3: protected data at rest (docs/data-encryption.md, docs/data-classification.md).
--
-- 1. Twenty more content columns are stored encrypted by the edge functions (DATA_KEY, _shared/encrypted-db.ts), the same way as
--    Outer Control content: an agent's remembered facts and business profile, the account's clients, reports and learned
--    insights, what-if questions and answers, cached generations and replies, webhook deliveries, and the handle that undoes an
--    action in a connected tool. Every one of these tables is empty on the live project (the 19 cached generations had all
--    expired and are removed here: nothing reads an expired entry), so each column is locked at once: the database refuses a
--    write that puts its text in the clear.
-- 2. Every other content column (classification_gaps(): content class, neither encrypted nor exempt) gets a recorded reason in
--    encryption_exempt_columns, marked by_design or deferred. classification_report() now lists any content column without
--    either as a problem, so the weekly check opens an incident for a new unprotected column.
-- 3. Secrets: each SECRET column has a storage rule. The columns whose value lives in the vault are kept empty by a check; key
--    hashes must be hashes; OAuth sign-in rows are deleted within an hour. classification_report() lists any break.
-- 4. Retention: raw tool replies stored with a finished session's steps are removed after 30 days (the checked result, the
--    verdict and the fingerprints stay), live data snapshots after 30 days, visitor addresses kept for rate limiting after a day.

-- Nothing reads an expired cache entry (generation-cache.ts filters on expires_at); removing them leaves the table empty.
DELETE FROM public.generation_cache WHERE expires_at < now();

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('agent_memory', 'value'),
    ('business_profiles', 'one_liner'),
    ('business_profiles', 'tone'),
    ('business_profiles', 'audience'),
    ('business_profiles', 'offers'),
    ('business_profiles', 'channels'),
    ('business_profiles', 'inferred_kpis'),
    ('business_profiles', 'raw_research'),
    ('agent_clients', 'name'),
    ('agent_clients', 'company'),
    ('agent_clients', 'tags'),
    ('agent_clients', 'notes'),
    ('agent_reports', 'body_markdown'),
    ('org_insights', 'insight'),
    ('scenario_simulations', 'question'),
    ('scenario_simulations', 'response'),
    ('generation_cache', 'manifest'),
    ('idempotency_keys', 'response'),
    ('webhook_deliveries', 'payload'),
    ('action_reversals', 'undo_payload')
  ) AS v(t, c) LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS %I text', r.t, r.c || '_enc');
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', r.t, r.c);
    INSERT INTO public.encrypted_columns (table_name, column_name, note)
    VALUES (r.t, r.c, 'Encrypted with DATA_KEY (encrypted-db.ts); data at rest, task 3.')
    ON CONFLICT (table_name, column_name) DO NOTHING;
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS agent_memory_plain_wins ON public.agent_memory;
CREATE TRIGGER agent_memory_plain_wins BEFORE INSERT OR UPDATE ON public.agent_memory FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('value');
DROP TRIGGER IF EXISTS business_profiles_plain_wins ON public.business_profiles;
CREATE TRIGGER business_profiles_plain_wins BEFORE INSERT OR UPDATE ON public.business_profiles FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('one_liner', 'tone', 'audience', 'offers', 'channels', 'inferred_kpis', 'raw_research');
DROP TRIGGER IF EXISTS agent_clients_plain_wins ON public.agent_clients;
CREATE TRIGGER agent_clients_plain_wins BEFORE INSERT OR UPDATE ON public.agent_clients FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('name', 'company', 'tags', 'notes');
DROP TRIGGER IF EXISTS agent_reports_plain_wins ON public.agent_reports;
CREATE TRIGGER agent_reports_plain_wins BEFORE INSERT OR UPDATE ON public.agent_reports FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('body_markdown');
DROP TRIGGER IF EXISTS org_insights_plain_wins ON public.org_insights;
CREATE TRIGGER org_insights_plain_wins BEFORE INSERT OR UPDATE ON public.org_insights FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('insight');
DROP TRIGGER IF EXISTS scenario_simulations_plain_wins ON public.scenario_simulations;
CREATE TRIGGER scenario_simulations_plain_wins BEFORE INSERT OR UPDATE ON public.scenario_simulations FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('question', 'response');
DROP TRIGGER IF EXISTS generation_cache_plain_wins ON public.generation_cache;
CREATE TRIGGER generation_cache_plain_wins BEFORE INSERT OR UPDATE ON public.generation_cache FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('manifest');
DROP TRIGGER IF EXISTS idempotency_keys_plain_wins ON public.idempotency_keys;
CREATE TRIGGER idempotency_keys_plain_wins BEFORE INSERT OR UPDATE ON public.idempotency_keys FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('response');
DROP TRIGGER IF EXISTS webhook_deliveries_plain_wins ON public.webhook_deliveries;
CREATE TRIGGER webhook_deliveries_plain_wins BEFORE INSERT OR UPDATE ON public.webhook_deliveries FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('payload');
DROP TRIGGER IF EXISTS action_reversals_plain_wins ON public.action_reversals;
CREATE TRIGGER action_reversals_plain_wins BEFORE INSERT OR UPDATE ON public.action_reversals FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('undo_payload');

-- ---------------------------------------------------------------------------------------------------------------------------
-- 2. Every content column is encrypted or has a recorded reason.

ALTER TABLE public.encryption_exempt_columns ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'by_design';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'encryption_exempt_columns_kind_check') THEN
    ALTER TABLE public.encryption_exempt_columns ADD CONSTRAINT encryption_exempt_columns_kind_check CHECK (kind IN ('by_design', 'deferred'));
  END IF;
END $$;

INSERT INTO public.encryption_exempt_columns (table_name, column_name, reason, kind) VALUES
('account_members', 'email', 'the address an invitation was sent to, matched when the invitee signs up', 'by_design'),
('agent_artifacts', 'account_email', 'the connected account a created file belongs to, shown next to its link', 'by_design'),
('agent_artifacts', 'title', 'name of a file the agent created in a connected tool, shown in lists', 'by_design'),
('agent_artifacts', 'url', 'link to a file the agent created in a connected tool', 'by_design'),
('agent_clients', 'email', 'the client address, used to find the same client again (matched without regard to case)', 'by_design'),
('agent_decisions', 'alternatives_considered', 'part of the signed decision trail, which the database itself verifies; decisions are kept readable to the database for that (docs/data-encryption.md)', 'by_design'),
('agent_decisions', 'description', 'part of the signed decision trail, which the database itself verifies; decisions are kept readable to the database for that (docs/data-encryption.md)', 'by_design'),
('agent_decisions', 'human_response', 'part of the signed decision trail, which the database itself verifies; decisions are kept readable to the database for that (docs/data-encryption.md)', 'by_design'),
('agent_decisions', 'modified_params', 'part of the signed decision trail, which the database itself verifies; decisions are kept readable to the database for that (docs/data-encryption.md)', 'by_design'),
('agent_decisions', 'params', 'part of the signed decision trail, which the database itself verifies; decisions are kept readable to the database for that (docs/data-encryption.md)', 'by_design'),
('agent_decisions', 'reasoning', 'part of the signed decision trail, which the database itself verifies; decisions are kept readable to the database for that (docs/data-encryption.md)', 'by_design'),
('agent_integrations', 'metadata', 'read straight from the database by 4 screens and many functions; encrypting it needs those reads moved to the server first', 'deferred'),
('agent_memory', 'key', 'the name of a remembered fact (intake.goal, business.tone), used to find and replace it', 'by_design'),
('agent_reports', 'title', 'title of a report, shown in lists', 'by_design'),
('agents', 'goal', 'read straight from the database by about 29 screens; encrypting it needs those reads moved to the server first', 'deferred'),
('agents', 'manifest', 'read straight from the database by about 29 screens; encrypting it needs those reads moved to the server first', 'deferred'),
('agents', 'name', 'name of the agent, shown in lists', 'by_design'),
('agents', 'role', 'read straight from the database by about 29 screens; encrypting it needs those reads moved to the server first', 'deferred'),
('agents', 'slug', 'short address name of the agent, used to find it', 'by_design'),
('agents', 'source_plan', 'read straight from the database by about 29 screens; encrypting it needs those reads moved to the server first', 'deferred'),
('api_key_context_entries', 'embedding', 'embedding for similarity search in the database: numbers derived from the text, not the text', 'by_design'),
('api_keys', 'callback_url', 'address the owner gave for decision callbacks; checked by url-safety before every call', 'by_design'),
('api_keys', 'fallback_message', 'read straight from the database by 7 settings screens; encrypting it needs those reads moved to the server first', 'deferred'),
('api_keys', 'name', 'name of the key, shown in lists', 'by_design'),
('api_keys', 'response_persona', 'read straight from the database by 7 settings screens; encrypting it needs those reads moved to the server first', 'deferred'),
('api_response_cache', 'embedding', 'embedding for similarity search in the database: numbers derived from the text, not the text', 'by_design'),
('business_profiles', 'company_name', 'company name, shown in lists', 'by_design'),
('business_profiles', 'industry', 'industry category of the business', 'by_design'),
('business_profiles', 'source_url', 'the public website the profile was researched from', 'by_design'),
('content_gap_clusters', 'embedding', 'embedding for similarity search in the database: numbers derived from the text, not the text', 'by_design'),
('content_gap_clusters', 'representative_message', 'returned by the database search functions search_gap_clusters and list_gap_clusters_ranked; encrypting it needs both changed first', 'deferred'),
('decision_embeddings', 'embedding', 'embedding for similarity search in the database: numbers derived from the text, not the text', 'by_design'),
('decision_outcomes', 'evidence', 'a copy of the decision and its reasoning (kept readable by the signed decision trail) and the measured dates', 'by_design'),
('email_send_log', 'recipient_email', 'address an email was sent to, matched against the suppression list before every send', 'by_design'),
('email_unsubscribe_tokens', 'email', 'address an unsubscribe link belongs to, needed to honour it', 'by_design'),
('external_tools', 'endpoint_url', 'address of the connected tool NazAI calls; shown to the owner, checked by url-safety', 'by_design'),
('external_tools', 'name', 'name of the connected tool, shown in lists', 'by_design'),
('ip_rate_limit_windows', 'ip', 'rate-limit key of a visitor; windows older than a day are deleted every hour', 'by_design'),
('profiles', 'display_name', 'the name a user shows to their team', 'by_design'),
('profiles', 'user_context', 'unused by the code; a check keeps it empty ({})', 'by_design'),
('project_events', 'project_name', 'name of a project, shown in the activity list', 'by_design'),
('projects', 'html', 'legacy table that no code writes (no rows); a check keeps it empty', 'by_design'),
('projects', 'prompt', 'legacy table that no code writes (no rows); a check keeps it empty', 'by_design'),
('projects', 'title', 'name of a legacy project, shown in lists', 'by_design'),
('shared_websites', 'html', 'a website its owner chose to share by link: public by design', 'by_design'),
('shared_websites', 'title', 'title of a website its owner chose to share by link: public by design', 'by_design'),
('shopify_oauth_transactions', 'shop_domain', 'the shop a Shopify sign-in is for, matched on the callback; the row is deleted within an hour', 'by_design'),
('suppressed_emails', 'email', 'address that must not be emailed again, matched before every send', 'by_design'),
('webhooks', 'url', 'address the owner gave for webhook deliveries; checked by url-safety before every call', 'by_design'),
('website_pages', 'sections', 'a page of the account website, served to every visitor once the site is published', 'by_design'),
('website_pages', 'seo_description', 'a page of the account website, served to every visitor once the site is published', 'by_design'),
('website_pages', 'slug', 'address of a page of the account website, looked up for every visit', 'by_design'),
('website_pages', 'title', 'a page of the account website, served to every visitor once the site is published', 'by_design'),
('website_versions', 'label', 'name of a saved version, shown in the version list', 'by_design'),
('website_versions', 'pages_snapshot', 'read by restore_website_version and the site image functions in the database; encrypting it needs those changed first', 'deferred'),
('website_versions', 'website_snapshot', 'read by restore_website_version and the site image functions in the database; encrypting it needs those changed first', 'deferred'),
('websites', 'custom_domain', 'the website address, looked up for every visit', 'by_design'),
('websites', 'html', 'the account website itself, served to every visitor once the site is published', 'by_design'),
('websites', 'name', 'the account website itself, served to every visitor once the site is published', 'by_design'),
('websites', 'prompt', 'read by the database functions that restore a version and move site images; encrypting it needs those changed first', 'deferred'),
('websites', 'subdomain', 'the website address, looked up for every visit', 'by_design'),
('websites', 'tagline', 'the account website itself, served to every visitor once the site is published', 'by_design'),
('websites', 'theme', 'the account website itself, served to every visitor once the site is published', 'by_design'),
('websites', 'title', 'the account website itself, served to every visitor once the site is published', 'by_design'),
('action_reversals', 'provider', 'name of an action, provider, model or rule', 'by_design'),
('action_reversals', 'tool', 'name of an action, provider, model or rule', 'by_design'),
('action_reversals', 'undo_kind', 'status or type value set by the system', 'by_design'),
('action_reversals', 'undo_effect', 'system-written description of what undoing does', 'by_design'),
('action_reversals', 'irreversible_reason', 'error text, scrubbed of secrets before it is stored', 'by_design'),
('action_reversals', 'ref', 'id, hash or reference, no content', 'by_design'),
('action_reversals', 'status', 'status or type value set by the system', 'by_design'),
('action_reversals', 'summary', 'system-written result of an undo', 'by_design'),
('action_reversals', 'error', 'error text, scrubbed of secrets before it is stored', 'by_design'),
('agent_memory', 'source', 'status or type value set by the system', 'by_design'),
('agent_reports', 'kind', 'status or type value set by the system', 'by_design'),
('generation_cache', 'kind', 'status or type value set by the system', 'by_design'),
('generation_cache', 'cache_key', 'id, hash or reference, no content', 'by_design'),
('idempotency_keys', 'idempotency_key', 'id, hash or reference, no content', 'by_design'),
('org_insights', 'kind', 'status or type value set by the system', 'by_design'),
('org_insights', 'confidence', 'status or type value set by the system', 'by_design'),
('webhook_deliveries', 'event', 'name of an action, provider, model or rule', 'by_design'),
('webhook_deliveries', 'error', 'error text, scrubbed of secrets before it is stored', 'by_design')
ON CONFLICT (table_name, column_name) DO UPDATE SET reason = EXCLUDED.reason, kind = EXCLUDED.kind;

-- Kept empty: a column no code uses, and a legacy table no code writes. Any value would be content stored in the clear.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_user_context_kept_empty') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_user_context_kept_empty CHECK (user_context = '{}'::jsonb);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_html_kept_empty') THEN
    ALTER TABLE public.projects ADD CONSTRAINT projects_html_kept_empty CHECK (html = '');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_prompt_kept_empty') THEN
    ALTER TABLE public.projects ADD CONSTRAINT projects_prompt_kept_empty CHECK (prompt IS NULL OR prompt = '');
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 3. Where each secret may be stored.

CREATE TABLE IF NOT EXISTS public.secret_storage_rules (
  table_name text NOT NULL,
  column_name text NOT NULL,
  rule text NOT NULL CHECK (rule IN ('vault_only', 'hash_only', 'short_lived', 'link_token')),
  note text,
  PRIMARY KEY (table_name, column_name)
);
ALTER TABLE public.secret_storage_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.secret_storage_rules FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.secret_storage_rules TO service_role;
INSERT INTO public.isolation_tables (table_name, access, owner_column, read_all_reason, note)
VALUES ('secret_storage_rules', 'system_only', NULL, NULL, 'where each SECRET column may hold its value (docs/data-classification.md)')
ON CONFLICT (table_name) DO NOTHING;

INSERT INTO public.secret_storage_rules (table_name, column_name, rule, note) VALUES
('agent_integrations', 'credentials', 'vault_only', 'tokens live in the vault (credentials_secret_id)'),
('api_keys', 'callback_secret', 'vault_only', 'the callback signing secret lives in the vault (callback_secret_id)'),
('webhooks', 'secret', 'vault_only', 'the signing secret lives in the vault (secret_id)'),
('webhooks', 'previous_secret', 'vault_only', 'the previous signing secret lives in the vault (previous_secret_id)'),
('api_keys', 'key_hash', 'hash_only', 'SHA-256 of the key, never the key'),
('canva_oauth_transactions', 'state', 'short_lived', 'a sign-in in progress'),
('canva_oauth_transactions', 'code_verifier', 'short_lived', 'a sign-in in progress'),
('figma_oauth_transactions', 'state', 'short_lived', 'a sign-in in progress'),
('gmail_oauth_transactions', 'state', 'short_lived', 'a sign-in in progress'),
('notion_oauth_transactions', 'state', 'short_lived', 'a sign-in in progress'),
('shopify_oauth_transactions', 'state', 'short_lived', 'a sign-in in progress'),
('slack_oauth_transactions', 'state', 'short_lived', 'a sign-in in progress'),
('email_unsubscribe_tokens', 'token', 'link_token', 'the random part of an unsubscribe link, needed to honour it')
ON CONFLICT (table_name, column_name) DO UPDATE SET rule = EXCLUDED.rule, note = EXCLUDED.note;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_integrations_credentials_vault_only') THEN
    ALTER TABLE public.agent_integrations ADD CONSTRAINT agent_integrations_credentials_vault_only CHECK (credentials = '{}'::jsonb);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_callback_secret_vault_only') THEN
    ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_callback_secret_vault_only CHECK (callback_secret IS NULL OR callback_secret = '');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhooks_secret_vault_only') THEN
    ALTER TABLE public.webhooks ADD CONSTRAINT webhooks_secret_vault_only CHECK (secret = '');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhooks_previous_secret_vault_only') THEN
    ALTER TABLE public.webhooks ADD CONSTRAINT webhooks_previous_secret_vault_only CHECK (previous_secret IS NULL OR previous_secret = '');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_key_hash_hash_only') THEN
    ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_key_hash_hash_only CHECK (key_hash ~ '^[0-9a-f]{64}$');
  END IF;
END $$;

-- What is wrong with how a secret is stored, if anything.
CREATE OR REPLACE FUNCTION public.secret_storage_report()
RETURNS TABLE (problem text, table_name text, column_name text, detail text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE r record; n bigint;
BEGIN
  -- a SECRET column with no storage rule
  FOR r IN SELECT d.table_name, d.column_name FROM public.data_classification d
            WHERE d.class = 'SECRET' AND NOT EXISTS (SELECT 1 FROM public.secret_storage_rules s WHERE s.table_name = d.table_name AND s.column_name = d.column_name) LOOP
    problem := 'no_rule'; table_name := r.table_name; column_name := r.column_name; detail := 'a SECRET column needs a row in secret_storage_rules';
    RETURN NEXT;
  END LOOP;
  FOR r IN SELECT * FROM public.secret_storage_rules s WHERE to_regclass(format('public.%I', s.table_name)) IS NOT NULL LOOP
    table_name := r.table_name; column_name := r.column_name;
    IF r.rule IN ('vault_only', 'hash_only') AND NOT EXISTS (
         SELECT 1 FROM pg_constraint WHERE conname = left(r.table_name || '_' || r.column_name || '_' || r.rule, 63) AND convalidated) THEN
      problem := 'unenforced'; detail := format('no validated check %s_%s_%s', r.table_name, r.column_name, r.rule);
      RETURN NEXT;
    ELSIF r.rule = 'short_lived' THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE created_at < now() - interval %L', r.table_name, '1 hour') INTO n;
      IF n > 0 THEN problem := 'kept_too_long'; detail := format('%s row(s) older than an hour', n); RETURN NEXT; END IF;
    END IF;
  END LOOP;
END $fn$;
REVOKE ALL ON FUNCTION public.secret_storage_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.secret_storage_report() TO service_role;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 4. Retention.

-- A sign-in that was never finished, and visitor addresses kept to count requests: removed every hour.
CREATE OR REPLACE FUNCTION public.purge_short_lived_rows()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE t text; n bigint; total bigint := 0; ips bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['canva_oauth_transactions', 'figma_oauth_transactions', 'gmail_oauth_transactions',
                           'notion_oauth_transactions', 'shopify_oauth_transactions', 'slack_oauth_transactions'] LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DELETE FROM public.%I WHERE created_at < now() - interval %L', t, '1 hour');
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
  END LOOP;
  DELETE FROM public.ip_rate_limit_windows WHERE window_start < now() - interval '1 day';
  GET DIAGNOSTICS ips = ROW_COUNT;
  RETURN jsonb_build_object('oauth_sign_ins', total, 'rate_limit_windows', ips);
END $fn$;
REVOKE ALL ON FUNCTION public.purge_short_lived_rows() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_short_lived_rows() TO service_role;

-- Raw replies of a connected tool, kept with a finished session's steps: removed after 30 days. What stays: the checked result
-- (outer_control_evaluations), the step's verdict, status and error, and the fingerprints. Live data snapshots likewise.
CREATE OR REPLACE FUNCTION public.expire_raw_replies(_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE days integer := GREATEST(coalesce(_days, 30), 7); steps bigint; snaps bigint;
BEGIN
  UPDATE public.outer_control_session_steps st SET reply_text = NULL, reply_text_enc = NULL
   WHERE (st.reply_text_enc IS NOT NULL OR st.reply_text IS NOT NULL)
     AND st.created_at < now() - make_interval(days => days)
     AND EXISTS (SELECT 1 FROM public.outer_control_sessions s WHERE s.id = st.session_id
                  AND s.status IN ('completed', 'failed', 'stopped', 'rejected', 'cancelled', 'skipped'));
  GET DIAGNOSTICS steps = ROW_COUNT;
  DELETE FROM public.integration_snapshots WHERE fetched_at < now() - make_interval(days => days);
  GET DIAGNOSTICS snaps = ROW_COUNT;
  RETURN jsonb_build_object('step_replies_removed', steps, 'snapshots_removed', snaps, 'days', days);
END $fn$;
REVOKE ALL ON FUNCTION public.expire_raw_replies(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_raw_replies(integer) TO service_role;

SELECT public.purge_short_lived_rows();

DO $$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;
  PERFORM cron.schedule('purge-short-lived-rows', '23 * * * *', 'SELECT public.purge_short_lived_rows()');
  PERFORM cron.schedule('expire-raw-replies', '37 2 * * *', 'SELECT public.expire_raw_replies(30)');
END $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- The account summary used by simulate-scenario and analyze-org-insights: the clients' details, the insights and the report text
-- now come back sealed ("<col>_enc", with the row id) and are opened by the server (_shared/business-context.ts).

CREATE OR REPLACE FUNCTION public.get_business_context(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  result jsonb;
  v_agents jsonb;
  v_clients jsonb;
  v_insights jsonb;
  v_reports jsonb;
  v_artifacts jsonb;
  v_total_actions int;
  v_ok_actions int;
  v_success_rate numeric;
  v_most_active jsonb;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required';
  END IF;
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM _user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id, 'name', a.name, 'slug', a.slug, 'goal', a.goal,
    'status', a.status, 'role', a.role,
    'schedule_cron', a.schedule_cron, 'next_run_at', a.next_run_at,
    'updated_at', a.updated_at
  ) ORDER BY a.updated_at DESC), '[]'::jsonb)
  INTO v_agents
  FROM public.agents a WHERE a.user_id = _user_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id, 'agent_id', c.agent_id, 'name', c.name, 'email', c.email,
    'company', c.company, 'tags', c.tags, 'notes', c.notes,
    'name_enc', c.name_enc, 'company_enc', c.company_enc, 'tags_enc', c.tags_enc, 'notes_enc', c.notes_enc,
    'interaction_count', c.interaction_count,
    'last_interaction_at', c.last_interaction_at
  ) ORDER BY c.last_interaction_at DESC NULLS LAST), '[]'::jsonb)
  INTO v_clients
  FROM public.agent_clients c WHERE c.user_id = _user_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', i.id, 'insight', i.insight, 'insight_enc', i.insight_enc, 'kind', i.kind,
    'confidence', i.confidence, 'evidence_count', i.evidence_count,
    'source_agent_ids', i.source_agent_ids,
    'first_observed_at', i.first_observed_at,
    'last_confirmed_at', i.last_confirmed_at
  ) ORDER BY i.evidence_count DESC, i.last_confirmed_at DESC), '[]'::jsonb)
  INTO v_insights
  FROM public.org_insights i WHERE i.user_id = _user_id;

  SELECT COALESCE(jsonb_agg(r ORDER BY created_at DESC), '[]'::jsonb) INTO v_reports
  FROM (
    SELECT jsonb_build_object(
      'id', id, 'agent_id', agent_id, 'run_id', run_id,
      'title', title, 'kind', kind,
      'body_markdown', left(body_markdown, 2000), 'body_markdown_enc', body_markdown_enc,
      'created_at', created_at
    ) AS r, created_at
    FROM public.agent_reports
    WHERE user_id = _user_id
    ORDER BY created_at DESC
    LIMIT 20
  ) sub;

  SELECT COALESCE(jsonb_agg(r ORDER BY created_at DESC), '[]'::jsonb) INTO v_artifacts
  FROM (
    SELECT jsonb_build_object(
      'id', id, 'agent_id', agent_id, 'run_id', run_id,
      'kind', kind, 'title', title, 'url', url,
      'provider', provider, 'account_email', account_email,
      'ref', ref, 'created_at', created_at
    ) AS r, created_at
    FROM public.agent_artifacts
    WHERE user_id = _user_id
    ORDER BY created_at DESC
    LIMIT 30
  ) sub;

  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE COALESCE(payload_ok, (payload->>'ok')::boolean) IS TRUE)::int
  INTO v_total_actions, v_ok_actions
  FROM public.agent_events
  WHERE user_id = _user_id AND kind = 'action';

  v_success_rate := CASE WHEN v_total_actions > 0
    THEN round((v_ok_actions::numeric / v_total_actions::numeric) * 100, 1)
    ELSE 0 END;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'agent_id', agent_id, 'action_count', cnt
  ) ORDER BY cnt DESC), '[]'::jsonb) INTO v_most_active
  FROM (
    SELECT agent_id, COUNT(*)::int AS cnt
    FROM public.agent_events
    WHERE user_id = _user_id AND kind = 'action'
      AND created_at > now() - interval '30 days'
    GROUP BY agent_id
    ORDER BY cnt DESC
    LIMIT 5
  ) t;

  result := jsonb_build_object(
    'user_id', _user_id,
    'generated_at', now(),
    'agents', v_agents,
    'clients', v_clients,
    'insights', v_insights,
    'recent_reports', v_reports,
    'recent_artifacts', v_artifacts,
    'stats', jsonb_build_object(
      'total_actions', v_total_actions,
      'successful_actions', v_ok_actions,
      'success_rate_pct', v_success_rate,
      'most_active_agents_30d', v_most_active
    )
  );

  RETURN result;
END;
$fn$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- The checks: a content column with neither encryption nor a recorded reason, and a secret stored against its rule, are problems.

CREATE OR REPLACE FUNCTION public.classification_report()
RETURNS TABLE (problem text, table_name text, column_name text, detail text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  -- a column that holds content but has no class
  SELECT 'unclassified', l.table_name, l.column_name, l.data_type
    FROM public.classifiable_columns() l
   WHERE NOT EXISTS (SELECT 1 FROM public.data_classification d WHERE d.table_name = l.table_name AND d.column_name = l.column_name)
  UNION ALL
  -- a class for a column that no longer exists
  SELECT 'stale', d.table_name, d.column_name, d.class
    FROM public.data_classification d
   WHERE NOT EXISTS (SELECT 1 FROM public.classifiable_columns() l WHERE l.table_name = d.table_name AND l.column_name = d.column_name)
  UNION ALL
  -- a secret a browser session could read: the role may select the column and a policy (or no row-level security) lets rows through
  SELECT 'secret_readable', d.table_name, d.column_name, r.role
    FROM public.data_classification d
    JOIN pg_class k ON k.oid = to_regclass('public.' || quote_ident(d.table_name))
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
   WHERE d.class = 'SECRET'
     AND CASE WHEN EXISTS (SELECT 1 FROM public.classifiable_columns() l WHERE l.table_name = d.table_name AND l.column_name = d.column_name)
              THEN has_column_privilege(r.role, k.oid, d.column_name, 'SELECT') ELSE false END
     AND (NOT k.relrowsecurity OR EXISTS (
           SELECT 1 FROM pg_policies p
            WHERE p.schemaname = 'public' AND p.tablename = d.table_name AND p.cmd IN ('SELECT', 'ALL')
              AND (r.role::name = ANY (p.roles) OR 'public'::name = ANY (p.roles))))
  UNION ALL
  -- a credential stored where it should not be (the secrets handling check)
  SELECT 'secret_exposed', NULL, NULL, to_jsonb(s)::text FROM public.secrets_exposure_report() s
  UNION ALL
  -- an encrypted column whose class says it holds no content
  SELECT 'class_conflict', e.table_name, e.column_name, 'encrypted but classified ' || d.class
    FROM public.encrypted_columns e
    JOIN public.data_classification d ON d.table_name = e.table_name AND d.column_name = e.column_name
   WHERE d.class NOT IN ('PROJECT_CONTENT', 'EXTERNAL_RESPONSE', 'PERSONAL')
  UNION ALL
  -- task 3: a content column that is neither encrypted nor exempt with a recorded reason
  SELECT 'content_unprotected', g.table_name, g.column_name, g.class FROM public.classification_gaps() g
  UNION ALL
  -- task 3: a secret stored against its rule (in the table instead of the vault, not a hash, kept too long, or no rule)
  SELECT 'secret_storage:' || s.problem, s.table_name, s.column_name, s.detail FROM public.secret_storage_report() s
$fn$;
REVOKE ALL ON FUNCTION public.classification_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.classification_report() TO service_role;

CREATE OR REPLACE FUNCTION public.data_classification_weekly_check()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE problems jsonb; deferred jsonb; open_id uuid; result jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]') INTO problems FROM public.classification_report() r;
  SELECT coalesce(jsonb_agg(x.table_name || '.' || x.column_name ORDER BY 1), '[]') INTO deferred
    FROM public.encryption_exempt_columns x WHERE x.kind = 'deferred';
  result := jsonb_build_object('problems', problems, 'deferred_columns', deferred, 'checked_at', now());
  SELECT id INTO open_id FROM public.platform_incidents WHERE kind = 'data_classification' AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1;
  IF jsonb_array_length(problems) > 0 THEN
    IF open_id IS NULL THEN
      INSERT INTO public.platform_incidents (kind, summary, detail) VALUES ('data_classification',
        format('Data classification check: %s problem(s). A new column needs a class (data-classes.ts and a data_classification row); '
          || 'a content column needs encrypting or a recorded reason; a secret must be stored by its rule; a removed column needs its '
          || 'row deleted; a readable or exposed secret is fixed at once (docs/data-classification.md).',
          jsonb_array_length(problems)), result);
    ELSE
      UPDATE public.platform_incidents SET detail = result WHERE id = open_id;
    END IF;
  ELSIF open_id IS NOT NULL THEN
    UPDATE public.platform_incidents SET resolved_at = now(), resolution_note = 'Every column classified, every content column protected, every secret stored by its rule.' WHERE id = open_id;
  END IF;
  RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.data_classification_weekly_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_classification_weekly_check() TO service_role;

-- New columns get their class (the register in data-classes.ts lists the same).
INSERT INTO public.data_classification (table_name, column_name, class) VALUES
('encryption_exempt_columns', 'kind', 'OPERATIONAL'),
('secret_storage_rules', 'column_name', 'OPERATIONAL'),
('secret_storage_rules', 'note', 'OPERATIONAL'),
('secret_storage_rules', 'rule', 'OPERATIONAL'),
('secret_storage_rules', 'table_name', 'OPERATIONAL')
ON CONFLICT (table_name, column_name) DO UPDATE SET class = EXCLUDED.class;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 1 (continued). Lock the new encrypted columns: every one holds no plain value.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT e.table_name, e.column_name FROM public.encrypted_columns e
            WHERE e.note = 'Encrypted with DATA_KEY (encrypted-db.ts); data at rest, task 3.' AND e.enforced_at IS NULL LOOP
    PERFORM public.encryption_enforce(r.table_name, r.column_name);
  END LOOP;
END $$;
