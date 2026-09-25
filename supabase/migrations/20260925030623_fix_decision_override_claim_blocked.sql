-- Critical fix: the break-glass override endpoint
-- (control-engine's POST /decisions/:id/override) claims agent_decisions.
-- overridden_at atomically via `UPDATE ... SET overridden_at = now()
-- WHERE overridden_at IS NULL`. guard_decision_human_response()'s BEFORE
-- UPDATE trigger has always unconditionally rejected any update that
-- doesn't also set human_response to non-null -- so every single call to
-- that claim has thrown 'Only a human response can be recorded on a
-- decision' since the override feature shipped (2026-08-23), ten days
-- after this guard was created. claimRowOnce() swallows the exception and
-- returns false, so the endpoint has always silently reported
-- already_overridden: true on the very FIRST attempt and never actually
-- run the override -- confirmed live via a rolled-back transaction.
--
-- Fix: give overridden_at the same treatment human_response already has
-- -- its own independent, narrow exception to the append-only check --
-- rather than a blanket service_role bypass (guard_pending_approval_update's
-- approach), since agent_decisions is the one table with its own signature
-- scheme and every other column should stay exactly as immutable as
-- before. Only an authenticated client's UPDATE on human_response reaches
-- this trigger at all for that column (overridden_at has no such grant --
-- only the service-role admin client the override endpoint uses can ever
-- touch it), so this doesn't loosen anything a client can reach.
CREATE OR REPLACE FUNCTION public.guard_decision_human_response()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $function$
DECLARE
  hr_changed boolean := NEW.human_response IS DISTINCT FROM OLD.human_response;
  override_changed boolean := NEW.overridden_at IS DISTINCT FROM OLD.overridden_at;
BEGIN
  IF hr_changed THEN
    IF OLD.human_response IS NOT NULL THEN
      RAISE EXCEPTION 'A human response has already been recorded for this decision';
    END IF;
    IF NEW.human_response IS NULL THEN
      RAISE EXCEPTION 'Only a human response can be recorded on a decision';
    END IF;
  END IF;

  IF NOT hr_changed AND NOT override_changed THEN
    RAISE EXCEPTION 'Only a human response or an override claim can be recorded on a decision';
  END IF;

  IF (to_jsonb(NEW) - 'human_response' - 'human_response_signature' - 'human_response_signed_at' - 'overridden_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'human_response' - 'human_response_signature' - 'human_response_signed_at' - 'overridden_at') THEN
    RAISE EXCEPTION 'Decision records are append-only; only human_response or overridden_at may be recorded';
  END IF;

  RETURN NEW;
END;
$function$;
