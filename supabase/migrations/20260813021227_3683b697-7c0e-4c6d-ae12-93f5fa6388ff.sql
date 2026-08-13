
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS control_strictness text NOT NULL DEFAULT 'balanced';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_control_strictness_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_control_strictness_check
  CHECK (control_strictness IN ('loose', 'balanced', 'strict'));

GRANT UPDATE (control_strictness) ON public.profiles TO authenticated;
