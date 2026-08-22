-- 2026-08-23 plan item 7: automatic weekly audit-integrity sweep.
-- ControlAuditVerify.tsx (verify_decision_signatures_batch) is purely
-- manual today -- nothing runs it on a schedule, the same gap
-- control-self-audit closed for the control-test-suite scenarios.
--
-- verify_decision_signatures_batch reads auth.uid() internally, which is
-- NULL under a service-role cron call -- calling it as-is from a scheduled
-- job would fail closed on every org. The real verification loop is
-- pulled into a private helper both the existing (auth.uid()-based)
-- function and a NEW service-role-gated _for(...) overload delegate to,
-- so the two never drift.
CREATE OR REPLACE FUNCTION public._verify_decision_signatures_impl(
  _user_id uuid,
  _from timestamptz,
  _to timestamptz,
  _limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, vault, pg_temp
AS $$
DECLARE
  secret text;
  r record;
  expected text;
  checked integer := 0;
  verified integer := 0;
  unsigned integer := 0;
  mismatched jsonb := '[]'::jsonb;
BEGIN
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'decision_signing_secret';
  IF secret IS NULL THEN RAISE EXCEPTION 'decision signing secret missing'; END IF;

  FOR r IN
    SELECT id, user_id, decision, reasoning, confidence_score, source, agent_run_id, created_at, signature
    FROM public.agent_decisions
    WHERE user_id = _user_id AND created_at >= _from AND created_at < _to
    ORDER BY created_at ASC
    LIMIT greatest(1, least(_limit, 20000))
  LOOP
    checked := checked + 1;
    IF r.signature IS NULL THEN
      unsigned := unsigned + 1;
      CONTINUE;
    END IF;
    expected := encode(
      extensions.digest(
        secret || '::' || public.decision_canonical_payload(
          r.id, r.user_id, r.decision, r.reasoning, r.confidence_score, r.source, r.agent_run_id, r.created_at
        ),
        'sha256'
      ),
      'hex'
    );
    IF expected = r.signature THEN
      verified := verified + 1;
    ELSE
      mismatched := mismatched || jsonb_build_array(jsonb_build_object('id', r.id, 'created_at', r.created_at, 'decision', r.decision));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'checked', checked,
    'verified', verified,
    'unsigned', unsigned,
    'mismatched_count', jsonb_array_length(mismatched),
    'mismatched', mismatched,
    'checked_at', now(),
    'range', jsonb_build_object('from', _from, 'to', _to)
  );
END;
$$;
REVOKE ALL ON FUNCTION public._verify_decision_signatures_impl(uuid, timestamptz, timestamptz, integer) FROM public, anon, authenticated;

-- Unchanged signature/behavior for the existing manual "Verify signatures"
-- button -- now just delegates to the shared helper above.
CREATE OR REPLACE FUNCTION public.verify_decision_signatures_batch(
  _from timestamptz,
  _to timestamptz,
  _limit integer DEFAULT 5000
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, vault, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  RETURN public._verify_decision_signatures_impl(uid, _from, _to, _limit);
END;
$$;
REVOKE ALL ON FUNCTION public.verify_decision_signatures_batch(timestamptz, timestamptz, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.verify_decision_signatures_batch(timestamptz, timestamptz, integer) TO authenticated;

-- New: service-role-only overload for the scheduled sweep -- takes the
-- target user explicitly instead of trusting auth.uid(), mirroring
-- get_active_policy_version's shape.
CREATE OR REPLACE FUNCTION public.verify_decision_signatures_batch_for(
  _user_id uuid,
  _from timestamptz,
  _to timestamptz,
  _limit integer DEFAULT 5000
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, vault, pg_temp
AS $$
BEGIN
  RETURN public._verify_decision_signatures_impl(_user_id, _from, _to, _limit);
END;
$$;
REVOKE ALL ON FUNCTION public.verify_decision_signatures_batch_for(uuid, timestamptz, timestamptz, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_decision_signatures_batch_for(uuid, timestamptz, timestamptz, integer) TO service_role;

-- Cheap "which orgs actually have decisions in this window" lookup for the
-- service-role sweep entry point -- avoids pulling every agent_decisions
-- row's user_id over PostgREST just to dedupe client-side. Uses the
-- existing idx_agent_decisions_user (user_id, created_at DESC) index.
CREATE OR REPLACE FUNCTION public.get_recent_decision_user_ids(_since timestamptz)
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ad.user_id FROM public.agent_decisions ad WHERE ad.created_at >= _since;
$$;
REVOKE ALL ON FUNCTION public.get_recent_decision_user_ids(timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_decision_user_ids(timestamptz) TO service_role;

-- Sibling to control_test_runs (self-audit's own persistence table) --
-- the result shape differs (signature counts, not scenario pass/fail), so
-- this is its own table rather than overloading control_test_runs.
CREATE TABLE public.audit_integrity_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  triggered_by text NOT NULL CHECK (triggered_by IN ('manual', 'scheduled')),
  checked integer NOT NULL,
  verified integer NOT NULL,
  unsigned integer NOT NULL,
  mismatched_count integer NOT NULL,
  range_from timestamptz NOT NULL,
  range_to timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_integrity_runs_user_created
  ON public.audit_integrity_runs (user_id, created_at DESC);
GRANT SELECT ON public.audit_integrity_runs TO authenticated;
GRANT ALL ON public.audit_integrity_runs TO service_role;
ALTER TABLE public.audit_integrity_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own audit integrity runs"
ON public.audit_integrity_runs FOR SELECT TO authenticated
USING (auth.uid() = user_id);

-- Same alert + incident treatment as every other "something is actually
-- wrong" signal this project already has.
ALTER TABLE public.incidents
  DROP CONSTRAINT IF EXISTS incidents_kind_check;

ALTER TABLE public.incidents
  ADD CONSTRAINT incidents_kind_check CHECK (
    kind IN (
      'kill_switch_auto',
      'circuit_breaker_trip',
      'gate_error',
      'self_audit_regression',
      'approval_escalated',
      'confidence_miscalibrated',
      'break_glass_override',
      'correlated_breaker_trip',
      'audit_integrity_failure'
    )
  );

-- Weekly, a different day/time than control-self-audit-weekly's Monday
-- 06:00 UTC to avoid contention.
SELECT cron.schedule(
  'audit-integrity-sweep-wednesdays',
  '0 7 * * 3',
  $$
  SELECT net.http_post(
    url := 'https://qaeduinfirtljnbecyzq.supabase.co/functions/v1/audit-integrity-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
