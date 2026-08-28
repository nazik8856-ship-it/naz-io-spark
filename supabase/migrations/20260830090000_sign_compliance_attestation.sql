-- "Knowledge & autonomy" plan, item 11: signs a compliance attestation
-- summary (control-api/index.ts's new GET /compliance-attestation route)
-- so an account can prove to its own customers/auditors that the numbers
-- weren't quietly altered after the fact.
--
-- Reuses the EXACT same server secret and digest algorithm
-- sign_agent_decision()/verify_decision_signature() already use for every
-- individual decision (20260809023828_...sql) -- no new secret, no new
-- signing mechanism, just applied to a different (attestation-shaped,
-- caller-supplied canonical) payload instead of one decision row. The
-- '::attestation::' domain tag (distinct from sign_agent_decision's own
-- '::' separator) ensures an attestation signature can never collide with
-- or be mistaken for a per-decision signature even if the two payload
-- strings happened to coincide.
--
-- Service-role only: the caller (control-api/index.ts) builds the
-- canonical payload itself from data it already fetched and trusts, and
-- passes it in as plain text -- this function only ever signs what it's
-- given, it never reads agent_decisions itself, so it carries no
-- authorization logic of its own beyond "only our own backend may call
-- this at all."
CREATE OR REPLACE FUNCTION public.sign_compliance_attestation(_payload text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault, pg_temp
AS $$
DECLARE
  secret text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'decision_signing_secret';
  IF secret IS NULL THEN
    RAISE EXCEPTION 'decision signing secret missing';
  END IF;
  RETURN encode(extensions.digest(secret || '::attestation::' || _payload, 'sha256'), 'hex');
END;
$$;

REVOKE ALL ON FUNCTION public.sign_compliance_attestation(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sign_compliance_attestation(text) TO service_role;
