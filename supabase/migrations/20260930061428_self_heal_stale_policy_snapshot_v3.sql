-- v2 had an ambiguous-column bug: the function's OUT parameter `id` shadowed
-- policy_versions.id inside `WHERE id = _row.id`, so the self-heal UPDATE
-- failed at runtime with a live 42702 error the moment a stale snapshot was
-- actually detected. Table-qualify the column to fix it.
--
-- Live-verified against a real account after applying: inserting, disabling,
-- and deleting a hard_rules row were each picked up by the very next
-- get_active_policy_version() call -- snapshot content refreshed, id/version/
-- status/activated_at on the active policy_versions row left untouched -- and
-- a no-op call in between did not trigger a needless rebuild.
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
      UPDATE public.policy_versions pv
      SET snapshot = public.build_policy_snapshot(_user_id)
      WHERE pv.id = _row.id
      RETURNING * INTO _row;
    END IF;
  END IF;

  id := _row.id; version := _row.version; snapshot := _row.snapshot;
  RETURN NEXT;
END;
$function$;
