-- Complete account erasure (docs/account-erasure.md).
--
-- Until now "request deletion" removed governance data only. A customer can now delete the whole account: the request waits 7 days (and
-- can be cancelled), then erase_account() removes every row that belongs to the person, the stored secrets, and the login itself.
-- Files in storage follow through the daily image/upload sweep; encrypted governance backups age out after 30 days.

ALTER TABLE public.data_deletion_requests ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'governance' CHECK (scope IN ('governance', 'account'));
INSERT INTO public.data_classification (table_name, column_name, class) VALUES ('data_deletion_requests', 'scope', 'OPERATIONAL')
ON CONFLICT (table_name, column_name) DO UPDATE SET class = EXCLUDED.class;

-- A record that an erasure happened, with nothing that names the person: a hash of the id, the date, and how many rows went from each table.
CREATE TABLE IF NOT EXISTS public.account_erasures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  erased_at timestamptz NOT NULL DEFAULT now(),
  user_hash text NOT NULL CHECK (user_hash ~ '^[0-9a-f]{64}$'),
  counts jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.account_erasures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_erasures FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO public.isolation_tables (table_name, access, owner_column, read_all_reason, note) VALUES
('account_erasures', 'system_only', NULL, NULL, 'proof that an account was erased: hash of the id, date, row counts; nothing that names the person')
ON CONFLICT (table_name) DO NOTHING;
INSERT INTO public.data_classification (table_name, column_name, class) VALUES
('account_erasures', 'user_hash', 'OPERATIONAL'),
('account_erasures', 'counts', 'OPERATIONAL')
ON CONFLICT (table_name, column_name) DO UPDATE SET class = EXCLUDED.class;

