# Rotating NazAI's secrets

One procedure per server secret: where to change it, what to redeploy, how to check it worked. Customers' own secrets (tool keys,
integrations, webhook signing secrets, API keys) are rotated by the customer with the buttons they already have; see the end.

Edge function secrets live in **Supabase → Edge Functions → Secrets** (project `ekuodpaaiugzywfcmjeo`). A changed value reaches
new requests within moments; redeploying the listed functions makes it certain. Every function pins its code to a commit, so a
redeploy is the same one-line deploy with the current `main` commit.

Never paste a secret into a chat, an issue or a commit. Generate long random values: 32 random bytes in base64
(`openssl rand -base64 32`), or several generated passwords joined to 32+ characters.

---

## PROJECTS_KEY (encrypts imported projects)

Two keys work at once during the rotation, so nothing becomes unreadable.

1. Generate a new key (`openssl rand -base64 32`).
2. In Edge Function secrets: add `PROJECTS_KEY_PREVIOUS` = the **current** value of `PROJECTS_KEY`. Then set `PROJECTS_KEY` = the
   new key. (Order matters: the old key must stay available.)
3. Redeploy `projects`, `outer-control-drive`, then `outer-control-session-sweep` (the sweep last: it starts re-encrypting).
4. Wait until nothing is left on the old key. The session sweep re-encrypts 20 projects per run and reports
   `"project_key": { "moved": n, "left": n }` in its response. Check in SQL:
   ```sql
   select count(*) from imported_projects where content_enc is not null and content_enc not like 'v2:' || '<new key id>' || ':%';
   ```
   (`<new key id>` is the 8-character prefix every newly saved project starts with: `v2:<id>:`.) Wait for 0.
5. Delete `PROJECTS_KEY_PREVIOUS`. Redeploy the same three functions.

Check: open a project in the website (it shows its text), import a new one. If `left` stays above 0 after many runs, a project is
encrypted with a key that is not configured: put the old key back as `PROJECTS_KEY_PREVIOUS` (nothing was changed or lost).

A missing, misnamed (e.g. `PROJECT_KEY`) or too short `PROJECTS_KEY` stops the `projects` function at startup with the name in the
error, in the function's logs.

## DATA_KEY (encrypts user content, keys its fingerprints)

The same two-key rotation as `PROJECTS_KEY`, with `DATA_KEY_PREVIOUS`. Both are derived into separate encryption and fingerprint
keys inside the functions (`_shared/field-crypto.ts`); the value itself is never used directly. Use a different value from
`PROJECTS_KEY`.

1. Generate a new key (`openssl rand -base64 32`).
2. In Edge Function secrets: add `DATA_KEY_PREVIOUS` = the **current** value of `DATA_KEY`. Then set `DATA_KEY` = the new key.
3. Redeploy every function that uses it: `projects`, `outer-control`, `outer-control-drive`, `outer-control-read`,
   `encrypted-write`, `control-engine`, `control-system-decide`, `control-api`, `agent-runtime`, `agent-approval`,
   `agent-scheduler`, `api-keys`, `website-form-submit`, `integration-sync`, `analyze-inputs`, `analyze-org-insights`,
   `measure-decision-outcomes`, `compile-agent-manifest`, `compile-website-manifest`, `final-assembly-check`,
   `recurring-assembly-sweep`, `audit-integrity-sweep`, `knowledge-base-auto-draft-sweep`, `content-gap-triage-sweep`,
   `approval-escalation-sweep`, `stuck-approval-sweep`, `auto-resolution-share-sweep`, `control-digest-email`,
   `control-weekly-trend-email`, `control-monthly-report-email`, `data-deletion-sweep`, `retention-sweep`,
   `governance-backup-export`, then `outer-control-session-sweep` (the sweep last: it starts moving things to the new key;
   its encryption step runs every five minutes). `src/test/field-encryption.test.ts` lists the same functions.
