-- Audit trail tamper-evidence verification (batch). The HMAC signing
-- infrastructure has existed since 2026-08-09 (sign_agent_decision_trg,
-- verify_decision_signature) and even has a working HTTP endpoint
-- (GET /control-engine/decisions/:id/verify) -- but nothing anywhere,
-- backend or frontend, ever calls it for more than one decision at a
-- time, and no customer-facing surface exists at all. This is the single
-- most differentiated, mostly-already-built compliance feature this
-- product has: proving the audit trail hasn't been altered since it was
-- written, not just claiming it hasn't.
--
-- Reuses decision_canonical_payload() and the same signing secret --
-- never re-derives the signing logic, so this can never silently drift
-- from what verify_decision_signature already does for a single row.
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
  secret text;
  r record;
  expected text;
  checked integer := 0;
  verified integer := 0;
  unsigned integer := 0;
  mismatched jsonb := '[]'::jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'decision_signing_secret';
  IF secret IS NULL THEN RAISE EXCEPTION 'decision signing secret missing'; END IF;

  FOR r IN
    SELECT id, user_id, decision, reasoning, confidence_score, source, agent_run_id, created_at, signature
    FROM public.agent_decisions
    WHERE user_id = uid AND created_at >= _from AND created_at < _to
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

REVOKE ALL ON FUNCTION public.verify_decision_signatures_batch(timestamptz, timestamptz, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.verify_decision_signatures_batch(timestamptz, timestamptz, integer) TO authenticated;
