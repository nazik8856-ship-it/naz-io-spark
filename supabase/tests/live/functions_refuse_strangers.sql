-- User & data isolation, front 5: every user-facing, API-key and scheduled function must refuse a stranger. Run it against the LIVE project
-- after any change to a function or to function-access.ts, and before a release. Needs nothing but the public (publishable) key.
--
-- Step 1 (this file): posts an empty body to each function with only the public key. Step 2 (below, run a minute later): reads the answers.
-- Pass = every answer is 401, 403, 404, 405, 400 or 429. A 200 or a 5xx means a stranger got further than the front door.
-- Left out on purpose: the public functions (reachable by design), three functions where signing in is optional (analyze-inputs,
-- compile-agent-manifest, compile-website-manifest: they answer a stranger, only with data a stranger may see) and the generated mcp bundle.
-- The list is the register in supabase/functions/_shared/function-access.ts (73 functions on 2026-11-01).
CREATE TEMP TABLE IF NOT EXISTS stranger_check (fn text PRIMARY KEY, req_id bigint);
INSERT INTO stranger_check (fn, req_id)
SELECT f, net.http_post(
  url := 'https://ekuodpaaiugzywfcmjeo.supabase.co/functions/v1/' || f,
  headers := jsonb_build_object('Authorization', 'Bearer ' || '<PUBLISHABLE_ANON_KEY>', 'Content-Type', 'application/json'),
  body := '{}'::jsonb, timeout_milliseconds := 30000)
FROM unnest(ARRAY['account-invite', 'account-invite-accept', 'agent-approval', 'agent-runtime', 'agent-scheduler', 'agent-think-tank', 'analyze-org-insights', 'api-keys', 'approval-escalation-sweep', 'audit-integrity-sweep', 'auto-resolution-share-sweep', 'business-context-researcher', 'calibrate-confidence', 'canva-oauth-start', 'capability-status', 'content-gap-backlog-sweep', 'content-gap-triage-sweep', 'control-api', 'control-api-abuse-sweep', 'control-digest-email', 'control-engine', 'control-incidents', 'control-monthly-report-email', 'control-self-audit', 'control-system-decide', 'control-test-suite', 'control-weekly-trend-email', 'cron-correlated-failures', 'cron-health-check', 'cross-account-precedent-sweep', 'data-deletion-sweep', 'decision-embedding-backfill-sweep', 'delete-project', 'encrypted-write', 'figma-oauth-start', 'final-assembly-check', 'generate-business-plan', 'generate-site-images', 'generation-canary', 'gmail-oauth-start', 'governance-backup-export', 'incident-escalation-sweep', 'integration-connect', 'integration-revocation-sweep', 'integration-sync', 'knowledge-base-auto-draft-sweep', 'measure-decision-outcomes', 'notion-oauth-start', 'outcome-quality-sweep', 'outer-control', 'outer-control-drive', 'outer-control-read', 'outer-control-session-sweep', 'precedent-pipeline-health-sweep', 'preview-transactional-email', 'process-email-queue', 'process-mission', 'projects', 'purchase-credits', 'readiness-webhook-sweep', 'recurring-assembly-sweep', 'retention-sweep', 'rule-auto-draft-sweep', 'rule-simulator', 'shopify-oauth-start', 'simulate-scenario', 'site-images-backfill-sweep', 'site-images-cleanup-sweep', 'slack-oauth-start', 'stuck-approval-sweep', 'swift-service', 'webhook-retry-sweep', 'webhooks-create']) f
ON CONFLICT (fn) DO UPDATE SET req_id = EXCLUDED.req_id;

-- Step 2, a minute later (the same session, or put the ids in by hand):
--   SELECT s.fn, r.status_code, left(r.content::text, 80) AS answer
--   FROM stranger_check s LEFT JOIN net._http_response r ON r.id = s.req_id
--   WHERE r.status_code IS NULL OR r.status_code NOT IN (400, 401, 403, 404, 405, 429)
--   ORDER BY 1;      -- no rows = pass; a NULL status is a timeout (first start of a large function): send that one again
