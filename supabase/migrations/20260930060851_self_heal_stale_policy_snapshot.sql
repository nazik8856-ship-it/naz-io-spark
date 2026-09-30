-- get_active_policy_version previously only ever built a snapshot the FIRST
-- time a user had no active policy_versions row -- once one existed, edits
-- to hard_rules/safety_rules/agents/ai_spend_caps never propagated into it
-- unless someone went through the deliberate draft/replay/activate flow.
-- That silently broke "Ongoing Control": e.g. disabling a hard rule in
-- HardRulesPanel had zero effect on matchHardRule()/control-gate.ts, which
-- both read from this snapshot.
--
-- Fix: when an active row already exists, compare its snapshot's
-- captured_at against the live max(updated_at) across all four source
-- tables the snapshot mirrors, and refresh only the `snapshot` column in
-- place when the live tables are newer. status/activated_at are left
-- untouched -- guard_policy_version_activation() resets those to OLD on any
-- non-service-role write, and this function is only ever invoked by
-- service-role edge-function clients, so that protection stays intact for
-- the deliberate activation workflow while the snapshot content itself
-- self-heals.
--
-- NOTE: superseded by the _v2/_v3 migrations immediately below, which fix
-- a missed-DELETE gap and an ambiguous-column bug in this first pass. Kept
-- as-is (not squashed) so the local migration history matches exactly what
-- was applied to the live database, in order.
CREATE OR REPLACE FUNCTION public.get_active_policy_version(_user_id uuid)
 RETURNS TABLE(id uuid, version integer, snapshot jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _row public.policy_versions%ROWTYPE;
  _captured_at timestamptz;
  _live_max timestamptz;
BEGIN
  SELECT * INTO _row FROM public.policy_versions
  WHERE user_id = _user_id AND status = 'active' LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.policy_versions (user_id, version, snapshot, status, activated_at, notes)
    VALUES (
      _user_id,
      COALESCE((SELECT MAX(pv.version) FROM public.policy_versions pv WHERE pv.user_id = _user_id), 0) + 1,
      public.build_policy_snapshot(_user_id),
      'active', now(), 'Auto-created from live settings'
    )
    RETURNING * INTO _row;
  ELSE
    _captured_at := COALESCE((_row.snapshot->>'captured_at')::timestamptz, _row.activated_at, 'epoch'::timestamptz);

    SELECT GREATEST(
      COALESCE((SELECT MAX(hr.updated_at) FROM public.hard_rules hr WHERE hr.user_id = _user_id), 'epoch'::timestamptz),
      COALESCE((SELECT MAX(sr.updated_at) FROM public.safety_rules sr WHERE sr.user_id = _user_id), 'epoch'::timestamptz),
      COALESCE((SELECT MAX(a.updated_at) FROM public.agents a WHERE a.user_id = _user_id), 'epoch'::timestamptz),
      COALESCE((SELECT MAX(c.updated_at) FROM public.ai_spend_caps c WHERE c.user_id = _user_id), 'epoch'::timestamptz)
    ) INTO _live_max;

    IF _live_max > _captured_at THEN
      UPDATE public.policy_versions
      SET snapshot = public.build_policy_snapshot(_user_id)
      WHERE id = _row.id
      RETURNING * INTO _row;
    END IF;
  END IF;

  id := _row.id; version := _row.version; snapshot := _row.snapshot;
  RETURN NEXT;
END;
$function$;
