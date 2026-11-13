-- Two-step sign-in for customers (docs/two-step-sign-in.md).
--
-- Part A. Until now a customer who turned two-step sign-in on was asked for the code by the website and by the server functions, but
-- their own rows could still be read straight through the database interface by a password-only session. Every table that holds an
-- account's data now also carries a RESTRICTIVE rule: once the person has a confirmed authenticator app, a session that has not used it
-- (aal1) sees and changes nothing. People without the app, aal2 sessions, visitors and the server key are not affected.
--
-- Part B. A way back in when the phone is lost: single-use recovery codes (stored only as SHA-256 hashes), a lock after five wrong tries,
-- and an owner-assisted reset. All three actions write to the signed security record.

-- ---------------------------------------------------------------------------------------------------------------------------
-- Part A. The condition every restrictive rule uses.
CREATE OR REPLACE FUNCTION public.session_mfa_ok()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT coalesce(auth.role(), '') <> 'authenticated'
      OR coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      OR NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = auth.uid() AND f.status = 'verified');
$fn$;
REVOKE ALL ON FUNCTION public.session_mfa_ok() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.session_mfa_ok() TO anon, authenticated, service_role;

-- One restrictive rule per account-data table (the registry is isolation_tables). A table that is public by link keeps its public
-- reading; only its writes need the code.
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT i.table_name, i.access FROM public.isolation_tables i
    JOIN pg_class c ON c.oid = to_regclass(format('public.%I', i.table_name)) AND c.relkind IN ('r', 'p') AND c.relrowsecurity
    WHERE i.access IN ('owner', 'team', 'self', 'membership', 'public_by_link')
  LOOP
    IF r.access = 'public_by_link' THEN
      EXECUTE format('DROP POLICY IF EXISTS two_step_required_insert ON public.%I', r.table_name);
      EXECUTE format('DROP POLICY IF EXISTS two_step_required_update ON public.%I', r.table_name);
      EXECUTE format('DROP POLICY IF EXISTS two_step_required_delete ON public.%I', r.table_name);
      EXECUTE format('CREATE POLICY two_step_required_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.session_mfa_ok()))', r.table_name);
      EXECUTE format('CREATE POLICY two_step_required_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING ((SELECT public.session_mfa_ok())) WITH CHECK ((SELECT public.session_mfa_ok()))', r.table_name);
      EXECUTE format('CREATE POLICY two_step_required_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING ((SELECT public.session_mfa_ok()))', r.table_name);
    ELSE
      EXECUTE format('DROP POLICY IF EXISTS two_step_required ON public.%I', r.table_name);
      EXECUTE format('CREATE POLICY two_step_required ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.session_mfa_ok())) WITH CHECK ((SELECT public.session_mfa_ok()))', r.table_name);
    END IF;
  END LOOP;
END
$do$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- Part B. Recovery codes. Both tables are reached only through the functions below (server key), never directly.
CREATE TABLE IF NOT EXISTS public.mfa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  UNIQUE (user_id, code_hash)
);
CREATE INDEX IF NOT EXISTS mfa_recovery_codes_user_idx ON public.mfa_recovery_codes (user_id);

CREATE TABLE IF NOT EXISTS public.mfa_recovery_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mfa_recovery_attempts_user_idx ON public.mfa_recovery_attempts (user_id, at DESC);

ALTER TABLE public.mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfa_recovery_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mfa_recovery_codes FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.mfa_recovery_attempts FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO public.isolation_tables (table_name, access, owner_column, read_all_reason, note) VALUES
('mfa_recovery_codes', 'system_only', 'user_id', NULL, 'hashes of the single-use recovery codes for two-step sign-in; reached only through the recovery functions'),
('mfa_recovery_attempts', 'system_only', 'user_id', NULL, 'wrong recovery-code tries, for the five-in-fifteen-minutes lock')
ON CONFLICT (table_name) DO NOTHING;

INSERT INTO public.data_classification (table_name, column_name, class) VALUES
('mfa_recovery_codes', 'code_hash', 'OPERATIONAL'),
('mfa_recovery_codes', 'id', 'OPERATIONAL'),
('mfa_recovery_codes', 'user_id', 'OPERATIONAL'),
('mfa_recovery_attempts', 'id', 'OPERATIONAL'),
('mfa_recovery_attempts', 'user_id', 'OPERATIONAL')
ON CONFLICT (table_name, column_name) DO UPDATE SET class = EXCLUDED.class;

