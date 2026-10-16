-- Outer Control brain, round 2: what people corrected, and the one-time realignment of a result
-- that does not match the goal.
--
-- A correction stores only the outcome (approved / declined / edited), the rules involved, and a
-- word-overlap fingerprint (hashes of 3-word windows, at most 64 integers). It never stores the text.
CREATE TABLE public.outer_control_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  api_key_id uuid REFERENCES public.api_keys(id) ON DELETE SET NULL,
  session_id uuid REFERENCES public.outer_control_sessions(id) ON DELETE SET NULL,
  step_no integer NOT NULL DEFAULT 0,
  outcome text NOT NULL CHECK (outcome IN ('approved', 'declined', 'edited')),
  rule_ids text[] NOT NULL DEFAULT '{}',
  rule_names text[] NOT NULL DEFAULT '{}',
  risk text CHECK (risk IS NULL OR risk IN ('low', 'medium', 'high')),
  fingerprint integer[] NOT NULL DEFAULT '{}' CHECK (cardinality(fingerprint) <= 64),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outer_control_corrections_user_idx ON public.outer_control_corrections (user_id, created_at DESC);

ALTER TABLE public.outer_control_corrections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read their corrections" ON public.outer_control_corrections FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Team members read the owner's corrections" ON public.outer_control_corrections FOR SELECT USING (is_account_member(user_id));
GRANT SELECT ON public.outer_control_corrections TO authenticated;
GRANT ALL ON public.outer_control_corrections TO service_role;

-- How many times the final result of this session was sent back because it did not match the goal.
ALTER TABLE public.outer_control_sessions ADD COLUMN align_used integer NOT NULL DEFAULT 0;
