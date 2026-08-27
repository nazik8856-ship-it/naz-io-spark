-- "Real precedent memory" plan, item 2: item 1 only embeds a decision
-- the moment it's logged -- an account that's been using the Control
-- API for weeks would otherwise start with a completely empty memory,
-- and any decision whose live embedding attempt failed (a transient
-- provider hiccup) would never get a second chance either.
--
-- embedding_backfill_checked_at is a plain progress cursor, not a
-- success flag -- stamped on every external-api decision the backfill
-- sweep considers, whether it ended up embedded, already had an
-- embedding (from the live path), or genuinely failed. Without this,
-- the sweep (ordered oldest-first, in bounded batches so one run never
-- tries an account's entire history or exhausts an embedding-provider
-- rate limit at once) would keep re-fetching the same oldest page
-- forever once those rows are handled. A row that failed here is never
-- retried again by this sweep -- same "best-effort enrichment, never a
-- guaranteed or required step" posture as embedDecisionIfExternal
-- itself (item 1) and item 12's graceful-degradation discipline.
ALTER TABLE public.agent_decisions
  ADD COLUMN IF NOT EXISTS embedding_backfill_checked_at timestamptz;

-- Only ever scanned for external-api-origin rows -- a plain index on
-- (api_key_id, embedding_backfill_checked_at) makes "the next batch of
-- unchecked external-api decisions, oldest first" a cheap indexed scan
-- rather than a sequential one as agent_decisions grows.
CREATE INDEX idx_agent_decisions_embedding_backfill
  ON public.agent_decisions (api_key_id, created_at)
  WHERE api_key_id IS NOT NULL AND embedding_backfill_checked_at IS NULL;

-- ============================================================
-- POST-MIGRATION STEP (same convention as every scheduled sweep this
-- project has added -- applied directly, not committed as static SQL,
-- since it needs a project-specific service_role key and function URL):
--
-- CRON JOB (pg_cron): schedule 'decision-embedding-backfill-sweep-15min'
-- every 15 minutes -- frequent enough to work through a real backlog in
-- a reasonable time without ever processing more than one bounded batch
-- per run -- reusing the existing 'email_queue_service_role_key' vault
-- secret as the Authorization bearer token:
--
--    SELECT cron.schedule(
--      'decision-embedding-backfill-sweep-15min',
--      '*/15 * * * *',
--      $$
--      SELECT net.http_post(
--        url := '<SUPABASE_URL>/functions/v1/decision-embedding-backfill-sweep',
--        headers := jsonb_build_object(
--          'Content-Type', 'application/json',
--          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
--        ),
--        body := '{}'::jsonb
--      );
--      $$
--    );
--
--    To revert: SELECT cron.unschedule('decision-embedding-backfill-sweep-15min');
-- ============================================================
