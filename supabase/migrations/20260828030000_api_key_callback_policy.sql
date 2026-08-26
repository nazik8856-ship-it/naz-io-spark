-- "Zero human review" plan, item 4: a fifth on_uncertain policy value,
-- "callback" -- instead of a NazAI employee resolving an unsure case, or
-- a fixed auto_allow/auto_deny/auto_narrow rule, NazAI asks the CALLING
-- COMPANY's own system what to do (POSTing to callback_url, HMAC-signed
-- the same way outbound webhooks already are) and waits a short, bounded
-- window for an answer via a new inbound endpoint, falling back to
-- callback_fallback if nothing comes back in time.
--
-- callback_timeout_seconds is capped at 60 deliberately: this wait
-- happens synchronously inside the same Control API request, and
-- Supabase Edge Functions have their own wall-clock execution limit --
-- a "short, bounded" wait per the plan's own framing, not a
-- long-running job.
ALTER TABLE public.api_keys
  DROP CONSTRAINT IF EXISTS api_keys_on_uncertain_check;
ALTER TABLE public.api_keys
  ADD CONSTRAINT api_keys_on_uncertain_check
  CHECK (on_uncertain IN ('human_review', 'auto_deny', 'auto_allow', 'auto_narrow', 'callback'));

ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS callback_url text,
  ADD COLUMN IF NOT EXISTS callback_secret text,
  ADD COLUMN IF NOT EXISTS callback_timeout_seconds integer NOT NULL DEFAULT 20
    CHECK (callback_timeout_seconds BETWEEN 5 AND 60),
  ADD COLUMN IF NOT EXISTS callback_fallback text NOT NULL DEFAULT 'auto_deny'
    CHECK (callback_fallback IN ('auto_allow', 'auto_deny'));
