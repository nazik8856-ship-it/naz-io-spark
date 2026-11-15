-- Release check: 20261115040000 closes the visitor / signed-in door in front of SECURITY DEFINER functions that do not need it,
-- and leaves open the ones that do. The functions here are stand-ins with the same names and arguments, given the grants a Supabase
-- project gives every new function (to PUBLIC, anon, authenticated and service_role); what is tested is who may call them afterwards.
\set ON_ERROR_STOP 1
RESET ROLE;
CREATE OR REPLACE FUNCTION pg_temp.check(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', what; END IF; END $$;

-- stand-ins, with the default grants
DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY[
    'consume_canva_oauth_transaction(_state text)', 'consume_figma_oauth_transaction(_state text)', 'consume_gmail_oauth_transaction(_state text)',
    'consume_notion_oauth_transaction(_state text)', 'consume_shopify_oauth_transaction(_state text)', 'consume_slack_oauth_transaction(_state text)',
    'get_business_context(_user_id uuid)', 'verify_decision_signature(_id uuid)',
    'read_webhook_secret(_agent_id uuid)', 'rotate_webhook_secret(_agent_id uuid)', 'rotate_webhook_secret(_webhook_id uuid, _new_secret text, _grace_hours integer)',
    'record_approval_signoff(_approval_id uuid, _vote text, _comment text, _reason_code text)',
    'verify_decision_signatures_batch(_from timestamptz, _to timestamptz, _limit integer, _account_owner_id uuid)',
    'has_role(_user_id uuid, _role text)', 'is_account_member(_o uuid, _r text, _p text)', 'session_mfa_ok()', 'can_access(_owner uuid, _min_role text)',
    'get_public_site(_ref text, _meta_only boolean)', 'add_project_time(p_kind text, p_id uuid, p_seconds integer)'
  ] LOOP
    BEGIN
      EXECUTE format('CREATE FUNCTION public.%s RETURNS %s LANGUAGE plpgsql SECURITY DEFINER AS $f$ BEGIN RETURN %s; END $f$',
        s, CASE WHEN s LIKE 'session_mfa_ok%' OR s LIKE 'has_role%' OR s LIKE 'is_account_member%' OR s LIKE 'can_access%' THEN 'boolean' ELSE 'text' END,
        CASE WHEN s LIKE 'session_mfa_ok%' OR s LIKE 'has_role%' OR s LIKE 'is_account_member%' OR s LIKE 'can_access%' THEN 'true' ELSE '''x''' END);
    EXCEPTION WHEN OTHERS THEN NULL; -- one with this name and arguments is already in the test database: use it as it is
    END;
  END LOOP;
  FOREACH s IN ARRAY ARRAY['guard_decision_human_response','guard_kill_switch','guard_pending_approval_update','log_config_change','log_profile_config_change','set_account_member_invited_by','set_platform_incident_resolved_by','sign_agent_decision'] LOOP
    EXECUTE format('CREATE OR REPLACE FUNCTION public.%I() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $f$ BEGIN RETURN NEW; END $f$', s);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I() TO PUBLIC, anon, authenticated, service_role', s);
  END LOOP;
END $$;
-- every copy of these functions starts with the grants a new Supabase function gets
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND (p.proname LIKE 'consume\_%\_oauth\_transaction' OR p.proname IN ('guard_decision_human_response','guard_kill_switch','guard_pending_approval_update','log_config_change','log_profile_config_change','set_account_member_invited_by','set_platform_incident_resolved_by','sign_agent_decision','get_business_context','verify_decision_signature','read_webhook_secret','rotate_webhook_secret','record_approval_signoff','verify_decision_signatures_batch','has_role','is_account_member','session_mfa_ok','can_access','get_public_site','add_project_time')) LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC, anon, authenticated, service_role', r.sig);
  END LOOP;
END $$;
-- a trigger that already exists keeps firing after the revoke
CREATE TABLE IF NOT EXISTS public.fa_probe (id int, note text);
DROP TRIGGER IF EXISTS fa_probe_guard ON public.fa_probe;
CREATE TRIGGER fa_probe_guard BEFORE INSERT ON public.fa_probe FOR EACH ROW EXECUTE FUNCTION public.guard_kill_switch();

\ir ../../migrations/20261115040000_close_function_access.sql
\ir ../../migrations/20261115040000_close_function_access.sql

-- true when the role can run EVERY copy (every argument list) of the named functions
CREATE OR REPLACE FUNCTION pg_temp.can(r text, VARIADIC names text[]) RETURNS boolean LANGUAGE sql AS $$
  SELECT coalesce(bool_and(has_function_privilege(r, p.oid, 'EXECUTE')), false)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = ANY (names) $$;
CREATE OR REPLACE FUNCTION pg_temp.cannot(r text, VARIADIC names text[]) RETURNS boolean LANGUAGE sql AS $$
  SELECT coalesce(bool_and(NOT has_function_privilege(r, p.oid, 'EXECUTE')), false)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = ANY (names) $$;

-- system only: nobody but the server
SELECT pg_temp.check(pg_temp.cannot('anon', 'consume_canva_oauth_transaction','consume_figma_oauth_transaction','consume_gmail_oauth_transaction','consume_notion_oauth_transaction','consume_shopify_oauth_transaction','consume_slack_oauth_transaction')
  AND pg_temp.cannot('authenticated', 'consume_canva_oauth_transaction','consume_figma_oauth_transaction','consume_gmail_oauth_transaction','consume_notion_oauth_transaction','consume_shopify_oauth_transaction','consume_slack_oauth_transaction')
  AND pg_temp.can('service_role', 'consume_canva_oauth_transaction','consume_figma_oauth_transaction','consume_gmail_oauth_transaction','consume_notion_oauth_transaction','consume_shopify_oauth_transaction','consume_slack_oauth_transaction'), 'all six OAuth consume functions: server only');
SELECT pg_temp.check((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'consume\_%\_oauth\_transaction') = 6, 'six OAuth consume functions were covered');
SELECT pg_temp.check(pg_temp.cannot('anon', 'guard_decision_human_response','guard_kill_switch','guard_pending_approval_update','log_config_change','log_profile_config_change','set_account_member_invited_by','set_platform_incident_resolved_by','sign_agent_decision')
  AND pg_temp.cannot('authenticated', 'guard_decision_human_response','guard_kill_switch','guard_pending_approval_update','log_config_change','log_profile_config_change','set_account_member_invited_by','set_platform_incident_resolved_by','sign_agent_decision')
  AND pg_temp.can('service_role', 'guard_decision_human_response','guard_kill_switch','guard_pending_approval_update','log_config_change','log_profile_config_change','set_account_member_invited_by','set_platform_incident_resolved_by','sign_agent_decision'), 'all eight trigger functions: server only');
SELECT pg_temp.check(pg_temp.cannot('anon', 'get_business_context') AND pg_temp.cannot('authenticated', 'get_business_context') AND pg_temp.can('service_role', 'get_business_context'), 'business context: server only');
SELECT pg_temp.check(pg_temp.cannot('anon', 'verify_decision_signature') AND pg_temp.cannot('authenticated', 'verify_decision_signature') AND pg_temp.can('service_role', 'verify_decision_signature'), 'single signature check: server only');

-- a trigger that was created before still fires
INSERT INTO public.fa_probe VALUES (1, 'still fires');
SELECT pg_temp.check((SELECT count(*) FROM public.fa_probe) = 1, 'a trigger created before the revoke still fires');

-- signed-in only: the browser keeps them, visitors do not
SELECT pg_temp.check(pg_temp.cannot('anon', 'read_webhook_secret','rotate_webhook_secret','record_approval_signoff','verify_decision_signatures_batch')
  AND pg_temp.can('authenticated', 'read_webhook_secret','rotate_webhook_secret','record_approval_signoff','verify_decision_signatures_batch')
  AND pg_temp.can('service_role', 'read_webhook_secret','rotate_webhook_secret','record_approval_signoff','verify_decision_signatures_batch'), 'webhook secret, approval sign-off and batch verification: signed-in people only, no visitors');
SELECT pg_temp.check((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'rotate_webhook_secret') = 2, 'both forms of rotate_webhook_secret were covered');

-- left alone on purpose
SELECT pg_temp.check(pg_temp.can('anon', 'get_public_site'), 'a visitor can still open a published site');
SELECT pg_temp.check(pg_temp.can('anon', 'has_role') AND pg_temp.can('authenticated', 'has_role'), 'row rules still find has_role for whoever asks');
SELECT pg_temp.check(pg_temp.can('anon', 'session_mfa_ok') AND pg_temp.can('authenticated', 'session_mfa_ok'), 'row rules still find session_mfa_ok');
SELECT pg_temp.check(pg_temp.can('authenticated', 'can_access', 'is_account_member') AND pg_temp.can('anon', 'is_account_member'), 'row rules still find can_access and is_account_member');
SELECT pg_temp.check(pg_temp.can('authenticated', 'add_project_time'), 'a function the app calls as the signed-in person is untouched');
SELECT 'function_access_test: all checks passed' AS result;
