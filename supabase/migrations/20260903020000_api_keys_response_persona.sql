-- "White-labeled 'brain' endpoint" plan, item 3: lets a company tell
-- NazAI once how their AI should sound (formal, casual, terse, a specific
-- brand voice), applied to every POST /control-api/v1/respond call for
-- that key instead of repeating it on every request -- same "one discrete
-- setting, one typed column" idiom as on_uncertain/rate_limit_per_minute,
-- never a jsonb blob.
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS response_persona text
  CHECK (response_persona IS NULL OR char_length(response_persona) <= 500);
