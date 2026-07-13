
-- 1. Extend profiles with user-provided info
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS user_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Allow owner to update display_name / user_context (not credits — enforced by column list)
DROP POLICY IF EXISTS "Users can update own profile info" ON public.profiles;
CREATE POLICY "Users can update own profile info"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Guard: prevent credits tampering via UPDATE
CREATE OR REPLACE FUNCTION public.profiles_guard_credits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.credits IS DISTINCT FROM OLD.credits AND auth.role() <> 'service_role' THEN
    NEW.credits := OLD.credits;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_credits_trg ON public.profiles;
CREATE TRIGGER profiles_guard_credits_trg
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_credits();

-- 2. Agent artifacts table
CREATE TABLE IF NOT EXISTS public.agent_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  kind text NOT NULL,           -- doc | sheet | email | calendar_event | other
  title text,
  url text,
  ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider text,
  account_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_artifacts TO authenticated;
GRANT ALL ON public.agent_artifacts TO service_role;

ALTER TABLE public.agent_artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner manages own artifacts"
  ON public.agent_artifacts FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS agent_artifacts_user_idx
  ON public.agent_artifacts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_artifacts_agent_idx
  ON public.agent_artifacts(agent_id, created_at DESC);
