-- "Policy autonomy" plan, item 10: break down an API key's auto-resolve
-- trust by action type instead of one blanket on_uncertain policy for
-- everything that key ever sends. A lightweight override list layered on
-- top of api_keys.on_uncertain -- an action-type-specific row here
-- overrides the blanket default when its pattern matches a decision's
-- own action_type, exactly the way this account already reads a hard
-- rule's action_type_pattern (same "*"-wildcard glob convention,
-- action-type-policy.ts). Every other decision this key sends, with no
-- matching override, keeps using the blanket column exactly as today.
CREATE TABLE IF NOT EXISTS public.api_key_action_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  api_key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  action_type_pattern text NOT NULL,
  on_uncertain text NOT NULL CHECK (on_uncertain IN ('human_review', 'auto_deny', 'auto_allow', 'auto_narrow', 'callback')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_key_action_policies_unique_pattern UNIQUE (api_key_id, action_type_pattern)
);

CREATE INDEX IF NOT EXISTS api_key_action_policies_key_idx
  ON public.api_key_action_policies (api_key_id, created_at ASC);

GRANT SELECT ON public.api_key_action_policies TO authenticated;
GRANT ALL ON public.api_key_action_policies TO service_role;

ALTER TABLE public.api_key_action_policies ENABLE ROW LEVEL SECURITY;

-- Read-only for authenticated users, same as api_key_shadow_observations --
-- every write goes through the api-keys edge function's service-role
-- client, which applies the same resolveAccountScope owner check the
-- existing POST /api-keys/:id/policy endpoint already uses.
CREATE POLICY "Owners and team members read their api key action policies"
  ON public.api_key_action_policies FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_account_member(user_id));
