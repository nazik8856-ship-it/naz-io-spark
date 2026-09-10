-- Per-key configurable rate limit for POST /control-api/v1/respond,
-- separate from the main control-api endpoint's own rate_limit_per_minute
-- (they're rate-limited under distinct tags -- "control-api-respond" vs
-- "control-api" -- so a caller sending heavy /respond traffic shouldn't be
-- forced to share, or accidentally widen, its judgment-endpoint limit and
-- vice versa). Same "one discrete setting, one typed column" idiom, and
-- the same NULL-means-default / 1-6000 bounds as rate_limit_per_minute
-- itself (see 20260828080000_api_key_rate_limit.sql).
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS respond_rate_limit_per_minute integer
    CHECK (respond_rate_limit_per_minute IS NULL OR (respond_rate_limit_per_minute >= 1 AND respond_rate_limit_per_minute <= 6000));
