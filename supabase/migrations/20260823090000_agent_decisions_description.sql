-- 2026-08-23 plan item 14: real-traffic policy replay, scoped to
-- already-captured data (no new PII capture on ALLOW decisions -- user-
-- confirmed scope). agent_decisions gained `params` for BLOCK decisions
-- from hard_rule/safety_scanner (item 4), but never gained `description`
-- -- and the safety scanner scans `params` + `description` together
-- (`flatten` in safety-scanner.ts), so a block-sourced row was only ever
-- half-usable for a real replay of that layer. Closes that gap on the
-- SAME two call sites item 4 already touches -- no wider capture.
ALTER TABLE public.agent_decisions
  ADD COLUMN IF NOT EXISTS description text;

-- Real-traffic replay's data source: every decision whose action payload
-- was actually captured -- block-sourced agent_decisions rows (item 4)
-- and every escalated pending_approvals row (which has always captured
-- both description and params, for every non-block verdict). Plain
-- historical ALLOWs have neither and are excluded, by design.
--
-- Service-role-gated with an explicit _user_id, not auth.uid() -- same
-- lesson as verify_decision_signatures_batch_for/get_recent_breaker_trips
-- earlier today: control-engine's admin client has no JWT context, so
-- auth.uid() would be NULL there.
CREATE OR REPLACE FUNCTION public.get_replayable_real_decisions(_user_id uuid, _limit integer DEFAULT 200)
RETURNS TABLE(
  id uuid,
  action_type text,
  provider text,
  description text,
  params jsonb,
  created_at timestamptz,
  real_source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, action_type, provider, description, params, created_at, 'decision'::text AS real_source
  FROM public.agent_decisions
  WHERE user_id = _user_id AND params IS NOT NULL
  UNION ALL
  SELECT decision_id, action_type, provider, description, params, created_at, 'approval'::text AS real_source
  FROM public.pending_approvals
  WHERE user_id = _user_id AND decision_id IS NOT NULL
  ORDER BY created_at DESC
  LIMIT greatest(1, least(_limit, 2000));
$$;
REVOKE ALL ON FUNCTION public.get_replayable_real_decisions(uuid, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_replayable_real_decisions(uuid, integer) TO service_role;
