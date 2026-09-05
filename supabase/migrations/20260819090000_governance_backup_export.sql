-- Governance backup export: a private storage bucket for the daily
-- logical export (governance-backup-export edge function), plus its cron
-- job. Deliberately no RLS policies granting authenticated/anon access --
-- this bucket holds a full, cross-account dump of governance tables and
-- must stay service-role-only.
INSERT INTO storage.buckets (id, name, public)
VALUES ('governance-backups', 'governance-backups', false)
ON CONFLICT (id) DO NOTHING;

-- Runs before retention-sweep-daily (0 3 UTC) so today's export always
-- captures rows that sweep might purge later the same morning.
SELECT cron.schedule(
  'governance-backup-export-daily',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://ekuodpaaiugzywfcmjeo.supabase.co/functions/v1/governance-backup-export',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
