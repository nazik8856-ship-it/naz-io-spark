-- "Policy autonomy" plan, item 3: outside an account's own business
-- hours, nobody is watching to catch an automation mistake in the
-- moment. Let an api key configure a quiet-hours window (local hour of
-- day, in its own timezone) where an action that would normally
-- auto-resolve escalates for real review instead.
--
-- Nullable/additive: a key with no quiet_hours_timezone set has no
-- quiet-hours behavior at all, exactly as today.
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS quiet_hours_start_hour smallint,
  ADD COLUMN IF NOT EXISTS quiet_hours_end_hour smallint,
  ADD COLUMN IF NOT EXISTS quiet_hours_timezone text,
  ADD CONSTRAINT api_keys_quiet_hours_start_hour_range CHECK (quiet_hours_start_hour IS NULL OR (quiet_hours_start_hour >= 0 AND quiet_hours_start_hour <= 23)),
  ADD CONSTRAINT api_keys_quiet_hours_end_hour_range CHECK (quiet_hours_end_hour IS NULL OR (quiet_hours_end_hour >= 0 AND quiet_hours_end_hour <= 23));
