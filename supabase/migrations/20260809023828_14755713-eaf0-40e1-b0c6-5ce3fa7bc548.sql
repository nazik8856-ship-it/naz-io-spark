-- 1. signature column
ALTER TABLE public.agent_decisions ADD COLUMN IF NOT EXISTS signature text;

-- 2. server secret in vault (random, never exposed)
DO $$
DECLARE sid uuid;
BEGIN
  SELECT id INTO sid FROM vault.secrets WHERE name = 'decision_signing_secret';
  IF sid IS NULL THEN
    PERFORM vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'decision_signing_secret', 'HMAC key for agent_decisions signatures');
  END IF;
END $$;

-- 3. canonical payload + signing
CREATE OR REPLACE FUNCTION public.decision_canonical_payload(
  _id uuid, _user_id uuid, _decision text, _reasoning text,
  _confidence integer, _source text, _agent_run_id uuid, _created_at timestamptz
) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT concat_ws('|',
    _id::text,
    _user_id::text,
    coalesce(_decision, ''),
    coalesce(_reasoning, ''),
    coalesce(_confidence, 0)::text,
    coalesce(_source, ''),
    coalesce(_agent_run_id::text, ''),
    to_char(_created_at AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.USOF')
  );
$$;

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
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'decision_signing_secret';
  IF secret IS NULL THEN
    RAISE EXCEPTION 'decision signing secret missing';
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

DROP TRIGGER IF EXISTS sign_agent_decision_trg ON public.agent_decisions;
CREATE TRIGGER sign_agent_decision_trg
BEFORE INSERT ON public.agent_decisions
FOR EACH ROW EXECUTE FUNCTION public.sign_agent_decision();

-- 4. verification
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
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'decision_signing_secret';
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
    'algorithm', 'sha256(server_secret || canonical_payload)',
    'signed_fields', jsonb_build_array('id','user_id','decision','reasoning','confidence_score','source','agent_run_id','created_at'),
    'checked_at', now(),
    'reason', CASE WHEN expected = r.signature THEN 'signature matches — record unaltered since creation'
                   ELSE 'signature mismatch — record content differs from what was signed' END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_decision_signature(uuid) TO authenticated, service_role;