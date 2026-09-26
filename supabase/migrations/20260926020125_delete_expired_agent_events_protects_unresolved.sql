-- retention-sweep previously deleted agent_events purely by age, with no
-- "still live work" exemption -- unlike incidents/pending_approvals/
-- api_response_generations, which all correctly protect an unresolved row
-- regardless of how old it is. Two agent_events kinds represent a paused,
-- awaiting-a-human state:
--   - 'pending_approval' (per-agent guardrail queue, agent-approval/index.ts)
--     already has a resolved_at column, set via claimRowOnce when answered.
--   - 'clarification_request' (escalateLowConfidence's low-confidence pause,
--     agent-runtime/index.ts) has no resolved_at of its own -- it's
--     considered answered only when a LATER 'clarification_answer' event
--     exists with payload->>'ref' equal to this row's id (see
--     agent-runtime's loadEscalationVerdicts and
--     src/lib/agent-clarifications.ts's pendingClarification, both of which
--     already rely on this exact matching).
-- An unanswered row of either kind, once purged by age alone, permanently
-- loses the only record of what the agent was asking -- there's no
-- resolved_at to flip and no ref to match against any longer, so it can
-- never be displayed or answered again.
CREATE OR REPLACE FUNCTION public.delete_expired_agent_events(_user_id uuid, _cutoff timestamptz)
RETURNS TABLE(id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  DELETE FROM public.agent_events e
  WHERE e.user_id = _user_id
    AND e.created_at < _cutoff
    AND NOT (e.kind = 'pending_approval' AND e.resolved_at IS NULL)
    AND NOT (
      e.kind = 'clarification_request'
      AND NOT EXISTS (
        SELECT 1 FROM public.agent_events a
        WHERE a.agent_id = e.agent_id
          AND a.kind = 'clarification_answer'
          AND (a.payload ->> 'ref') = e.id::text
      )
    )
  RETURNING e.id;
$function$;
