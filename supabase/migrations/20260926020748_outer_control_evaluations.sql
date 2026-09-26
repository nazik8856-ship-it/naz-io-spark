-- Outer Control System, foundation. Mirrors agent_decisions' role for
-- Inner Control: the one audit/provenance log every outer-control verdict
-- writes to, whether the call came from NazAI itself (routing a connected
-- external AI tool's output through this before trusting it) or from an
-- external caller hitting the outer-control API directly with an API key.
--
-- content_kind is 'text' for v1 -- a free-text response from an external
-- AI (support bot, ChatGPT, a connected CRM AI) run through the same
-- safety_rules/hard_rules pattern scanning Inner Control's safety-scanner
-- already does on action params, since that scanner is content-agnostic
-- (it flattens whatever it's given and pattern-matches). 'action' is
-- reserved for a later round that reuses control-gate's structured
-- hard-rule/circuit-breaker checks against a proposed EXTERNAL action, not
-- just free text -- not yet implemented, the check constraint just leaves
-- room for it so this table doesn't need a shape migration when it lands.
CREATE TABLE public.outer_control_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  api_key_id uuid REFERENCES public.api_keys(id) ON DELETE SET NULL,
  agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  source_model text NOT NULL,
  content_kind text NOT NULL DEFAULT 'text' CHECK (content_kind IN ('text', 'action')),
  input_excerpt text NOT NULL,
  output_text text,
  verdict text NOT NULL CHECK (verdict IN ('allow', 'modify', 'block', 'escalate')),
  trust_score integer NOT NULL CHECK (trust_score BETWEEN 0 AND 100),
  matches jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outer_control_evaluations_user_created_idx
  ON public.outer_control_evaluations (user_id, created_at DESC);

ALTER TABLE public.outer_control_evaluations ENABLE ROW LEVEL SECURITY;

-- Same split agent_decisions uses: the owner's own policy plus a separate
-- team-member policy via is_account_member, rather than one OR'd
-- condition -- kept consistent so this table reads the same way every
-- other control-system table in this codebase does.
CREATE POLICY "Users can read their own outer control evaluations"
  ON public.outer_control_evaluations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Team members can view owner's outer control evaluations"
  ON public.outer_control_evaluations FOR SELECT
  USING (is_account_member(user_id));

-- Inserts happen through the outer-control edge function's service-role
-- client in practice, but a real owner-scoped INSERT policy is granted
-- anyway, same as agent_decisions, in case a future client-side call site
-- needs it -- never broader than the row's own owner.
CREATE POLICY "Users can append their own outer control evaluations"
  ON public.outer_control_evaluations FOR INSERT
  WITH CHECK (auth.uid() = user_id);
