-- 2026-08-25 plan item 15: perform the actual decision-signing secret
-- rotation.
--
-- 2026-08-24 shipped the groundwork (signing_key_id column defaulting to
-- 'v1', _decision_signing_secret_for_key() mapping any key id to its own
-- vault secret, sign_agent_decision()/verify_decision_signature()/
-- _verify_decision_signatures_impl() all reading the secret BY the row's
-- own signing_key_id instead of one unconditional name) -- deliberately
-- "groundwork only," rotating nothing yet.
--
-- Re-read all three functions before writing this: verify_decision_signature
-- and _verify_decision_signatures_impl already resolve a row's secret
-- entirely from that row's OWN signing_key_id column, with no hardcoded
-- 'v1' anywhere in either read path -- the only places 'v1' appears at all
-- are (a) the column's DEFAULT and (b) sign_agent_decision()'s coalesce for
-- a caller that inserts without setting it explicitly. That confirms the
-- cutover really is safe as a pure migration: every historical row keeps
-- carrying its own real signing_key_id (NULL/'v1' for anything before
-- today), so it keeps resolving to the original 'decision_signing_secret'
-- vault entry and verifies exactly as before. Only NEW rows going forward
-- get 'v2' and the new secret.
--
-- _decision_signing_secret_for_key() itself needs NO changes: it already
-- maps any key id other than NULL/'v1' to 'decision_signing_secret_' ||
-- key id, which is exactly 'decision_signing_secret_v2' for 'v2' -- the
-- convention the groundwork's own comment already promised.
DO $$
DECLARE sid uuid;
BEGIN
  SELECT id INTO sid FROM vault.secrets WHERE name = 'decision_signing_secret_v2';
  IF sid IS NULL THEN
    PERFORM vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'decision_signing_secret_v2', 'HMAC key for agent_decisions signatures -- v2, rotated in from decision_signing_secret (v1)');
  END IF;
END $$;

ALTER TABLE public.agent_decisions ALTER COLUMN signing_key_id SET DEFAULT 'v2';

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
  NEW.signing_key_id := coalesce(NEW.signing_key_id, 'v2');
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

-- 'v1' (decision_signing_secret) is deliberately left untouched and still
-- fully resolvable -- every row signed before this migration keeps
-- verifying against it forever, with no retirement date set here. Retiring
-- 'v1' is a separate, much later decision once nothing plausibly still
-- needs it (this project's own audit-integrity sweep is exactly the tool
-- that would prove that day has come).
