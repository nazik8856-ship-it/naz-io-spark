
CREATE OR REPLACE FUNCTION public.get_business_context(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  v_agents jsonb;
  v_clients jsonb;
  v_insights jsonb;
  v_reports jsonb;
  v_artifacts jsonb;
  v_total_actions int;
  v_ok_actions int;
  v_success_rate numeric;
  v_most_active jsonb;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required';
  END IF;
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM _user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id, 'name', a.name, 'slug', a.slug, 'goal', a.goal,
    'status', a.status, 'role', a.role,
    'schedule_cron', a.schedule_cron, 'next_run_at', a.next_run_at,
    'updated_at', a.updated_at
  ) ORDER BY a.updated_at DESC), '[]'::jsonb)
  INTO v_agents
  FROM public.agents a WHERE a.user_id = _user_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id, 'agent_id', c.agent_id, 'name', c.name, 'email', c.email,
    'company', c.company, 'tags', c.tags, 'notes', c.notes,
    'interaction_count', c.interaction_count,
    'last_interaction_at', c.last_interaction_at
  ) ORDER BY c.last_interaction_at DESC NULLS LAST), '[]'::jsonb)
  INTO v_clients
  FROM public.agent_clients c WHERE c.user_id = _user_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', i.id, 'insight', i.insight, 'kind', i.kind,
    'confidence', i.confidence, 'evidence_count', i.evidence_count,
    'source_agent_ids', i.source_agent_ids,
    'first_observed_at', i.first_observed_at,
    'last_confirmed_at', i.last_confirmed_at
  ) ORDER BY i.evidence_count DESC, i.last_confirmed_at DESC), '[]'::jsonb)
  INTO v_insights
  FROM public.org_insights i WHERE i.user_id = _user_id;

  SELECT COALESCE(jsonb_agg(r ORDER BY created_at DESC), '[]'::jsonb) INTO v_reports
  FROM (
    SELECT jsonb_build_object(
      'id', id, 'agent_id', agent_id, 'run_id', run_id,
      'title', title, 'kind', kind,
      'body_markdown', left(body_markdown, 2000),
      'created_at', created_at
    ) AS r, created_at
    FROM public.agent_reports
    WHERE user_id = _user_id
    ORDER BY created_at DESC
    LIMIT 20
  ) sub;

  SELECT COALESCE(jsonb_agg(r ORDER BY created_at DESC), '[]'::jsonb) INTO v_artifacts
  FROM (
    SELECT jsonb_build_object(
      'id', id, 'agent_id', agent_id, 'run_id', run_id,
      'kind', kind, 'title', title, 'url', url,
      'provider', provider, 'account_email', account_email,
      'ref', ref, 'created_at', created_at
    ) AS r, created_at
    FROM public.agent_artifacts
    WHERE user_id = _user_id
    ORDER BY created_at DESC
    LIMIT 30
  ) sub;

  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE (payload->>'ok')::boolean IS TRUE)::int
  INTO v_total_actions, v_ok_actions
  FROM public.agent_events
  WHERE user_id = _user_id AND kind = 'action';

  v_success_rate := CASE WHEN v_total_actions > 0
    THEN round((v_ok_actions::numeric / v_total_actions::numeric) * 100, 1)
    ELSE 0 END;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'agent_id', agent_id, 'action_count', cnt
  ) ORDER BY cnt DESC), '[]'::jsonb) INTO v_most_active
  FROM (
    SELECT agent_id, COUNT(*)::int AS cnt
    FROM public.agent_events
    WHERE user_id = _user_id AND kind = 'action'
      AND created_at > now() - interval '30 days'
    GROUP BY agent_id
    ORDER BY cnt DESC
    LIMIT 5
  ) t;

  result := jsonb_build_object(
    'user_id', _user_id,
    'generated_at', now(),
    'agents', v_agents,
    'clients', v_clients,
    'insights', v_insights,
    'recent_reports', v_reports,
    'recent_artifacts', v_artifacts,
    'stats', jsonb_build_object(
      'total_actions', v_total_actions,
      'successful_actions', v_ok_actions,
      'success_rate_pct', v_success_rate,
      'most_active_agents_30d', v_most_active
    )
  );

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_business_context(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_business_context(uuid) TO authenticated, service_role;