4. Wait until nothing is left on the old key. The session sweep reports `"project_fingerprints": { "moved": n, "left": n }`; once
   columns are encrypted with `DATA_KEY`, check them too:
   ```sql
   select * from encryption_report();
   ```
   `keys` shows how many values are on each key id (the 8 characters after `v2:`). Wait for `left` 0 and only the new id in `keys`.
   The governance backups are re-encrypted with the new key by the next daily backup run (60 files per run, so up to four
   runs for 30 days of backups). Check with the restore drill on the oldest day before going on:
   `POST governance-backup-export {"action": "verify", "date": "<oldest date>"}` must answer `"ok": true`.
5. Delete `DATA_KEY_PREVIOUS`. Redeploy the same functions.

Check: open a project (its fingerprint shows), refresh a linked one (it says "unchanged" when the source has not changed), and
send the same `external_id` twice to `/evaluate` (the second call returns the first verdict).

What the old key leaves behind: evaluation fingerprints (`outer_control_evaluations.content_hash`) are not remade, because the
full text is not kept. After step 5, retrying a request sent before the rotation with the same `external_id` is answered
`external_id_reused` instead of the earlier verdict; send it with a new `external_id`.

A missing, misnamed or too short `DATA_KEY` stops each of those functions at startup with the name in the error.

**Never lose this key.** Outer Control content (tasks, replies, results, memory, evaluations), website form submissions,
connected-account snapshots, agent runs and events, Generator requests, knowledge-base entries, the /respond API's context,
cache and questions, approvals' text and the governance backup files are stored encrypted with it; without it that content can
not be read and the backups can not be restored. Keep a copy in your password manager.

## RESEND_WEBHOOK_SECRET (verifies Resend's email events)

1. In Resend → Webhooks, roll the signing secret (or create a new endpoint for the same URL) and copy the new `whsec_…` value.
2. In Edge Function secrets: set `RESEND_WEBHOOK_SECRET_PREVIOUS` = the old value, `RESEND_WEBHOOK_SECRET` = the new one.
3. Redeploy `resend-events`.
4. After a day (events in flight are signed with the old secret for at most a few minutes; a day is generous), delete
   `RESEND_WEBHOOK_SECRET_PREVIOUS` and redeploy `resend-events`.

Check: the function logs show no `Rejected resend webhook: signature mismatch` after a test email bounces or is delivered.

## RESEND_API_KEY (sends email)

1. In Resend → API Keys, create a new key (sending access is enough).
2. Set `RESEND_API_KEY` to it. Redeploy `process-email-queue` and `send-welcome-resend`.
3. Send a test email (invite a team member to yourself); when it arrives, delete the old key in Resend.

## SUPABASE_SERVICE_ROLE_KEY (the server's full-access key)

Supabase gives this to every edge function automatically; the one copy NazAI keeps itself is in Vault, for the scheduled jobs
(`email_queue_service_role_key`).

1. Supabase → Project Settings → API Keys: create a new secret key (or, for the legacy JWT keys, rotate the JWT secret; that also
   changes the **anon** key, so the website's `SUPABASE_ANON_KEY` in `src/integrations/supabase/client.ts` must be updated and the
   website redeployed in the same step).
2. Update the Vault copy (SQL editor):
   ```sql
   select vault.update_secret((select id from vault.secrets where name = 'email_queue_service_role_key'), '<new key>');
   ```
3. Redeploy every edge function (the same list as a full deploy).
4. Revoke the old key once the checks pass.

Check: the next scheduled runs succeed (`select status_code, count(*) from net._http_response where created > now() - interval '1 hour' group by 1;`
shows 200s), `cron-health-check` opens no new incident, and the website still loads data.

## LOVABLE_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY (AI providers)

