-- "Policy autonomy" plan, item 4: a key that gets paused for abuse
-- quietly regains full trust in 30 minutes, every single time, with no
-- memory of how often this has happened -- and a broken callback URL
-- just silently falls back forever with no consequence. If a key needs
-- its safety net more than once in a short window, or its callback
-- keeps failing, automatically downgrade its own on_uncertain policy
-- toward more caution until a human clears it.
--
-- last_pause_at is separate from the existing lifetime pause_count --
-- pause_count never resets, so it can't tell "paused twice a year apart"
-- (not really a pattern) from "paused twice this week" (real repeated
-- trouble). Comparing a NEW pause against the previous last_pause_at is
-- the windowed signal that actually matters here.
--
-- callback_failure_streak is a real, currently-missing counter --
-- confirmed no such tracking exists anywhere before this round; resets
-- to 0 the moment a real answer arrives from the callback URL again.
--
-- on_uncertain_downgraded_at/_reason is the explicit, unmistakable
-- audit marker that the CURRENT on_uncertain value was set by the
-- system, not a human -- a human clears it the normal way, by PATCHing
-- on_uncertain again through the existing endpoint.
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS last_pause_at timestamptz,
  ADD COLUMN IF NOT EXISTS callback_failure_streak integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS on_uncertain_downgraded_at timestamptz,
  ADD COLUMN IF NOT EXISTS on_uncertain_downgrade_reason text;
