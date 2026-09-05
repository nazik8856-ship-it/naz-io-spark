-- Scheduled monthly report emails: the compliance report and the ROI
-- report are both click-to-generate today. A professional ops tool lets
-- you schedule "email me this every month" the same way the weekly
-- trend/daily digest already auto-send -- reuses that exact delivery
-- infra (send-transactional-email + the template registry), just a new
-- template and a new monthly cron job.
ALTER TABLE public.profiles
  ADD COLUMN compliance_report_monthly_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN roi_report_monthly_enabled boolean NOT NULL DEFAULT false;

-- 1st of each month, 07:00 UTC -- after the month has fully closed out.
SELECT cron.schedule(
  'control-monthly-report-email-1st',
  '0 7 1 * *',
  $$
  INSERT INTO public.scheduled_job_requests (job_name, request_id)
  SELECT 'control-monthly-report-email-1st', net.http_post(
    url := 'https://ekuodpaaiugzywfcmjeo.supabase.co/functions/v1/control-monthly-report-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
