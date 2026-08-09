CREATE TABLE public.circuit_breakers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  recent_outcomes text[] NOT NULL DEFAULT '{}',
  attempts integer NOT NULL DEFAULT 0,
  failures integer NOT NULL DEFAULT 0,
  failure_rate numeric NOT NULL DEFAULT 0,
  tripped boolean NOT NULL DEFAULT false,
  tripped_at timestamptz,
  trip_count integer NOT NULL DEFAULT 0,
  last_reason text,
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, action_type)
);

GRANT SELECT, UPDATE ON public.circuit_breakers TO authenticated;
GRANT ALL ON public.circuit_breakers TO service_role;

ALTER TABLE public.circuit_breakers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own breakers"
ON public.circuit_breakers FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can reset their own breakers"
ON public.circuit_breakers FOR UPDATE TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER circuit_breakers_updated_at
BEFORE UPDATE ON public.circuit_breakers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();