-- Which registered owner tables go with the login by themselves (a foreign key to auth.users that cascades), and which must be
-- deleted by erase_account(). New tables are picked up from the register, so none is left behind.
CREATE OR REPLACE FUNCTION public.erasure_plan()
RETURNS TABLE(table_name text, owner_column text, cascades boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT i.table_name, i.owner_column,
    EXISTS (SELECT 1 FROM pg_constraint c
            WHERE c.contype = 'f' AND c.conrelid = to_regclass(format('public.%I', i.table_name)) AND c.confrelid = 'auth.users'::regclass
              AND c.confdeltype = 'c'
              AND c.conkey = ARRAY(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attname = i.owner_column))
  FROM public.isolation_tables i
  WHERE i.owner_column IS NOT NULL AND to_regclass(format('public.%I', i.table_name)) IS NOT NULL;
$fn$;

-- Tables that mention a person but are not owner tables in the register, and how erase_account() handles each. Anything else found by
-- erasure_gaps() is a table nobody decided about.
CREATE OR REPLACE FUNCTION public.erasure_gaps()
RETURNS TABLE(object text, detail text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  WITH handled(name) AS (VALUES
    ('account_members'), ('security_evidence'), ('security_evidence_heads'), ('vault_secret_owners'),
    ('email_send_log'), ('email_unsubscribe_tokens'), ('free_limit_exempt_emails'), ('suppressed_emails'),
    ('incidents'), ('pending_approvals'), ('confidence_bucket_flags'), ('platform_incidents'), ('platform_settings')),
  cols AS (
    SELECT k.table_name::text AS t, k.column_name::text AS c, k.data_type
    FROM information_schema.columns k JOIN pg_class cl ON cl.relname = k.table_name AND cl.relnamespace = 'public'::regnamespace AND cl.relkind IN ('r', 'p')
    WHERE k.table_schema = 'public'
  )
  SELECT 'broken_register', i.table_name || '.' || i.owner_column
    FROM public.isolation_tables i
   WHERE i.owner_column IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM cols WHERE t = i.table_name AND c = i.owner_column)
  UNION ALL
  SELECT 'person_not_erased', cols.t || '.' || cols.c
    FROM cols LEFT JOIN public.isolation_tables i ON i.table_name = cols.t
   WHERE cols.t NOT IN (SELECT name FROM handled)
     AND (
       (cols.data_type = 'uuid' AND cols.c IN ('user_id', 'owner_id', 'account_owner_id', 'member_id', 'created_by', 'invited_by', 'resolved_by', 'assigned_to', 'acknowledged_by', 'cleared_by', 'decided_by')
         AND i.owner_column IS DISTINCT FROM cols.c)
       OR (cols.data_type IN ('text', 'character varying', 'USER-DEFINED') AND (cols.c = 'email' OR cols.c LIKE '%\_email') AND i.owner_column IS NULL)
     )
  ORDER BY 1, 2;
$fn$;

CREATE OR REPLACE FUNCTION public.erase_account(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, vault, pg_temp AS $fn$
DECLARE
  email_addr text; counts jsonb := '{}'::jsonb; n bigint; t record; passes int := 0; progress boolean; remaining text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT lower(u.email) INTO email_addr FROM auth.users u WHERE u.id = _user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'no such account' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _user_id AND r.role::text IN ('owner', 'admin')) THEN
    RAISE EXCEPTION 'platform staff accounts are not erased here' USING ERRCODE = '42501';
  END IF;

  -- 1. Owner tables that do not go with the login by themselves. Children may block parents: repeat until nothing is left or nothing moves.
  DROP TABLE IF EXISTS _erase_todo;
  CREATE TEMP TABLE _erase_todo ON COMMIT DROP AS
    SELECT p.table_name, p.owner_column FROM public.erasure_plan() p
     WHERE NOT p.cascades AND p.table_name NOT IN ('security_evidence', 'account_members');
  LOOP
    passes := passes + 1; progress := false;
    FOR t IN SELECT * FROM _erase_todo LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE %I = $1', t.table_name, t.owner_column) USING _user_id;
        GET DIAGNOSTICS n = ROW_COUNT;
        counts := counts || jsonb_build_object(t.table_name, n);
        DELETE FROM _erase_todo WHERE table_name = t.table_name;
        progress := true;
      EXCEPTION WHEN foreign_key_violation THEN NULL;
      END;
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM _erase_todo) OR NOT progress OR passes >= 6;
  END LOOP;
  SELECT string_agg(table_name, ', ') INTO remaining FROM _erase_todo;
  IF remaining IS NOT NULL THEN RAISE EXCEPTION 'could not erase: %', remaining; END IF;

  -- 2. The person as a member of other accounts, and invitations sent to their address.
  DELETE FROM public.account_members WHERE member_id = _user_id OR (email_addr IS NOT NULL AND lower(email) = email_addr);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('account_members_elsewhere', n);

  -- 3. Rows kept by address: mail log and unsubscribe links. (The suppression list stays: it is how an opt-out is honoured.)
  IF email_addr IS NOT NULL THEN
    DELETE FROM public.email_send_log WHERE lower(recipient_email) = email_addr;
    GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('email_send_log', n);
    DELETE FROM public.email_unsubscribe_tokens WHERE lower(email) = email_addr;
    DELETE FROM public.free_limit_exempt_emails WHERE lower(email) = email_addr;
  END IF;

  -- 4. Stored secrets that belong to the person.
  DELETE FROM vault.secrets WHERE id IN (SELECT secret_id FROM public.vault_secret_owners WHERE user_id = _user_id);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('vault_secrets', n);
  DELETE FROM public.vault_secret_owners WHERE user_id = _user_id;

  -- 5. The login. Everything with a cascading link to it goes with it (sessions, factors, the cascading owner tables).
  DELETE FROM auth.users WHERE id = _user_id;

  -- 6. The signed security record: its rows can be removed only once the account no longer exists.
  DELETE FROM public.security_evidence WHERE user_id = _user_id;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('security_evidence', n);
  DELETE FROM public.security_evidence_heads WHERE user_id = _user_id;

  -- 7. Prove it: nothing may be left in any registered owner table.
  FOR t IN SELECT * FROM public.erasure_plan() LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1', t.table_name, t.owner_column) INTO n USING _user_id;
    IF n > 0 THEN RAISE EXCEPTION 'rows left in %: %', t.table_name, n; END IF;
  END LOOP;

  INSERT INTO public.account_erasures (user_hash, counts) VALUES (encode(extensions.digest(_user_id::text, 'sha256'), 'hex'), counts);
  RETURN counts;
