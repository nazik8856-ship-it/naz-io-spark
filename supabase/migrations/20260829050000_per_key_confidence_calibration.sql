-- "Policy autonomy" plan, item 5: confidence-calibration accuracy today
-- is judged as one blended number for the whole account, mixing NazAI's
-- own internal agents together with every external company's traffic.
-- One external company's badly-calibrated automation can hide inside a
-- healthy overall average, or a healthy one can get unfairly flagged by
-- someone else's problem. Adds a nullable api_key_id dimension so an
-- external-api decision's calibration is tracked under its OWN key,
-- never blended into the account-wide bucket internal-agent decisions
-- still use (api_key_id IS NULL, exactly today's behavior, unchanged).
ALTER TABLE public.confidence_calibration
  ADD COLUMN IF NOT EXISTS api_key_id uuid;

-- Drop whatever the original inline UNIQUE (user_id, period_end,
-- bucket_min) constraint was actually named (found by its real column
-- set, not guessed by Postgres's default naming convention) before
-- adding the real 4-column one -- leaving the old 3-column constraint
-- in place would keep rejecting a per-key row that only differs from
-- the account-wide row by api_key_id.
DO $$
DECLARE
  old_constraint_name text;
BEGIN
  SELECT tc.constraint_name INTO old_constraint_name
  FROM information_schema.table_constraints tc
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'confidence_calibration'
    AND tc.constraint_type = 'UNIQUE'
    AND (
      SELECT array_agg(kcu.column_name ORDER BY kcu.ordinal_position)
      FROM information_schema.key_column_usage kcu
      WHERE kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    ) = ARRAY['user_id', 'period_end', 'bucket_min']
  LIMIT 1;

  IF old_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.confidence_calibration DROP CONSTRAINT %I', old_constraint_name);
  END IF;
END $$;

ALTER TABLE public.confidence_calibration
  ADD CONSTRAINT confidence_calibration_user_period_bucket_key_key
  UNIQUE (user_id, period_end, bucket_min, api_key_id);

CREATE INDEX IF NOT EXISTS idx_confidence_calibration_api_key
  ON public.confidence_calibration (api_key_id, period_end DESC)
  WHERE api_key_id IS NOT NULL;

-- Same reasoning for the flags a "severe" bucket produces -- a flag
-- raised for one external key's own miscalibration must never be
-- confused with (or count as) an account-wide flag.
ALTER TABLE public.confidence_bucket_flags
  ADD COLUMN IF NOT EXISTS api_key_id uuid;
