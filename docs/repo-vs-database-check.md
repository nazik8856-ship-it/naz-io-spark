# Repo-versus-database check

"The repo says it is done" and "the live database is done" can drift apart. It has happened (the old `agent_integrations.credentials`
column was marked dropped but never was). This is the check that finds it, how to repeat it, and what the first run (2026-11-13) found.

## What is compared

The migration **version numbers** can not be compared one to one: the database's history starts on 2026-08-28 with bundled `batch_*`
migrations, and many later ones were recorded under the time they were applied. So the check compares **state** instead:

| Repo says | Database must have | How |
|---|---|---|
| `CREATE TABLE public.x` (and not dropped later) | the table | `to_regclass('public.x')` |
| `CREATE FUNCTION public.f` (and not dropped later) | the function | `pg_proc` |
| `DROP FUNCTION public.f` | no function left under that name and signature | `pg_proc`, then read the overloads |
| `ALTER TABLE … DROP COLUMN c` | no column | `information_schema.columns` |
| `cron.schedule('job', …)` | the job | `cron.job` (jobs scheduled through helper functions need a second look) |
| `supabase/config.toml` `verify_jwt` | the same setting on the deployed function | `list_edge_functions` against the file (both directions) |

Extract the names from `supabase/migrations/*.sql` (strip comments first), run the existence queries in one SQL statement, and read every
hit by hand: a name match alone can be a re-created function in the same migration.

## Result of the first run (2026-11-13)

| Finding | Meaning | Action |
|---|---|---|
| All 113 tables, all 140 functions, both dropped columns | match | none |
| 19 of 19 `cron.schedule` names present | match | none |
| 27 jobs in the database not found by name in the repo | false alarm: they are scheduled through helper patterns in the migrations (checked a sample) | none |
| `hostile-probe-daily` job has no migration | it exists in the database and is only described in `docs/safe-input-output.md` | put its schedule in a migration at the next one |
| 9 functions deployed with the JWT check off but not listed in `config.toml` | a CLI deploy from the repo would have switched the check on and broken the Figma OAuth callback and the sweeps | **fixed**: listed, with `src/test/function-jwt-config.test.ts` |
| Old overloads still present: `search_response_cache(uuid, vector, int)`, `search_response_context`, `get_recent_breaker_trips`, `resolve_api_key` | the migrations' `DROP FUNCTION IF EXISTS` named the argument type `vector`, which resolves differently from `extensions.vector`, so it matched nothing. All are callable by the server key only (no browser access) | drop them in the next migration, with their exact signatures |
| `20261029020001` is in the database, not in the repo | `meaning_rules_grants` was recorded as its own step; the repo holds it in `20261029020000_meaning_rules.sql` | none |
| `agent_integrations.credentials` (earlier) | marked dropped, was not | **fixed** on 2026-11-12 |

## Next runs

Run it before launch and after any session that applied migrations by hand. Anything it finds goes into the next migration or PR; a finding
that is about a setting (not data) gets a test, as the JWT settings now have.
