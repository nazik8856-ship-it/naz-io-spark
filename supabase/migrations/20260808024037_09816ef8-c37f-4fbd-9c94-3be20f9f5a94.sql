CREATE TABLE public.confidence_calibration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  bucket_min integer NOT NULL,
  bucket_max integer NOT NULL,
  bucket_label text NOT NULL,
  decision_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  neutral_count integer NOT NULL DEFAULT 0,
  success_rate numeric,
  expected_rate numeric,
  calibration_gap numeric,
  miscalibrated boolean NOT NULL DEFAULT false,
  severity text NOT NULL DEFAULT 'ok',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period_end, bucket_min)
);

GRANT SELECT ON public.confidence_calibration TO authenticated;
GRANT ALL ON public.confidence_calibration TO service_role;

ALTER TABLE public.confidence_calibration ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own calibration"
  ON public.confidence_calibration FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER confidence_calibration_updated_at
  BEFORE UPDATE ON public.confidence_calibration
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_confidence_calibration_user_period
  ON public.confidence_calibration (user_id, period_end DESC);