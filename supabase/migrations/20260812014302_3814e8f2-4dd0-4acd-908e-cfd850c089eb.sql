CREATE TABLE public.policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version integer NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, version)
);

GRANT SELECT, INSERT, UPDATE ON public.policy_versions TO authenticated;
GRANT ALL ON public.policy_versions TO service_role;

ALTER TABLE public.policy_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own policy versions"
ON public.policy_versions FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_policy_versions_updated_at
BEFORE UPDATE ON public.policy_versions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE UNIQUE INDEX policy_versions_one_active_per_user
ON public.policy_versions (user_id) WHERE status = 'active';

ALTER TABLE public.agent_decisions ADD COLUMN IF NOT EXISTS policy_version integer;

-- Builds a snapshot of the user's current live policy surface.
CREATE OR REPLACE FUNCTION public.build_policy_snapshot(_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'hard_rules', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', hr.id, 'rule_text', hr.rule_text, 'action_type_pattern', hr.action_type_pattern,
        'effect', hr.effect, 'provider', hr.provider, 'enabled', hr.enabled, 'shadow_mode', hr.shadow_mode
      ) ORDER BY hr.created_at)
      FROM public.hard_rules hr WHERE hr.user_id = _user_id
    ), '[]'::jsonb),
    'safety_rules', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', sr.id, 'name', sr.name, 'category', sr.category, 'pattern', sr.pattern,
        'severity', sr.severity, 'enabled', sr.enabled
      ) ORDER BY sr.created_at)
      FROM public.safety_rules sr WHERE sr.user_id = _user_id
    ), '[]'::jsonb),
    'thresholds', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'agent_id', a.id, 'slug', a.slug, 'confidence_threshold', a.confidence_threshold,
        'autonomy', a.autonomy, 'auto_approve_low_risk', a.auto_approve_low_risk,
        'daily_run_cap', a.daily_run_cap, 'daily_action_cap', a.daily_action_cap
      ) ORDER BY a.created_at)
      FROM public.agents a WHERE a.user_id = _user_id
    ), '[]'::jsonb),
    'spend_cap', COALESCE((
      SELECT jsonb_build_object('daily_cap_usd', c.daily_cap_usd, 'enabled', c.enabled)
      FROM public.ai_spend_caps c WHERE c.user_id = _user_id
    ), jsonb_build_object('daily_cap_usd', 5, 'enabled', true)),
    'captured_at', now()
  );
$$;

-- Returns the active policy version for a user, creating v1 from live tables if none exists.
CREATE OR REPLACE FUNCTION public.get_active_policy_version(_user_id uuid)
RETURNS TABLE(id uuid, version integer, snapshot jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.policy_versions%ROWTYPE;
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
  END IF;

  id := _row.id; version := _row.version; snapshot := _row.snapshot;
  RETURN NEXT;
END;
$$;