-- Pillar 2 top-10 item 2: the decision signature never covered gate_trace,
-- human_response, escalated, action_type, or provider, yet
-- verify_decision_signature's own "reason" text and ControlAuditVerify.tsx
-- both told customers it proves "nothing has been altered since it was
-- logged." Fixes this with a versioned payload (signing_key_id 'v3', new
-- vault secret, same rotation pattern 20260825060000 already established)
-- so every EXISTING row keeps verifying exactly as before under v1/v2, and
-- a SEPARATE signature for human_response (which the append-only guard
-- deliberately lets change after insert -- baking it into the one insert-
-- time signature would make every legitimate human response look like
-- tampering).

DO $$
DECLARE sid uuid;
BEGIN
  SELECT id INTO sid FROM vault.secrets WHERE name = 'decision_signing_secret_v3';
  IF sid IS NULL THEN
    PERFORM vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'decision_signing_secret_v3', 'HMAC key for agent_decisions signatures -- v3, first version whose payload also covers gate_trace/escalated/action_type/provider');
  END IF;
END $$;

ALTER TABLE public.agent_decisions ALTER COLUMN signing_key_id SET DEFAULT 'v3';
ALTER TABLE public.agent_decisions
  ADD COLUMN IF NOT EXISTS human_response_signature text,
  ADD COLUMN IF NOT EXISTS human_response_signed_at timestamptz;

