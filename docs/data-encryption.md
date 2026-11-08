# How NazAI encrypts stored user content

Three layers protect data:

1. **In transit:** every connection uses TLS (database connections, the website, edge functions, customer webhooks and tools;
   checked by `src/test/transport-encryption.test.ts`).
2. **Disk:** Supabase encrypts the database, its backups and file storage (AES-256). This covers everything.
3. **NazAI's own encryption:** the content that matters most is encrypted by the edge functions before it is stored, with a key
   only they have. A database dump, a backup or an over-broad query then shows ciphertext.

## The module

`supabase/functions/_shared/field-crypto.ts`, with the key `DATA_KEY` (rotation: `docs/secrets-rotation.md`).

- AES-256-GCM. Stored as `v2:<key id>:<iv>:<ciphertext>`, a fresh IV for every write.
- Every value is bound to `<table>.<column>:<row id>`: a value copied into another row or column does not decrypt.
- `sealFields` / `openFields` turn a row's columns into their encrypted form and back. A value that does not decrypt throws: a
  wrong or missing key never looks like an empty field.
- `fingerprint` is a keyed HMAC-SHA-256: equal texts give equal fingerprints (to notice a change or match a retry), but unlike a
  plain SHA-256 it can not be used to guess a short text. `fingerprintMatches` also accepts plain SHA-256 values stored before.
- Speed: encrypting and decrypting 100 KB takes about 1 ms (budget 2 ms, tested). Keys are imported once per function instance.

Imported projects use the same format with their own key (`PROJECTS_KEY`, `project-crypto.ts`).

## Encrypting a column

1. Add `<col>_enc text` next to `<col>` and list the column in `encrypted_columns` (with `plain_empty = 'empty_text'` if `<col>`
   can not be null).
2. Writers store `sealFields(...)`: the encrypted value in `<col>_enc`, `<col>` emptied. Generate the row id before an insert;
   it is part of what is authenticated.
3. Readers use `openFields(...)`: `<col>_enc` when it has a value, otherwise the plain `<col>` (rows not converted yet).
4. The sweep converts existing rows: `sweepColumn(admin, keys, table, col)`, 50 per run. It also moves values off a previous key
   during a rotation.
5. `select * from encryption_report();` shows the plain values left per column and how many values are on each key.
6. At 0: `select encryption_enforce('<table>', '<col>');` adds a check that `<col>` stays empty, so no code path can store the
   text in the clear again.

The report and the lock run only as the server (`service_role`).

## What is encrypted