-- Replace the whole set of codes for a person who has two-step sign-in on. The server sends hashes only.
CREATE OR REPLACE FUNCTION public.replace_mfa_recovery_codes(_user_id uuid, _hashes text[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
DECLARE n integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  n := coalesce(cardinality(_hashes), 0);
  IF n < 1 OR n > 12 THEN RAISE EXCEPTION 'between 1 and 12 codes' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(_hashes) h WHERE h !~ '^[0-9a-f]{64}$') THEN RAISE EXCEPTION 'bad code hash' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = _user_id AND f.status = 'verified') THEN
    RAISE EXCEPTION 'two-step sign-in is not on' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.mfa_recovery_codes WHERE user_id = _user_id;
  INSERT INTO public.mfa_recovery_codes (user_id, code_hash) SELECT DISTINCT _user_id, h FROM unnest(_hashes) h;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.record_evidence(_user_id => _user_id, _kind => 'credential_change', _actor => 'user', _actor_id => _user_id::text,
    _subject => jsonb_build_object('credential', 'two_step_recovery_codes', 'change', 'replaced', 'count', n), _verdict => 'replaced');
  RETURN n;
END $fn$;

-- How many unused codes are left (never the codes).
CREATE OR REPLACE FUNCTION public.mfa_recovery_codes_left(_user_id uuid)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN (SELECT count(*)::integer FROM public.mfa_recovery_codes WHERE user_id = _user_id AND used_at IS NULL);
END $fn$;

-- Use one code. 'ok': the code was good, so every confirmed authenticator app and the rest of the codes are gone and the person signs in
-- with their sign-in method alone until they set two-step sign-in up again. 'wrong', 'locked' (five wrong tries in fifteen minutes),
-- 'no_factor' (two-step sign-in is not on; nothing to recover).
CREATE OR REPLACE FUNCTION public.use_mfa_recovery_code(_user_id uuid, _code_hash text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
DECLARE cid uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF _code_hash IS NULL OR _code_hash !~ '^[0-9a-f]{64}$' THEN RETURN 'wrong'; END IF;
  DELETE FROM public.mfa_recovery_attempts WHERE at < now() - interval '1 day';
  IF NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = _user_id AND f.status = 'verified') THEN RETURN 'no_factor'; END IF;
  IF (SELECT count(*) FROM public.mfa_recovery_attempts WHERE user_id = _user_id AND at > now() - interval '15 minutes') >= 5 THEN
    RETURN 'locked';
  END IF;
  UPDATE public.mfa_recovery_codes SET used_at = now()
   WHERE user_id = _user_id AND code_hash = _code_hash AND used_at IS NULL
   RETURNING id INTO cid;
  IF cid IS NULL THEN
    INSERT INTO public.mfa_recovery_attempts (user_id) VALUES (_user_id);
    PERFORM public.record_evidence(_user_id => _user_id, _kind => 'access_refused', _actor => 'user', _actor_id => _user_id::text,
      _subject => jsonb_build_object('door', 'mfa_recovery', 'reason', 'wrong_code'), _verdict => 'refused');
    RETURN 'wrong';
  END IF;
  DELETE FROM auth.mfa_factors WHERE user_id = _user_id;
  DELETE FROM public.mfa_recovery_codes WHERE user_id = _user_id;
  DELETE FROM public.mfa_recovery_attempts WHERE user_id = _user_id;
  PERFORM public.record_evidence(_user_id => _user_id, _kind => 'credential_change', _actor => 'user', _actor_id => _user_id::text,
    _subject => jsonb_build_object('credential', 'two_step', 'change', 'removed_by_recovery_code'), _verdict => 'removed');
  RETURN 'ok';
END $fn$;

-- Owner-assisted reset: a platform owner removes another account's two-step sign-in (after confirming it is the account owner, see
-- docs/incident-response.md). The row goes on the customer's own chain: who did it and why (one of three fixed reasons).
CREATE OR REPLACE FUNCTION public.support_remove_two_step(_target uuid, _by uuid, _reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
DECLARE n integer; why text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF _by IS NULL OR _target IS NULL OR _by = _target THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _by AND r.role::text = 'owner') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _target) THEN RAISE EXCEPTION 'no such account' USING ERRCODE = 'P0002'; END IF;
  why := CASE WHEN _reason IN ('lost_phone', 'takeover') THEN _reason ELSE 'other' END;
  DELETE FROM auth.mfa_factors WHERE user_id = _target;
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM public.mfa_recovery_codes WHERE user_id = _target;
  DELETE FROM public.mfa_recovery_attempts WHERE user_id = _target;
  PERFORM public.record_evidence(_user_id => _target, _kind => 'credential_change', _actor => 'system', _actor_id => _by::text,
    _subject => jsonb_build_object('credential', 'two_step', 'change', 'removed_by_support', 'reason', why, 'factors', n), _verdict => 'removed');
  RETURN n;
END $fn$;

REVOKE ALL ON FUNCTION public.replace_mfa_recovery_codes(uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mfa_recovery_codes_left(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.use_mfa_recovery_code(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.support_remove_two_step(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_mfa_recovery_codes(uuid, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.mfa_recovery_codes_left(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.use_mfa_recovery_code(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.support_remove_two_step(uuid, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------------------------------------------------------
-- The weekly isolation check now also fails when an account-data table has no two-step rule (a table added later and forgotten), and it
-- no longer reads the restrictive rules as identity checks (they only narrow access).
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
  ORDER BY 1, 2;
$fn$;
