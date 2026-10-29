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
| `outer_control_sessions` | objective, context, correction, history, next_input, final_output, pending_question, pending_answer, final_artifact | front 3 |
| `outer_control_session_steps` | request, reply_text, note | front 3 |
| `outer_control_evaluations` | input_excerpt, output_text, summary, next_step, changes | front 3 |
| `outer_control_workflows` | objective, context, summary, final_output, final_artifact, goal_pool | front 3 |
| `outer_control_memory` | summary, data | front 3 |
| `outer_control_completion_checks` | summary | front 3 |
| `website_form_submissions` | fields, submitter_ip (what visitors type into a generated site's forms, and their address) | front 4 |
| `integration_snapshots` | data (live data read from a connected account: Gmail, Slack, Shopify…) | front 4 |
| `agent_runs` | instruction, summary, outcome (what an agent run was asked and how it ended) | front 4 |
| `agent_events` | payload, reasoning (each step an agent took and why) | front 4 |
| `missions` | directive (what a Generator request asked for) | front 4 |
| `knowledge_base_entries` | entry_text | front 4 |
| `api_key_context_entries` | entry_text (the /respond API's context) | front 4 |
| `api_response_cache` | message, answer (cached /respond questions and answers) | front 4 |
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
- **Backups:** the daily governance backup copies rows exactly as stored, so these columns stay encrypted in its files
  (restorable with `DATA_KEY`).
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
`supabase/tests/secrets/encrypt_outer_control_test.sql` and `encrypt_front4_test.sql`.

## What is deliberately not encrypted

- **Notes kept in the browser** (`localStorage`: the ground-truth notes, the command-center checklist, preview caches): they live
  only on the user's own device and never reach NazAI's database, so `DATA_KEY` has nothing to protect there; moving them to the
  server would change how the screens behave.
- **`profiles.user_context`**: unused by the code (every value is `{}`).
- **Embeddings** used for similarity search: they are numbers derived from the text, needed by the database to search.

## Locking a column

Once `encryption_report()` shows 0 plain values for a column, `encryption_enforce('<table>', '<col>')` makes the database refuse
any write that puts text in the clear there. It is not applied yet: with it, a write path that does not encrypt fails with an
error instead of being caught and encrypted by the sweep a few minutes later. Apply it per column once the report has stayed at
0 for a while.

## Fingerprints

| Fingerprint | Kind | Why |
| --- | --- | --- |
| `imported_projects.content_sha256` | keyed (`DATA_KEY`) | Next to encrypted text. Older plain SHA-256 values are remade by the session sweep. |
| `outer_control_evaluations.content_hash` | keyed (`DATA_KEY`) | Matches a retried `external_id`. Older values stay plain SHA-256: the full text is not kept, so they can not be remade. They still match a retry. |
| `output_sha256` in a Task's result and completion check | plain SHA-256, by design | It is the published "Result fingerprint (SHA-256)" in a Task's report: the customer can check the result against it. It fingerprints text shown to that same customer. |
