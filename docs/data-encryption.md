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

## Fingerprints

| Fingerprint | Kind | Why |
| --- | --- | --- |
| `imported_projects.content_sha256` | keyed (`DATA_KEY`) | Next to encrypted text. Older plain SHA-256 values are remade by the session sweep. |
| `outer_control_evaluations.content_hash` | keyed (`DATA_KEY`) | Matches a retried `external_id`. Older values stay plain SHA-256: the full text is not kept, so they can not be remade. They still match a retry. |
| `output_sha256` in a Task's result and completion check | plain SHA-256, by design | It is the published "Result fingerprint (SHA-256)" in a Task's report: the customer can check the result against it. It fingerprints text shown to that same customer. |
