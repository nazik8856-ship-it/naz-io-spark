-- 2026-08-23 plan item 6: agent config version history + rollback.
-- The generic log_config_change() trigger (20260819010000_config_changes.sql)
-- already exists and gives full before/after JSON history for free, the
-- same way hard_rules/safety_rules/ai_spend_caps already have it -- it was
-- just never wired to public.agents itself (agent_strictness_overrides and
-- circuit_breakers already log; agents, where an agent's own name/manifest/
-- kill_switch/caps actually live, did not).
CREATE TRIGGER log_agents_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.log_config_change();

-- Rollback is genuinely new. Applies the FULL "before" snapshot back onto
-- the live row, not a partial patch -- agents has NOT NULL/CHECK-
-- constrained columns (confidence_threshold's range check, client_write_
-- mode's enum check) that a partial jsonb_set-style patch could leave in
-- an invalid combination. Built generically off information_schema rather
-- than a hardcoded column list, so it stays correct as agents gains new
-- columns over time -- the logging trigger already captures the full row
-- via to_jsonb(OLD)/to_jsonb(NEW), so nothing here needs to be kept in
-- sync by hand when a future migration adds a column.
--
-- A column present on the live table today but absent from an OLDER
-- "before" snapshot (e.g. a NOT NULL column a later migration added) is
-- deliberately left untouched, not zeroed or defaulted -- there is no
-- correct historical value to roll it back to, and leaving it alone is
-- safer than guessing.
--
-- Scoped to table_name = 'agents' only for now; other config_changes
-- tables (hard_rules, safety_rules, ai_spend_caps, profiles,
-- agent_strictness_overrides, circuit_breakers) don't have a rollback path
-- yet.
CREATE OR REPLACE FUNCTION public.rollback_config_change(_change_id uuid)
RETURNS public.config_changes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
  c public.config_changes;
  col record;
  set_parts text[] := '{}';
  applied_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO c FROM public.config_changes WHERE id = _change_id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Config change not found'; END IF;
  IF c.user_id <> uid AND NOT public.is_account_member(c.user_id, 'owner') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF c.table_name <> 'agents' THEN
    RAISE EXCEPTION 'Rollback is only supported for agent config changes today';
  END IF;
  IF c.before IS NULL THEN
    RAISE EXCEPTION 'This change has no prior state to roll back to (it was the agent''s creation)';
  END IF;

  FOR col IN
    SELECT ic.column_name, ic.data_type
    FROM information_schema.columns ic
    WHERE ic.table_schema = 'public' AND ic.table_name = 'agents'
      AND ic.column_name NOT IN ('id', 'user_id', 'created_at', 'updated_at')
      AND c.before ? ic.column_name
  LOOP
    set_parts := set_parts || format('%I = ($1 ->> %L)::%s', col.column_name, col.column_name, col.data_type);
  END LOOP;

  IF array_length(set_parts, 1) IS NULL THEN
    RAISE EXCEPTION 'Nothing to roll back -- the captured snapshot had no recognized agents columns';
  END IF;

  EXECUTE format(
    'UPDATE public.agents SET %s, updated_at = now() WHERE id = $2 AND user_id = $3 RETURNING id',
    array_to_string(set_parts, ', ')
  ) INTO applied_id USING c.before, c.row_id, c.user_id;

  IF applied_id IS NULL THEN
    RAISE EXCEPTION 'Agent no longer exists -- cannot roll back a deleted agent';
  END IF;

  RETURN c;
END;
$$;

REVOKE ALL ON FUNCTION public.rollback_config_change(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rollback_config_change(uuid) TO authenticated;
