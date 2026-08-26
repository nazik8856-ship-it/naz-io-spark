-- "Zero human review" plan, item 11: every account today shares the
-- exact same fixed Control API speed limit
-- (POST_AUTH_RATE_LIMIT_PER_MINUTE, control-api/index.ts), no matter how
-- much legitimate automated traffic a specific company actually sends.
-- checkRateLimit (_shared/rate-limit.ts:21-42) already accepts an
-- arbitrary limit as a plain parameter -- the primitive is generic, every
-- call site just always passed the same hardcoded constant. NULL (the
-- default) keeps today's exact behavior for any key that never sets
-- this. Bounded so a bad value can never accidentally disable rate
-- limiting outright (unbounded) or make a key unusable (zero/negative).
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS rate_limit_per_minute integer
    CHECK (rate_limit_per_minute IS NULL OR (rate_limit_per_minute >= 1 AND rate_limit_per_minute <= 6000));
