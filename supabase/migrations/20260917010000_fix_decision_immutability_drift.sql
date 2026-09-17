-- agent_decisions is meant to be fully append-only except for
-- human_response (the whole point of decision-signing/audit-integrity).
-- guard_decision_human_response() enforced that via a hardcoded 16-column
-- equality check, but the table has grown to 30 columns since that check
-- was written -- 14 columns added later (action_type, provider, params,
-- hard_rule_id, is_test, plan_id, description, api_key_id, gate_trace,
-- overridden_at, gate_duration_ms, signing_key_id,
-- embedding_backfill_checked_at, precedent_citations) were never added to
-- the guard, so they're silently mutable in the same call that records a
-- human response -- e.g. flipping is_test to hide a real action from
-- audit metering, all while `signature` stays locked and the record still
-- reads as "signature valid".
--
-- Rather than extend the hardcoded list (which just repeats the same
-- failure mode against the next schema change), compare the whole row as
-- jsonb minus the one column that's allowed to change. New columns are
-- then immutable by default -- the safe direction for an audit-integrity
-- table -- with no guard update required when the schema grows again.
CREATE OR REPLACE FUNCTION public.guard_decision_human_response()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.human_response IS NOT NULL THEN
    RAISE EXCEPTION 'A human response has already been recorded for this decision';
  END IF;
  IF NEW.human_response IS NULL THEN
    RAISE EXCEPTION 'Only a human response can be recorded on a decision';
  END IF;
  IF (to_jsonb(NEW) - 'human_response') IS DISTINCT FROM (to_jsonb(OLD) - 'human_response') THEN
    RAISE EXCEPTION 'Decision records are append-only; only human_response may be recorded';
  END IF;
  RETURN NEW;
END;
$function$;
