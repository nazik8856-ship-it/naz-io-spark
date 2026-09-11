-- "Incident lifecycle" plan, item 3: schedules incident-escalation-sweep
-- every 30 minutes, the same cadence approval-escalation-sweep already
-- runs at for the identical underlying problem (a real signal sitting
-- untouched with nobody watching).
SELECT cron.schedule(
  'incident-escalation-sweep-30min',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://ekuodpaaiugzywfcmjeo.supabase.co/functions/v1/incident-escalation-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
