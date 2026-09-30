-- Revises the previous version of this fix: comparing hard_rules/safety_rules
-- `updated_at` against the snapshot's captured_at missed rule DELETEs (a
-- removed row leaves no updated_at behind to detect), and including
-- agents.updated_at in the comparison would have caused needless snapshot
-- rebuilds on every scheduled agent-run tick (agent-scheduler's next_run_at
-- update bumps agents.updated_at via the same generic trigger, unrelated to
-- policy). config_changes already logs every insert/update/delete on
-- hard_rules and safety_rules (log_config_change trigger), so it's a single
-- complete staleness signal for exactly the two tables this bug is about.
--
-- NOTE: superseded by _v3 immediately below, which fixes an ambiguous
-- column reference this version shipped with. Kept as-is to match the live
-- migration history exactly.
CREATE OR REPLACE FUNCTION public.get_active_policy_version(_user_id uuid)
 RETURNS TABLE(id uuid, version integer, snapshot jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _row public.policy_versions%ROWTYPE;
  _captured_at timestamptz;
  _last_rule_change timestamptz;
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

    SELECT cc.created_at INTO _last_rule_change
    FROM public.config_changes cc
    WHERE cc.user_id = _user_id AND cc.table_name IN ('hard_rules', 'safety_rules')
    ORDER BY cc.created_at DESC
    LIMIT 1;

    IF _last_rule_change IS NOT NULL AND _last_rule_change > _captured_at THEN
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
