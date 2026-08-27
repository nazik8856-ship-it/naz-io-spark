-- "Real precedent memory" plan, item 1: real semantic memory for the
-- Control API's automated decision-making. Confirmed by checking every
-- migration in this project: no pgvector extension, vector column, or
-- embedding of any kind exists anywhere today -- every "similar past
-- case" feature this codebase has (fit-learning.ts, agent-runtime's own
-- matcher) is a cheap token-overlap heuristic, neither reachable from
-- the Control API's own decision paths.
--
-- NOTE ON DIMENSIONS: this assumes the embedding model exposed by the
-- Lovable AI gateway (see _shared/decision-embeddings.ts) produces
-- 768-dimensional vectors, matching Google's common text-embedding-004
-- family -- every other AI call in this codebase already routes through
-- a "google/..." model on this same gateway. VERIFY this against the
-- gateway's actual embeddings support before applying this migration to
-- a real database: pgvector's column dimension is fixed at creation
-- time, so a wrong guess here means altering the column (and
-- re-embedding every row) rather than a simple fix.
CREATE EXTENSION IF NOT EXISTS vector;

-- One row per embedded decision, scoped to api_key_id NOT NULL only --
-- this table only ever holds external-api-origin decisions
-- (_shared/decision-embeddings.ts's embedDecisionIfExternal never calls
-- with a null apiKeyId), matching this round's own confirmed scope:
-- NazAI's internal-agent decisions are never embedded here.
CREATE TABLE public.decision_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  decision_id uuid NOT NULL UNIQUE REFERENCES public.agent_decisions(id) ON DELETE CASCADE,
  api_key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  provider text NOT NULL,
  embedding vector(768) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Every real similarity search is scoped to one api_key_id at a time
-- (this round's own confirmed boundary -- precedent for a specific
-- external caller, never blended across keys or accounts) -- this is
-- what that query actually needs.
CREATE INDEX idx_decision_embeddings_key_active
  ON public.decision_embeddings (api_key_id, created_at DESC);

-- No ANN index (ivfflat/hnsw) yet -- both need real data to train
-- against, and at the volumes a genuinely new feature starts at, exact
-- nearest-neighbor search (`ORDER BY embedding <=> query LIMIT k`,
-- filtered to one api_key_id first) is both correct and fast enough.
-- Add one once an account's own embedded-decision count justifies it.

GRANT SELECT ON public.decision_embeddings TO authenticated;
GRANT ALL ON public.decision_embeddings TO service_role;
ALTER TABLE public.decision_embeddings ENABLE ROW LEVEL SECURITY;

-- Read-only for authenticated users, same as every other new-this-round
-- table (api_key_shadow_observations, policy_watch_observations) --
-- every insert comes from the service-role client inside
-- embedDecisionIfExternal, never from a user-authenticated request.
CREATE POLICY "Owners and team members read their decision embeddings"
  ON public.decision_embeddings FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_account_member(user_id));
