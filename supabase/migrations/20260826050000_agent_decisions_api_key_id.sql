-- "Outer NazAI" plan, item 8: trace which API key made each
-- externally-triggered decision.
--
-- A structured column, not a text-embedded note in `description` or
-- `params` -- matches this project's own established preference (see
-- action_type/provider from 2026-08-23) for querying/joining real data
-- over parsing free text. Nullable: every decision from every other
-- caller (agent-runtime, the chat UI, agent-approval) simply never sets
-- this. ON DELETE SET NULL rather than CASCADE -- there is no "delete a
-- key" feature (only revoke), but if one is ever added, a decision's
-- audit-trail row must survive the key that once authenticated it being
-- removed.
ALTER TABLE public.agent_decisions
  ADD COLUMN IF NOT EXISTS api_key_id uuid REFERENCES public.api_keys(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agent_decisions_api_key_id
  ON public.agent_decisions (api_key_id) WHERE api_key_id IS NOT NULL;
