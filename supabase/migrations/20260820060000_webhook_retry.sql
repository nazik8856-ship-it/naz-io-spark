-- Webhook delivery retry/backoff: outbound webhooks (PR from earlier this
-- session) were fire-and-forget -- a briefly-down receiving endpoint meant
-- that event was lost forever, only visible as a single "not ok" row with
-- no second chance. Adds exponential-backoff retry, up to 5 attempts.

ALTER TABLE public.webhook_deliveries
  ADD COLUMN payload jsonb,
  ADD COLUMN attempt integer NOT NULL DEFAULT 1,
  ADD COLUMN next_retry_at timestamptz,
  ADD COLUMN original_delivery_id uuid REFERENCES public.webhook_deliveries(id) ON DELETE SET NULL;

CREATE INDEX idx_webhook_deliveries_due_retry
  ON public.webhook_deliveries (next_retry_at)
  WHERE ok = false AND next_retry_at IS NOT NULL;

SELECT cron.schedule(
  'webhook-retry-sweep-every-5min',
  '*/5 * * * *',
  $$
  INSERT INTO public.scheduled_job_requests (job_name, request_id)
  SELECT 'webhook-retry-sweep-every-5min', net.http_post(
    url := 'https://qaeduinfirtljnbecyzq.supabase.co/functions/v1/webhook-retry-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