END $fn$;

-- The request: a signed-in person asks (their code is needed), 7 days to change their mind.
CREATE OR REPLACE FUNCTION public.request_account_erasure()
RETURNS public.data_deletion_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE uid uuid := auth.uid(); existing public.data_deletion_requests; created public.data_deletion_requests;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.session_mfa_ok() THEN RAISE EXCEPTION 'two-step sign-in required' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = uid AND r.role::text IN ('owner', 'admin')) THEN
    RAISE EXCEPTION 'Platform staff accounts are not deleted here' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO existing FROM public.data_deletion_requests WHERE user_id = uid AND status = 'pending' AND scope = 'account';
  IF existing.id IS NOT NULL THEN RETURN existing; END IF;
  -- a pending governance-only request is replaced by this one, which covers it
  UPDATE public.data_deletion_requests SET status = 'cancelled', cancelled_at = now() WHERE user_id = uid AND status = 'pending' AND scope = 'governance';
  INSERT INTO public.data_deletion_requests (user_id, requested_by, execute_at, scope) VALUES (uid, uid, now() + interval '7 days', 'account') RETURNING * INTO created;
  RETURN created;
END $fn$;

-- The older governance-only request now looks only at governance requests (and has the two-step check from the previous migration).
CREATE OR REPLACE FUNCTION public.request_data_deletion()
RETURNS public.data_deletion_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE uid uuid := auth.uid(); existing public.data_deletion_requests; created public.data_deletion_requests;
BEGIN
  IF NOT public.session_mfa_ok() THEN RAISE EXCEPTION 'two-step sign-in required' USING ERRCODE = '42501'; END IF;
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO existing FROM public.data_deletion_requests WHERE user_id = uid AND status = 'pending' AND scope = 'governance';
  IF existing.id IS NOT NULL THEN RETURN existing; END IF;
  INSERT INTO public.data_deletion_requests (user_id, requested_by, execute_at, scope) VALUES (uid, uid, now() + interval '7 days', 'governance') RETURNING * INTO created;
  RETURN created;
END $fn$;

