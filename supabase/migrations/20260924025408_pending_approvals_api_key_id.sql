-- Pillar 3 top-10 item 4: stuck-approval-sweep can only ever discover a
-- pending_approvals row's originating api key by joining through its
-- decision_id -> agent_decisions.api_key_id. Live data already has rows
-- with decision_id NULL (control-engine's auto_narrow "modify" flow when
-- logDecision itself didn't return an id) that are consequently invisible
-- to the sweep FOREVER, no matter how long they sit or what on_uncertain
-- policy the account has configured -- there's no decision to join through.
--
-- Persisting the api key directly on the row (createPendingApproval already
-- receives it as an input, it was just never written down) removes that
-- fragile indirection: the sweep can act on any row with a real api key
-- policy regardless of whether its decision_id ever resolved. A genuinely
-- internal/chat-driven approval (no api key at all, ctx.apiKeyId null) is
-- completely unaffected -- it still has no api_key_id here either, so the
-- sweep's own "no api key, no auto-resolve" rule still holds exactly as
-- deliberately designed.
ALTER TABLE public.pending_approvals
  ADD COLUMN IF NOT EXISTS api_key_id uuid REFERENCES public.api_keys(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pending_approvals_api_key_id
  ON public.pending_approvals (api_key_id) WHERE api_key_id IS NOT NULL;
