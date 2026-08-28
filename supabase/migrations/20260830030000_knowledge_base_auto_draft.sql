-- "Knowledge & autonomy" plan, item 3: auto-suggest a knowledge-base
-- entry (item 1) when humans keep resolving the same shape of escalated
-- decision for the same structured reason (item 2). `pending_review`
-- marks an entry a human hasn't confirmed yet; `auto_drafted` marks it
-- as NazAI's own suggestion rather than something a human typed
-- directly. Deliberately inserted with enabled=false -- an auto-drafted
-- entry reuses the EXISTING enabled=true filter control-engine's own
-- prompt-injection query already applies (knowledge-base.ts), so it
-- never reaches the live judgment prompt until a human reviews it and
-- flips enabled to true themselves. No second "is this reviewed" check
-- needed anywhere that reads the table.
ALTER TABLE public.knowledge_base_entries
  ADD COLUMN IF NOT EXISTS pending_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_drafted boolean NOT NULL DEFAULT false;

-- ============================================================
-- POST-MIGRATION STEP (same convention as every other scheduled sweep in
-- this codebase -- applied directly, not committed as static SQL, since
-- it needs a project-specific service_role key and function URL):
--
-- CRON JOB (pg_cron): schedule 'knowledge-base-auto-draft-sweep-daily'
-- once a day, reusing the existing 'email_queue_service_role_key' vault
-- secret as the Authorization bearer token:
--
--    SELECT cron.schedule(
--      'knowledge-base-auto-draft-sweep-daily',
--      '0 8 * * *',
--      $$
--      SELECT net.http_post(
--        url := '<SUPABASE_URL>/functions/v1/knowledge-base-auto-draft-sweep',
--        headers := jsonb_build_object(
--          'Content-Type', 'application/json',
--          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
--        ),
--        body := '{}'::jsonb
--      );
--      $$
--    );