| Table | Columns | Since |
| --- | --- | --- |
| `imported_projects` | `content` (with `PROJECTS_KEY`) | before front 2 |
| `outer_control_sessions` | objective, context, correction, history, next_input, final_output, pending_question, pending_answer, final_artifact; handoff (front 5) | front 3 |
| `outer_control_session_steps` | request, reply_text, note; decision (front 5) | front 3 |
| `outer_control_evaluations` | input_excerpt, output_text, summary, next_step, changes; execution_summary, matches, shadow_matches (front 5: the matched text a rule quotes) | front 3 |
| `outer_control_workflows` | objective, context, summary, final_output, final_artifact, goal_pool; done_criteria, criteria_state (front 5) | front 3 |
| `outer_control_memory` | summary, data | front 3 |
| `outer_control_completion_checks` | summary | front 3 |
| `website_form_submissions` | fields, submitter_ip (what visitors type into a generated site's forms, and their address) | front 4 |
| `integration_snapshots` | data (live data read from a connected account: Gmail, Slack, Shopify…) | front 4 |
| `agent_runs` | instruction, summary, outcome (what an agent run was asked and how it ended) | front 4 |
| `agent_events` | payload, reasoning (each step an agent took and why) | front 4 |
| `missions` | directive (what a Generator request asked for) | front 4 |
| `knowledge_base_entries` | entry_text | front 4 |
| `api_key_context_entries` | entry_text (the /respond API's context) | front 4 |
| `api_response_cache` | message, answer (cached /respond questions and answers); sources (front 5: the knowledge excerpts behind an answer) | front 4 |
| `api_response_generations` | message (logged /respond questions) | front 4 |
| `pending_approvals` | description, comment, execution_summary (what an approval asks, the approver's comment, what the action reported) | front 4 |

How these columns work (all but `imported_projects`):

- **Server:** every edge function that reaches these tables imports `createClient` from `_shared/encrypted-client.ts`.
  Its clients encrypt these columns on every write and decrypt them on every read (`_shared/encrypted-db.ts`), so the
  engine code is unchanged. Filtering or sorting by an encrypted column is refused with an error naming it (the database
  only holds ciphertext, so it would silently match nothing).
- **Website:** screens read these tables through the `outer-control-read` edge function (`src/lib/outer-control-read.ts`,
  used like `supabase.from(table)`). It runs the same query as the signed-in user, so row level security decides what comes
  back exactly as before, and returns the text decrypted. Queries that read no encrypted column (counts, ids, statuses)
  still go straight to the database.
- **Website writes:** the few screens that write these tables (an agent's run and clarification answer, a Generator request, a
  knowledge-base entry) send the same write to the `encrypted-write` edge function (`src/lib/encrypted-write.ts`, used like
  `supabase.from(table)`), which runs it as the signed-in user and encrypts the content first. An approver's sign-off with a
  comment goes through it too: the vote is recorded by `record_approval_signoff` as before, then the comment is stored encrypted.
  Writes that touch no encrypted column (a status, an on/off switch) still go straight to the database.
- **Live updates:** an insert event carries the row without its text; the live feed reads the text through
  `outer-control-read`.
- **Flags the database needs:** three small fields inside an agent event's payload stay readable in their own plain columns,
  filled on every write: `payload_ok` (did the action succeed, counted by `get_business_context`), `payload_ref` (which question an
  answer belongs to) and `payload_original_event_id` (which event an approval answers). They are flags and ids, not content.
- **Database functions that returned this text** have `_v2` versions that also return the row id and the encrypted value, which
  the server decrypts (`openRows`): `get_replayable_real_decisions_v2`, `search_response_cache_v2`, `search_response_context_v2`,
  `list_resolvable_gap_candidates_v2`. Similarity search is unchanged: embeddings are not encrypted.
- **Secret scrubbing:** an approval's `execution_summary` is scrubbed of secrets by the server before it is encrypted (what the
  database trigger did while it was stored in the clear).
- **Backups:** the daily governance backup copies rows exactly as stored, and each file is encrypted as a whole as well (see
  "Backups" below).
- **The /respond cache key** (`api_response_cache.message_hash`) is a keyed fingerprint (`DATA_KEY`). Entries saved before with a
  plain SHA-256 are simply not matched and expire on their own.
- **Existing rows** are converted by the session sweep every five minutes, a batch per column, using the report.
- **Safety net:** a write that puts plain text into one of these columns (a path that does not encrypt) clears the
  encrypted twin in a trigger, so the newer value is what is read, never an older encrypted one. The sweep encrypts it
  again.
- **What the database still checks:** the "completed" guards used to compare the final result's text with its artifact.
  For an encrypted result they check that the result, its artifact and (for a session) a passing checklist with the
  result's fingerprint are all present; the server builds and verifies the artifact before saving it.
  `outer_control_tool_usage` counts encrypted requests too.

Checks: `src/test/field-encryption.test.ts` (every function uses the encrypting client, the code and migration list the
same columns, no screen reads or writes an encrypted column directly), the engine tests run a second time with every client
going through the wrapper, `supabase/functions/_shared/encrypted-db_test.ts` and `encrypted-write_test.ts`, and
`supabase/tests/secrets/encrypt_outer_control_test.sql`, `encrypt_front4_test.sql` and `encrypt_front5_test.sql`.

## Backups

`governance-backup-export` (daily, 02:00 UTC) writes each table to `governance-backups/<date>/<table>.json.enc`, encrypted
with `DATA_KEY` before upload (AES-256-GCM, bound to that path: a file moved or renamed does not decrypt). The bucket is private,
with no policy for signed-in users or visitors; folders older than 30 days are deleted.

- **Leftovers:** every run also converts files from before: a plain `.json` is encrypted, the new file is downloaded and
  decrypted to check it holds exactly the same content, and only then is the plain file deleted (at most 60 per run). During a
  `DATA_KEY` rotation, files on the previous key are re-encrypted with the new one the same way.
- **Restore:** download the file keeping its dated folder, then
  `DATA_KEY=<key> deno run --allow-env --allow-read --allow-write scripts/decrypt-backup.ts 2026-10-30/hard_rules.json.enc out.json`.
- **Restore drill:** `POST governance-backup-export {"action": "verify", "date": "YYYY-MM-DD"}` (server key) decrypts that day's
  files and returns how many rows each holds, never their content; `ok` is false when a file is missing, plain or does not
  decrypt.

## Files

- `governance-backups`: private, encrypted files (above).
- `user-uploads` (private): files users attach to a prompt, a clarification answer, a mission or the brand canvas. Each sits
  under its owner's folder (`<user id>/…`); only the owner can upload, open, replace or delete it, nobody can list anyone else's,
  and it is shared as a signed link that expires (a day for prompt and canvas files, 7 days for missions and clarifications).
- `mission-assets` (public): generated website images (`website-images/<site>/…`; sites generated before 2026-11-05 are moved there from `website-images/<owner>/<site>/`, see `docs/data-isolation.md`), which published sites show to
  everyone. Only the server writes there. When a generated site places one of the user's attached images, the site generator
  copies just that file to `website-images/<site>/uploads/` and the page points at the copy: what the user puts in a
  site is public, nothing else they upload is (`supabase/functions/_shared/uploaded-assets.ts`).

## Every content column is encrypted or exempt

`encryption_exempt_columns` lists every other text or JSON column of a table that holds encrypted content, with the reason it
stays readable to the database: statuses and types, ids and fingerprints, names of actions and rules, rule data the gate reads,
error text (scrubbed of secrets before it is stored), and action parameters (the same data as `agent_decisions.params`, which the
signed decision trail verifies in the database; decisions and rules are not encrypted by NazAI for that reason).

- `select * from encryption_coverage_report();` lists any content column that is neither encrypted nor exempt.
- **On every change:** `src/test/field-encryption.test.ts` fails when a migration adds a text or JSON column to one of these tables
  without listing it in `ENCRYPTED_COLUMNS` (with its `_enc` twin) or exempting it with a reason.
- **Every Monday (03:43 UTC):** `encryption_weekly_check()` opens a platform incident (`encryption_check`) when a listed column
  still holds plain values, a content column is uncovered, a column in use is not locked, or a lock is missing, naming them; it closes
  the incident once all four are clear.

## Protected data at rest (general data security, task 3)

`20261109010000_protect_data_at_rest.sql` and the code beside it.

- **Twenty more columns encrypted**, the same way as everything above (`ENCRYPTED_COLUMNS`), and locked at once (every table was
  empty; the 19 cached generations had expired and were removed):
  - an agent's remembered facts (`agent_memory.value`) and the business profile it works from (`business_profiles`: one-liner,
    tone, audience, offers, channels, KPIs and the raw research);
  - the account's clients (`agent_clients`: name, company, tags, notes; the address stays readable to find the client again),
    reports (`agent_reports.body_markdown`) and learned insights (`org_insights.insight`);
  - what-if questions and answers (`scenario_simulations`), cached generations (`generation_cache.manifest`) and replies
    (`idempotency_keys.response`), webhook deliveries (`webhook_deliveries.payload`) and the handle that undoes an action in a
    connected tool (`action_reversals.undo_payload`).
- **What changed to make that work:** the screens read and write these through the server (`ocRead`, `ocWrite`); a fact, a cached
  generation or an insight is found and replaced by its row id (the value is bound to it), never by an upsert or a filter on the
  text (`agent-memory.ts`, `generation-cache.ts`, `measure-decision-outcomes`); `get_business_context()` returns the sealed values
  and `business-context.ts` opens them; every function that reaches these tables (also through the incident and webhook helpers)
  creates its client with the encrypting `createClient`. An encrypting client is never wrapped twice.
- **Every other content column has a recorded reason** in `encryption_exempt_columns`, marked:
  - `by_design`: it has to stay readable to the database, or there is nothing to protect. Names and titles shown in lists;
    addresses NazAI calls or looks up (website addresses, webhook and callback URLs, tool endpoints, email addresses matched
    against the suppression list or an invitation); the published website and the pages visitors are served; a site shared by
    link; embeddings; the signed decision trail (`agent_decisions`), which the database verifies, and the copy of it in
    `decision_outcomes.evidence`; `profiles.user_context` and the legacy `projects` content, which a check keeps empty.
  - `deferred`: it should be encrypted but something reads it in the database or straight from the browser first, and the reason
    says what has to change: `agents` goal, manifest, role and plan (about 29 screens), an API key's reply persona and fallback
    message (7 settings screens), `agent_integrations.metadata`, `content_gap_clusters.representative_message` (two search
    functions), `websites.prompt` and the `website_versions` snapshots (the restore and image functions). All eleven were encrypted by security
    task 1 (below); their exemptions were removed.
- **No column without one or the other:** `classification_report()` lists it as `content_unprotected`, so the weekly
  classification check opens an incident; the build fails on it too (`src/test/data-classification.test.ts`).
- **Retention:**
  - raw replies of a connected tool stored with a finished session's steps are removed after 30 days, every night at 02:37 UTC
    (`expire_raw_replies(30)`). What stays: the checked result (`outer_control_evaluations`), the step's verdict, status and
    error, and the fingerprints. Live data snapshots (`integration_snapshots`) go after 30 days too;
  - every hour (`purge_short_lived_rows()`, :23): OAuth sign-ins that were never finished, after an hour, and visitor addresses
    kept to count requests (`ip_rate_limit_windows`), after a day. Before this, those addresses were never deleted (421 rows back
    to 2026-09-02);
  - everything else as before: the account's own `retention_days` (`retention-sweep`).
- **Secrets** (`docs/data-classification.md`, "Secrets: where each may be stored"): the columns whose value lives in the vault are
  kept empty by a check, API key hashes must be hashes, and sign-in state lives an hour at most.

## What is deliberately not encrypted

- **What the browser keeps** is no longer content in `localStorage` (security task 2, `docs/data-in-transit.md` section 7): the
  preview cache is in memory, approved replies are in `sessionStorage` for one tab, and API key values typed into the checklist are
  never saved. What remains is listed with what it holds in `src/lib/browser-storage.ts`.
- **The `by_design` columns above**, each with its reason in `encryption_exempt_columns`. No column is `deferred` any more
  (`select * from encryption_exempt_columns where kind = 'deferred';` returns nothing once `20261113010000_data_at_rest.sql` ran).

## Locking a column

Once `encryption_report()` shows 0 plain values for a column, `encryption_enforce('<table>', '<col>')` makes the database refuse
any write that puts text in the clear there (a CHECK named `<table>_<col>_encrypted`): a write path that does not encrypt fails with
an error instead of being caught and encrypted by the sweep a few minutes later.

- **Locked (2026-11-07, `20261107010000_lock_encrypted_columns_and_site_image_paths.sql`):** the 38 listed columns that hold encrypted
  values. Before locking, every writer was checked: the edge functions write through the encrypting client (the build check), the
  website writes through `encrypted-write`, the one database function that touches such a column (`record_approval_signoff`, comment)
  is always called with a null comment, and the converter had found nothing to convert.
- **Locked (security task 1, `20261113010000_data_at_rest.sql`):** the 14 listed columns that held no values (no SQL function or
  trigger writes them; every other writer goes through the encrypting client or `encrypted-write`). Every listed column is locked or
  marked to lock itself (below); none is left open.
- **Locked (task 3, `20261109010000_protect_data_at_rest.sql`):** the twenty columns encrypted in that migration, at once (their
  tables were empty, and every writer goes through the encrypting client or `encrypted-write`).
- **Weekly (Mondays 03:43 UTC):** `encryption_weekly_check()` keeps the `encryption_check` incident open while any listed column holds
  encrypted values without a lock, or a recorded lock is missing from its table.

## Data at rest (security task 1)

`20261113010000_data_at_rest.sql` and the code beside it. Hard boundaries only: each item is enforced by the database or refused by
the code; none is a warning.

- **Every listed column locked.** The 14 columns that held no values are locked at once (`encryption_enforce`).
- **The 11 deferred columns encrypted** with `DATA_KEY` like every other listed column: an agent's goal, role, configuration
  (`manifest`) and plan (`source_plan`); an API key's reply persona and fallback message; `agent_integrations.metadata`;
  `content_gap_clusters.representative_message`; `websites.prompt`; the `website_versions` snapshots. What changed so nothing reads
  them in the clear:
  - the screens read them through `outer-control-read` (`ocRead`), copy a site through `encrypted-write` (`ocWrite`), and the MCP
    tools read agents through the same function with the signed-in user's token (`src/lib/mcp/server-read.ts`);
  - restoring a saved version runs in `encrypted-write` (`_shared/website-restore.ts`) as the signed-in user: the current site is
    saved as a "Before restore" version, the site's fields and brief are set from the snapshot, and the pages are replaced in one
    database call (`replace_website_pages`, all or nothing). `restore_website_version()` is dropped;
  - a reconnect finds its integration row by a plain copy of the one field it needs (`metadata_shop`, `metadata_workspace_id`,
    `metadata_team_id`, filled on every write by the encrypting client) instead of searching inside `metadata`;
  - the two content-gap search functions return the sealed text (`search_gap_clusters_v2`, `list_gap_clusters_ranked_v2`), opened
    in code; `get_business_context()` returns an agent's sealed goal and role;
  - the site-image functions no longer look inside the brief or the snapshots in SQL; the cleanup sweep reads saved versions
    through the encrypting client and keeps a folder any version names;
  - the configuration-change log (`config_changes`) no longer copies encrypted columns: the trigger leaves them out and the copies
    already there were removed. A rollback still works: the sealed `_enc` values are bound to the same row and are restored.
  - **Locked when converted:** these tables hold rows already, so the columns are marked `lock_when_converted`. Every five minutes the
    session sweep encrypts up to 50 plain values per column, then `encryption_lock_converted()` locks each marked column that has no
    plain value left. With today's row counts (22 API keys, 20 versions, 9 sites, 8 integrations, 1 agent) that is within about
    10 minutes of the migration. The weekly check names a converted column that is still not locked.
- **No credential inside an address.** An address NazAI stores or calls never carries a user name, a password or a credential-like
  query parameter (`token`, `key`, `api_key`, `secret`, `signature`, `sig`, `password`, …): `validateOutboundUrl` refuses it before
  anything is saved or sent, and the database refuses to store one (`url_carries_credentials()`: checks on
  `external_tools.endpoint_url`, `webhooks.url`, `api_keys.callback_url`, `business_profiles.source_url`). The key belongs in the
  tool's authentication field, kept in the vault.
- **Key rotation is tracked.** The session sweep records the id (never the value) of the current `DATA_KEY` and `PROJECTS_KEY`
  (`encryption_key_state`, via `encryption_note_keys`) and keeps moving values from the previous key to the current one.
  `select * from encryption_rotation_report();` lists every column with values still on another key and since when the key changed;
  the weekly check opens the `encryption_check` incident when a rotation has not finished within 14 days (`rotation_stalled`).

Limits: a value is in the clear in the memory of the function that uses it, and in the browser of the signed-in owner who reads it;
encryption at rest protects the stored copy, not those. Rows written by an old deployment before the migration ran are converted by
the sweep, not at once.

## Fingerprints

| Fingerprint | Kind | Why |
| --- | --- | --- |
| `imported_projects.content_sha256` | keyed (`DATA_KEY`) | Next to encrypted text. Older plain SHA-256 values are remade by the session sweep. |
| `outer_control_evaluations.content_hash` | keyed (`DATA_KEY`) | Matches a retried `external_id`. Older values stay plain SHA-256: the full text is not kept, so they can not be remade. They still match a retry. |
| `output_sha256` in a Task's result and completion check | plain SHA-256, by design | It is the published "Result fingerprint (SHA-256)" in a Task's report: the customer can check the result against it. It fingerprints text shown to that same customer. |
