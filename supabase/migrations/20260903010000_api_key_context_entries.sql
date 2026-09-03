-- "White-labeled 'brain' endpoint" plan, item 2: per-key grounding context
-- for POST /control-api/v1/respond -- the facts an integrating company
-- gives NazAI so it can answer its own end user's messages accurately.
-- Scoped strictly to one api_key_id (ON DELETE CASCADE), never account-
-- wide like knowledge_base_entries -- one company's context must never
-- leak into another key's answers. Mirrors api_key_action_policies' exact
-- shape (see 20260829070000_action_type_policy_overrides.sql).
CREATE TABLE IF NOT EXISTS public.api_key_context_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  api_key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  entry_text text NOT NULL CHECK (char_length(entry_text) <= 2000),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_key_context_entries_key_idx
  ON public.api_key_context_entries (api_key_id, created_at ASC);

GRANT SELECT ON public.api_key_context_entries TO authenticated;
GRANT ALL ON public.api_key_context_entries TO service_role;

ALTER TABLE public.api_key_context_entries ENABLE ROW LEVEL SECURITY;

-- Read-only for authenticated users, same as api_key_action_policies --
-- every write goes through the api-keys edge function's service-role
-- client, which applies the same resolveAccountScope owner check the
-- existing POST /api-keys/:id/policy endpoint already uses.
CREATE POLICY "Owners and team members read their api key context entries"
  ON public.api_key_context_entries FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_account_member(user_id));