-- New overload (different arity -- the original 8-arg version is untouched
-- and keeps producing byte-identical output for every v1/v2 row).
CREATE OR REPLACE FUNCTION public.decision_canonical_payload(
  _id uuid, _user_id uuid, _decision text, _reasoning text,
  _confidence integer, _source text, _agent_run_id uuid, _created_at timestamptz,
  _gate_trace jsonb, _escalated boolean, _action_type text, _provider text
) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT concat_ws('|',
    _id::text,
    _user_id::text,
    coalesce(_decision, ''),
    coalesce(_reasoning, ''),
    coalesce(_confidence, 0)::text,
    coalesce(_source, ''),
    coalesce(_agent_run_id::text, ''),
    to_char(_created_at AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.USOF'),
    coalesce(_gate_trace::text, ''),
    coalesce(_escalated::text, 'false'),
    coalesce(_action_type, ''),
    coalesce(_provider, '')
  );
$function$;

CREATE OR REPLACE FUNCTION public.decision_human_response_payload(
  _id uuid, _human_response text, _signed_at timestamptz
) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT concat_ws('|',
    _id::text,
    coalesce(_human_response, ''),
    to_char(_signed_at AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.USOF')
  );
$function$;

CREATE OR REPLACE FUNCTION public.sign_agent_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $function$
DECLARE
  secret text;
BEGIN
  NEW.created_at := coalesce(NEW.created_at, now());
  NEW.signing_key_id := coalesce(NEW.signing_key_id, 'v3');
  secret := public._decision_signing_secret_for_key(NEW.signing_key_id);
  IF secret IS NULL THEN
    RAISE EXCEPTION 'decision signing secret missing for key %', NEW.signing_key_id;
  END IF;
  IF NEW.signing_key_id IN ('v1', 'v2') THEN
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
  ELSE
    NEW.signature := encode(
      extensions.digest(
        secret || '::' || public.decision_canonical_payload(
          NEW.id, NEW.user_id, NEW.decision, NEW.reasoning,
          NEW.confidence_score, NEW.source, NEW.agent_run_id, NEW.created_at,
          NEW.gate_trace, NEW.escalated, NEW.action_type, NEW.provider
        ),
        'sha256'
      ),
      'hex'
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- Allow human_response_signature/human_response_signed_at to change in the
-- SAME update that sets human_response, and compute both server-side --
-- never trusting a client-supplied value, same posture sign_agent_decision
-- already takes for `signature` itself. This update path is called
-- directly by authenticated clients (ControlPendingDecisions.tsx), so this
-- guard is the only thing standing between "real proof" and "a client can
-- just claim any signature it wants."
CREATE OR REPLACE FUNCTION public.guard_decision_human_response()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $function$
DECLARE
  secret text;
BEGIN
  IF OLD.human_response IS NOT NULL THEN
    RAISE EXCEPTION 'A human response has already been recorded for this decision';
  END IF;
  IF NEW.human_response IS NULL THEN
    RAISE EXCEPTION 'Only a human response can be recorded on a decision';
  END IF;
  IF (to_jsonb(NEW) - 'human_response' - 'human_response_signature' - 'human_response_signed_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'human_response' - 'human_response_signature' - 'human_response_signed_at') THEN
    RAISE EXCEPTION 'Decision records are append-only; only human_response may be recorded';
  END IF;
  NEW.human_response_signed_at := now();
  secret := public._decision_signing_secret_for_key(coalesce(NEW.signing_key_id, 'v1'));
  IF secret IS NOT NULL THEN
    NEW.human_response_signature := encode(
      extensions.digest(
        secret || '::' || public.decision_human_response_payload(NEW.id, NEW.human_response, NEW.human_response_signed_at),
        'sha256'
      ),
      'hex'
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_decision_signature(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $function$
DECLARE
  r public.agent_decisions;
  secret text;
  expected text;
  expected_hr text;
  hr_verified boolean;
  signed_fields jsonb;
  key_id text;
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
  key_id := coalesce(r.signing_key_id, 'v1');
  secret := public._decision_signing_secret_for_key(key_id);
  IF secret IS NULL THEN
    RETURN jsonb_build_object(
      'found', true, 'signed', true, 'id', r.id, 'verified', false,
      'signing_key_id', key_id,
      'reason', 'signing key ' || key_id || ' is no longer available -- cannot verify'
    );
  END IF;

  IF key_id IN ('v1', 'v2') THEN
    expected := encode(extensions.digest(secret || '::' || public.decision_canonical_payload(
      r.id, r.user_id, r.decision, r.reasoning, r.confidence_score, r.source, r.agent_run_id, r.created_at
    ), 'sha256'), 'hex');
    signed_fields := jsonb_build_array('id','user_id','decision','reasoning','confidence_score','source','agent_run_id','created_at');
  ELSE
    expected := encode(extensions.digest(secret || '::' || public.decision_canonical_payload(
      r.id, r.user_id, r.decision, r.reasoning, r.confidence_score, r.source, r.agent_run_id, r.created_at,
      r.gate_trace, r.escalated, r.action_type, r.provider
    ), 'sha256'), 'hex');
    signed_fields := jsonb_build_array('id','user_id','decision','reasoning','confidence_score','source','agent_run_id','created_at','gate_trace','escalated','action_type','provider');
  END IF;

  -- NULL (not false) when there's simply no human-response signature to
  -- check yet -- either no response was ever recorded, or it was recorded
  -- before this feature existed. Only an ACTUAL mismatch (a signature
  -- exists and doesn't match) is a real tamper signal.
  hr_verified := NULL;
  IF r.human_response IS NOT NULL AND r.human_response_signature IS NOT NULL THEN
    expected_hr := encode(extensions.digest(secret || '::' || public.decision_human_response_payload(
      r.id, r.human_response, r.human_response_signed_at
    ), 'sha256'), 'hex');
    hr_verified := (expected_hr = r.human_response_signature);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'signed', true,
    'id', r.id,
    'verified', expected = r.signature,
    'signature', r.signature,
    'expected_signature', expected,
    'signing_key_id', key_id,
    'algorithm', 'sha256(server_secret || canonical_payload)',
    'signed_fields', signed_fields,
    'human_response_verified', hr_verified,
    'checked_at', now(),
    'reason', CASE
      WHEN expected != r.signature THEN 'signature mismatch — record content differs from what was signed'
      WHEN hr_verified IS FALSE THEN 'the core record signature matches, but the recorded human response does not match its own signature — possible tampering with the human response specifically'
      WHEN key_id IN ('v1', 'v2') THEN 'signature matches for the fields it covers — this is a legacy record signed before gate_trace/escalated/action_type/provider were added to the signed payload, so those fields are NOT covered by this proof'
      WHEN r.human_response IS NOT NULL AND hr_verified IS NULL THEN 'signature matches for every field in signed_fields; the human response on this record predates response-signing and has no signature of its own'
      WHEN hr_verified IS TRUE THEN 'signature matches — every field in signed_fields, plus the recorded human response, is confirmed unaltered since it was recorded'
      ELSE 'signature matches — every field in signed_fields is confirmed unaltered since it was recorded'
    END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._verify_decision_signatures_impl(_user_id uuid, _from timestamp with time zone, _to timestamp with time zone, _limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $function$
DECLARE
  secret text;
  r record;
  expected text;
  expected_hr text;
  checked integer := 0;
  verified integer := 0;
  unsigned integer := 0;
  human_response_mismatched integer := 0;
  mismatched jsonb := '[]'::jsonb;
BEGIN
  FOR r IN
    SELECT id, user_id, decision, reasoning, confidence_score, source, agent_run_id, created_at,
           signature, signing_key_id, gate_trace, escalated, action_type, provider,
           human_response, human_response_signature, human_response_signed_at
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

    IF coalesce(r.signing_key_id, 'v1') IN ('v1', 'v2') THEN
      expected := encode(extensions.digest(secret || '::' || public.decision_canonical_payload(
        r.id, r.user_id, r.decision, r.reasoning, r.confidence_score, r.source, r.agent_run_id, r.created_at
      ), 'sha256'), 'hex');
    ELSE
      expected := encode(extensions.digest(secret || '::' || public.decision_canonical_payload(
        r.id, r.user_id, r.decision, r.reasoning, r.confidence_score, r.source, r.agent_run_id, r.created_at,
        r.gate_trace, r.escalated, r.action_type, r.provider
      ), 'sha256'), 'hex');
    END IF;

    IF expected != r.signature THEN
      mismatched := mismatched || jsonb_build_array(jsonb_build_object('id', r.id, 'created_at', r.created_at, 'decision', r.decision));
      CONTINUE;
    END IF;
    verified := verified + 1;

    IF r.human_response IS NOT NULL AND r.human_response_signature IS NOT NULL THEN
      expected_hr := encode(extensions.digest(secret || '::' || public.decision_human_response_payload(
        r.id, r.human_response, r.human_response_signed_at
      ), 'sha256'), 'hex');
      IF expected_hr != r.human_response_signature THEN
        human_response_mismatched := human_response_mismatched + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'checked', checked,
    'verified', verified,
    'unsigned', unsigned,
    'mismatched_count', jsonb_array_length(mismatched),
    'mismatched', mismatched,
    'human_response_mismatched_count', human_response_mismatched,
    'checked_at', now(),
    'range', jsonb_build_object('from', _from, 'to', _to)
  );
END;
$function$;
