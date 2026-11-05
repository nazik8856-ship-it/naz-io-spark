# Data classification

General data security, task 1. Every text, JSON, array, binary or vector column of every table in the public schema has exactly
one class. The class decides how the data is stored, who may read it, where it may be sent, how it may appear in a model prompt
and what of it may reach a log. Columns of other types (ids, numbers, times, flags) carry no content and have no class.

Built on the earlier layers: secrets handling (vault, `secrets_exposure_report()`, column grants), data encryption
(`encrypted_columns`, `encryption_exempt_columns`, the locks), user and data isolation (`isolation_tables`) and safe input and
output handling (the untrusted-data fence).

## The classes

| Class | What it covers | Stored | Browser may read | May leave NazAI | In a model prompt | In a log |
|---|---|---|---|---|---|---|
| `SECRET` | provider tokens, API key hashes, webhook and callback signing secrets, OAuth state and code verifiers, unsubscribe tokens | the credential only in the vault; a column holds a vault reference, a one-way hash or a short-lived single-use value | never | only as the auth header of the service it belongs to | never | never |
| `RULE` | safety, hard, project, meaning and response rules, action policies, policy versions | readable to the database (the gate matches against it), isolated per account | own account | the rule's plain instruction, to the account's own tools, as part of a request; patterns and policy data never | as instructions to NazAI's own models | names and ids |
| `PROJECT_CONTENT` | prompts, objectives, sites and pages, projects, agents, missions, results and controlled outputs | isolated per account; encrypted or exempt with a reason (open gaps: `classification_gaps()`) | own account | to the account's own tools, after the account's rules mask it | as task input | ids, sizes, hashes |
| `EXTERNAL_RESPONSE` | replies of connected tools and MCP servers, synced data, research pages, messages from a customer's own users | as above, secrets scrubbed before it is stored | own account | only as the controlled result | fenced as untrusted data, never as instructions | ids, sizes, hashes |
| `PERSONAL` | email addresses, names, IP addresses, what a site visitor submits | as above | own account | only to the action that needs it (the recipient of an email) | only when the task needs it | never |
| `OPERATIONAL` | statuses, kinds, names of actions and providers, ids, fingerprints, signatures, scrubbed error text, metrics, NazAI's bookkeeping | readable; error text scrubbed by the redact triggers | own account | no | NazAI diagnostics only | scrubbed text |

## Where the classification lives

- **Code:** `supabase/functions/_shared/data-classes.ts`: `DATA_CLASSIFICATION` (454 columns), `CLASS_POLICY` (the table above, in a
  form the code reads: the outbound guard of task 2 uses it), `classOf(table, column)`.
- **Database:** `data_classification (table_name, column_name, class)`, server only, seeded by
  `20261108010000_data_classification.sql`. `classifiable_columns()` lists the columns that need a class.

## Checks

- **Build** (`src/test/data-classification.test.ts`): the code register and the database seed list the same columns with the same
  class; every encrypted column has a content class (`PROJECT_CONTENT`, `EXTERNAL_RESPONSE` or `PERSONAL`); every exempt column has
  a class; every text, JSON, array or binary column a migration adds from this one on has a class.
- **Database:** `select * from classification_report();` lists every problem:
  - `unclassified`: a column that needs a class has none;
  - `stale`: a class for a column that no longer exists;
  - `secret_readable`: a `SECRET` column that a browser session (`anon` or `authenticated`) could read: the role may select the
    column and row-level security is off or a policy lets rows through;
  - `secret_exposed`: anything `secrets_exposure_report()` finds (a credential stored outside the vault);
  - `class_conflict`: an encrypted column classified as something other than content.
- **Every Monday (03:47 UTC):** `data_classification_weekly_check()` opens the platform incident `data_classification` while the
  report has anything, and closes it once the report is empty.
- **Work list, not a failure:** `select * from classification_gaps();` lists the content columns that are neither encrypted nor
  exempt with a reason. Task 3 (protected data at rest) works through it.

On 2026-11-05 the live schema had 450 classifiable columns and the register lists exactly those 450 (plus the 4 of
`data_classification` itself); no `SECRET` column is readable from a browser.

The short-lived OAuth sign-in tables (`*_oauth_transactions`: state, code verifier) were never readable from a browser (no policy
let a row through), but the browser roles still held table rights; this migration removes them. Only the server reads and writes
those rows.

## Adding a column

1. Add it to `DATA_CLASSIFICATION` with its class.
2. In the same migration that adds it, add the row:
   `INSERT INTO public.data_classification (table_name, column_name, class) VALUES ('<table>', '<column>', '<CLASS>')`
   followed by `ON CONFLICT (table_name, column_name) DO UPDATE SET class = EXCLUDED.class;`.
3. A content column on a table that holds encrypted content also needs encrypting or an exemption (`docs/data-encryption.md`).

Removing a column: delete it from `DATA_CLASSIFICATION` and add
`DELETE FROM public.data_classification WHERE table_name = '<table>' AND column_name = '<column>';` to the migration.