REVOKE ALL ON FUNCTION public.erase_account(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.erasure_plan() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.erasure_gaps() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erase_account(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.erasure_plan() TO service_role;
GRANT EXECUTE ON FUNCTION public.erasure_gaps() TO service_role;
REVOKE ALL ON FUNCTION public.request_account_erasure() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_account_erasure() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.request_data_deletion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_data_deletion() TO authenticated, service_role;

-- The weekly isolation check now also fails on a signed-in-callable database function without the two-step check, and on a table that
-- mentions a person but that account erasure does not cover (erasure_gaps()).
CREATE OR REPLACE FUNCTION public.isolation_report()
RETURNS TABLE(kind text, object text, detail text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
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
    WHERE p.polroles && ARRAY[0::oid, 'anon'::regrole::oid, 'authenticated'::regrole::oid] AND p.polpermissive
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
    FROM pol WHERE q <> 'true' AND w <> 'true' AND read_all_reason IS NULL
      AND (q || ' ' || w) !~ '(auth\.uid\(\)|auth\.role\(\)|auth\.jwt\(\)|is_account_member\(|has_role\(|can_access\()'
  UNION ALL
  SELECT 'system_table_exposed', name || ' / ' || polname, left(cmd || ': ' || coalesce(nullif(q, ''), w), 200)
    FROM pol WHERE access = 'system_only' AND (q || ' ' || w) !~ 'auth\.role\(\) = ''service_role'''
  UNION ALL
  SELECT 'owner_nullable', t.name || '.' || t.owner_column, 'the owner column can be empty'
    FROM tbl t JOIN information_schema.columns k ON k.table_schema = 'public' AND k.table_name = t.name AND k.column_name = t.owner_column
    WHERE t.access IN ('owner', 'team', 'public_by_link') AND k.is_nullable = 'YES'
  UNION ALL
  SELECT 'owner_unguarded', t.name || '.' || t.owner_column, 'a signed-in user could change the owner of a row (no prevent_owner_change trigger)'
    FROM tbl t
    WHERE to_regprocedure('public.prevent_owner_change()') IS NOT NULL
      AND t.owner_column IS NOT NULL AND t.access IN ('owner', 'team', 'public_by_link', 'self', 'membership')
      AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = t.name AND k.column_name = t.owner_column)
      AND NOT EXISTS (SELECT 1 FROM pg_trigger g JOIN pg_proc f ON f.oid = g.tgfoid
                      WHERE g.tgrelid = t.oid AND NOT g.tgisinternal AND f.proname = 'prevent_owner_change' AND f.pronamespace = 'public'::regnamespace)
  UNION ALL
  SELECT 'two_step_missing', t.name, 'an account-data table without the restrictive two-step rule (' ||
      CASE WHEN t.access = 'public_by_link' THEN 'two_step_required_insert/update/delete' ELSE 'two_step_required' END || ')'
    FROM tbl t
    WHERE t.rls AND t.access IN ('owner', 'team', 'self', 'membership', 'public_by_link')
      AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = t.oid AND NOT p.polpermissive AND p.polname LIKE 'two\_step\_required%')
          < CASE WHEN t.access = 'public_by_link' THEN 3 ELSE 1 END
  UNION ALL
  SELECT 'realtime_exposed', t.name, 'rows of this table are pushed live to subscribers, but its access type is ' || coalesce(t.access, 'unregistered') || ' (live updates are for owner, team, self or membership tables only)'
    FROM tbl t JOIN pg_publication_rel r ON r.prrelid = t.oid JOIN pg_publication pub ON pub.oid = r.prpubid AND pub.pubname = 'supabase_realtime'
    WHERE t.access IS DISTINCT FROM 'owner' AND t.access IS DISTINCT FROM 'team' AND t.access IS DISTINCT FROM 'self' AND t.access IS DISTINCT FROM 'membership'
  UNION ALL
  SELECT 'realtime_broadcast_open', 'realtime.messages / ' || p.polname::text, 'a broadcast or presence channel rule lets everyone in (' || coalesce(pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid), 'no condition') || ')'
    FROM pg_policy p
    WHERE p.polrelid = to_regclass('realtime.messages')
      AND (coalesce(pg_get_expr(p.polqual, p.polrelid), 'true') = 'true' AND coalesce(pg_get_expr(p.polwithcheck, p.polrelid), 'true') = 'true')
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
      AND p.proname NOT IN (SELECT function_name FROM public.isolation_public_functions)
  UNION ALL
  SELECT 'two_step_missing_function', p.oid::regprocedure::text, 'a function that runs as the database owner, callable by signed-in users, acts for the caller (auth.uid()) but never asks for the two-step code (session_mfa_ok())'
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef AND p.prorettype <> 'trigger'::regtype
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND p.prosrc ~ 'auth\.uid\(\)' AND p.prosrc !~ 'session_mfa_ok\(\)'
      AND p.proname NOT IN ('can_access', 'has_role', 'is_account_member', 'session_mfa_ok', 'verify_decision_signature', 'verify_decision_signatures_batch', 'verify_decision_signatures_batch_for',
                            'get_consequential_sweep_activity', 'get_sweep_job_last_runs', 'onboarding_feedback_recent', 'onboarding_feedback_summary')
  UNION ALL
  SELECT 'erasure_missing', g.object, g.detail FROM public.erasure_gaps() g
  ORDER BY 1, 2;
$fn$;