1. Create a new key in the provider's dashboard.
2. Set the secret. Redeploy the functions that use it:
   - `LOVABLE_API_KEY`: agent-intake, agent-runtime, agent-think-tank, analyze-inputs, analyze-org-insights,
     business-context-researcher, compile-agent-manifest, compile-website-manifest, control-system-decide, generate-ai-agent,
     generate-business-plan, generate-site-images, generation-canary, nazai-chat, outer-control-drive, outer-control-stub-tool,
     preview-transactional-email, process-mission, simulate-scenario
   - `OPENAI_API_KEY`: the list above (except preview-transactional-email) plus api-keys, content-gap-triage-sweep, control-api,
     control-engine, decision-embedding-backfill-sweep
   - `OPENROUTER_API_KEY`: swift-service
3. Revoke the old key in the provider's dashboard.

Check: build a small agent in the Generator, and run `generation-canary` (it reports whether generation works).

## OAuth client secrets (Google, Notion, Figma, Canva, Shopify, Slack)

Connected accounts keep working: their tokens do not depend on the client secret, only new connections and token refreshes do.

1. In the provider's developer console, create a new client secret. If the provider allows two active secrets at once (Google
   does), add the new one and keep the old; if regenerating replaces the old one immediately, do steps 1–3 together at a quiet time.
2. Set the secret and redeploy:
   - `GOOGLE_OAUTH_CLIENT_SECRET`: gmail-oauth-start, gmail-oauth-callback, integration-sync, agent-runtime
   - `NOTION_CLIENT_SECRET`: notion-oauth-start, notion-oauth-callback, integration-connect (revoking on disconnect)
   - `FIGMA_CLIENT_SECRET`: figma-oauth-start, figma-oauth-callback
   - `CANVA_CLIENT_SECRET`: canva-oauth-start, canva-oauth-callback, integration-connect (revoking on disconnect)
   - `SHOPIFY_CLIENT_SECRET`: shopify-oauth-start, shopify-oauth-callback, integration-connect, integration-sync
   - `SLACK_CLIENT_SECRET`: slack-oauth-start, slack-oauth-callback
3. Remove the old secret in the provider's console.

Check: connect a test account for that provider; for Google, also check that a connected Gmail still syncs (token refresh).

## Decision signing keys (Vault: decision_signing_secret, _v2, _v3)

These sign the audit trail. They are versioned: a new version is added by a migration (see
`20260825060000_decision_signing_secret_rotation.sql` and `20260923102139_decision_signature_v3_full_coverage.sql`) and new
decisions are signed with it. **Never delete an older version**: it is what verifies the decisions it signed.

---

## Customers' own secrets

Each is replaced with a path that already exists; the new value works on the very next request and the old one stops (tests:
`session-test.mts` "rotation: after Update key…", `signing-secrets_test.ts`, `api_key_revocation_test.sql`).

| Secret | How it is rotated today | What happens to the old one |
| --- | --- | --- |
| A tool's API key (Outer Control) | Tools → More → Update key | Replaced in Vault; never sent again |
| An integration's tokens | Reconnect (or Disconnect, then Connect) | Replaced; on Disconnect also revoked at the provider |
| An agent's trigger secret | Agent panel → regenerate the key | Replaced at once; the old one stops working |
| An API key | Revoke, then create a new one | Refused on its next request |
| An API key's callback secret | Through the API (`api-keys` policy update with a new `callback_secret`); there is no website screen | Replaced in Vault |
| An outbound webhook's signing secret | **No button in the website.** Delete the webhook and create it again (the new secret is shown once), or call the `rotate_webhook_secret(webhook_id, new_secret, grace_hours)` database function as the owner | Delete/recreate: gone at once. Rotate: still sent as `X-NazAI-Signature-Previous` for the grace window, then deleted |

A "Rotate secret" button for webhooks would use the grace window that already exists; it is left out for now because it changes
the screen.

Leftover secrets are cleaned up automatically: a secret is deleted as soon as nothing uses it, and a weekly sweep catches anything
left behind (`secret_events` records each run).
