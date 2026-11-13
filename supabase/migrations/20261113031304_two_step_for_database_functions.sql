-- Two-step sign-in, the part the row rules can not reach (docs/two-step-sign-in.md).
-- The restrictive row rules (20261113025529) stop a first-step session reading or changing rows directly. But a function that runs as
-- the database owner (SECURITY DEFINER) ignores row rules, so the ones a signed-in person can call and that act on their own account
-- must ask the same question. Each gets the check as its first step; the server key and database jobs still pass (session_mfa_ok()).
DO $do$
DECLARE r record; def text; fixed text;
BEGIN
  FOR r IN
    SELECT p.oid, l.lanname
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('add_project_time', 'approve_policy_change', 'cancel_data_deletion', 'get_account_owner_contact', 'get_business_context',
                        'my_evidence_check', 'my_free_limits', 'my_security_activity', 'read_webhook_secret', 'reassign_pending_approval',
                        'record_approval_signoff', 'reject_policy_change', 'request_data_deletion', 'request_policy_change',
                        'rollback_config_change', 'rotate_webhook_secret')
  LOOP
    def := pg_get_functiondef(r.oid);
    CONTINUE WHEN def LIKE '%session_mfa_ok%';
    IF r.lanname = 'plpgsql' THEN
      fixed := regexp_replace(def, E'\nBEGIN\n', E'\nBEGIN\n  IF NOT public.session_mfa_ok() THEN RAISE EXCEPTION ''two-step sign-in required'' USING ERRCODE = ''42501''; END IF;\n', '');
    ELSE
      fixed := replace(def, 'WHERE auth.uid() IS NOT NULL;', 'WHERE auth.uid() IS NOT NULL AND public.session_mfa_ok();');
    END IF;
    IF fixed = def THEN RAISE EXCEPTION 'could not add the two-step check to %', r.oid::regprocedure; END IF;
    EXECUTE fixed;
  END LOOP;
END
$do$;
