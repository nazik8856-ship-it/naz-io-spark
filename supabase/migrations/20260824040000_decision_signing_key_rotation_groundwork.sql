-- 2026-08-24 plan item 9: decision-signing secret rotation groundwork.
--
-- decision_signing_secret is a single vault secret with no key-id/version
-- tracking -- sign_agent_decision_trg, verify_decision_signature, and
-- _verify_decision_signatures_impl (the batch/sweep path) all look up the
-- CURRENT vault value only. Rotating that secret today would silently break
-- verification for every previously-signed row, since the OLD signatures
-- were computed with the OLD secret and there'd be no record of which
-- secret a given row was actually signed with.
--
-- This is groundwork only -- it makes a future rotation safe, it does not
-- rotate anything today. No new vault secret is created here: 'v1' resolves
-- to the SAME existing 'decision_signing_secret' vault entry a rotation
-- would eventually replace, so every row signed before and after this
-- migration keeps verifying identically. A real rotation is a follow-on:
-- create a new vault secret (e.g. 'decision_signing_secret_v2'), start
-- stamping new rows with signing_key_id = 'v2', and only then retire the
-- 'v1' secret once nothing still needs it for verification.
ALTER TABLE public.agent_decisions ADD COLUMN IF NOT EXISTS signing_key_id text DEFAULT 'v1';

-- Historical rows predate this column entirely -- NULL there means "signed
-- under whatever the single secret was at the time", which is exactly what
-- 'v1' means today. Backfilling every historical row to the literal string
-- 'v1' isn't necessary: the lookup helper below treats NULL and 'v1'
-- identically, so this is documentation, not a required backfill.

-- Single place that maps a signing_key_id to the vault secret it names, so
-- the signing trigger and every verification path share one lookup instead
-- of each hand-rolling its own mapping (the same "generalize a hand-rolled
-- pattern before a third copy appears" reasoning as claimRowOnce/idempotency
-- earlier this week). NULL or 'v1' -> the pre-existing, unrenamed secret;
-- any other key id -> a secret named 'decision_signing_secret_' || key id,
-- the convention a future rotation would follow.
CREATE OR REPLACE FUNCTION public._decision_signing_secret_for_key(_key_id text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, vault, pg_temp
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets
  WHERE name = CASE
    WHEN _key_id IS NULL OR _key_id = 'v1' THEN 'decision_signing_secret'
    ELSE 'decision_signing_secret_' || _key_id
  END;
$$;
REVOKE ALL ON FUNCTION public._decision_signing_secret_for_key(text) FROM public, anon, authenticated;

-- Signing trigger: stamps the row with the key id it was actually signed
-- under (defaulting new rows to 'v1', same as the column default, so a
-- caller that inserts without setting it explicitly still gets a real
-- value) and looks up that key's own secret instead of the single
-- unconditional 'decision_signing_secret' name. Canonical payload and
-- signature algorithm are unchanged -- only which secret gets used differs.
CREATE OR REPLACE FUNCTION public.sign_agent_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault, pg_temp
AS $$
DECLARE
  secret text;
BEGIN
  NEW.created_at := coalesce(NEW.created_at, now());
  NEW.signing_key_id := coalesce(NEW.signing_key_id, 'v1');
  secret := public._decision_signing_secret_for_key(NEW.signing_key_id);
  IF secret IS NULL THEN
    RAISE EXCEPTION 'decision signing secret missing for key %', NEW.signing_key_id;
  END IF;
  NEW.signature := encode(
    extensions.digest(
      secret || '::' || public.decision_canonical_payload(
        NEW.id, NEW.user_id, NEW.decision, NEW.reasoning,
        NEW.confidence_score, NEW.source, NEW.agent_run_id, NEW.created_at
      ),
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END;
$$;

-- Single-row verification: looks up the secret BY the row's OWN
-- signing_key_id (falling back to 'v1' for historical rows that predate
-- the column) instead of the single unconditional secret name -- this is
-- the actual fix that makes a future rotation non-breaking. A row's
-- signature is checked against whichever secret actually signed it, not
-- whatever the currently-active secret happens to be.
CREATE OR REPLACE FUNCTION public.verify_decision_signature(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, vault, pg_temp
AS $$
DECLARE
  r public.agent_decisions;
  secret text;
  expected text;
BEGIN
  SELECT * INTO r FROM public.agent_decisions WHERE id = _id;
  IF r.id IS NULL THEN
    RETURN jsonb_build_object('found', false, 'verified', false, 'reason', 'decision not found');
  END IF;
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM r.user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF r.signature IS NULL THEN
    RETURN jsonb_build_object('found', true, 'verified', false, 'reason', 'record predates signing', 'signed', false, 'id', r.id);
  END IF;
  secret := public._decision_signing_secret_for_key(coalesce(r.signing_key_id, 'v1'));
  IF secret IS NULL THEN
    RETURN jsonb_build_object(
      'found', true, 'signed', true, 'id', r.id, 'verified', false,
      'signing_key_id', coalesce(r.signing_key_id, 'v1'),
      'reason', 'signing key ' || coalesce(r.signing_key_id, 'v1') || ' is no longer available -- cannot verify'
    );
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
  RETURN jsonb_build_object(
    'found', true,
    'signed', true,
    'id', r.id,
    'verified', expected = r.signature,
    'signature', r.signature,
    'expected_signature', expected,
    'signing_key_id', coalesce(r.signing_key_id, 'v1'),
    'algorithm', 'sha256(server_secret || canonical_payload)',
    'signed_fields', jsonb_build_array('id','user_id','decision','reasoning','confidence_score','source','agent_run_id','created_at'),
    'checked_at', now(),
    'reason', CASE WHEN expected = r.signature THEN 'signature matches — record unaltered since creation'
                   ELSE 'signature mismatch — record content differs from what was signed' END
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.verify_decision_signature(uuid) TO authenticated, service_role;

-- Batch/sweep verification (used by both the manual "Verify signatures"
-- button and the scheduled audit-integrity sweep): the single secret was
-- previously fetched ONCE before the loop and applied to every row
-- regardless of what actually signed it -- exactly the bug a real rotation
-- would trigger (every row signed under the OLD secret would immediately
-- read back as "mismatched" the moment the vault secret changed). Now
-- looks up each row's secret by ITS OWN signing_key_id, inside the loop.
-- A row whose key is no longer available (e.g. a retired key after a
-- completed rotation) is counted as a mismatch too, distinguished by a
-- 'reason' field on its entry, rather than silently skipped -- it isn't
-- verifiable, which is a failure worth surfacing, not a pass.
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
  FOR r IN
    SELECT id, user_id, decision, reasoning, confidence_score, source, agent_run_id, created_at, signature, signing_key_id
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

    secret := public._decision_signing_secret_for_key(coalesce(r.signing_key_id, 'v1'));
    IF secret IS NULL THEN
      mismatched := mismatched || jsonb_build_array(jsonb_build_object(
        'id', r.id, 'created_at', r.created_at, 'decision', r.decision,
        'reason', 'signing key ' || coalesce(r.signing_key_id, 'v1') || ' is no longer available'
      ));
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
