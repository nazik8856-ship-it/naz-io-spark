-- 2026-08-25 plan item 11: an email fallback for critical alerts when
-- Slack isn't connected.
--
-- Confirmed: _shared/critical-alerts.ts's only real delivery channel is
-- Slack -- when it isn't connected or slackPostMessage fails, the path
-- falls straight to a server log line plus the in-app critical_alerts
-- row. An ops team not tailing function logs or watching the dashboard
-- got zero out-of-band notice of an after-hours kill-switch trip or gate
-- failure.
--
-- DEFAULT true (not false) for existing rows, unlike a typical opt-in
-- notification channel: this isn't a marketing/informational email, it's
-- the only out-of-band signal for a genuine safety event whose entire
-- purpose is that today it gets NONE at all when Slack isn't connected.
-- Matches digest_enabled/weekly_trend_enabled's own owner-default-enabled
-- treatment from 20260821120000, extended here to also apply retroactively
-- to already-existing preference rows for this one channel specifically.
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS critical_alert_email_enabled boolean NOT NULL DEFAULT true;
