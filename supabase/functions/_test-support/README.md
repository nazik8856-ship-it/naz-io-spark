# Offline test support

This directory exists only for network-restricted environments that can't
reach `esm.sh` or `deno.land` (e.g. sandboxed CI, some agent sessions).

- `stub-createClient.ts` — a no-op stand-in for `@supabase/supabase-js`.
  Tests that need real Supabase-shaped behavior build their own fake
  client inline (see `webhooks_test.ts` for the pattern); this stub only
  exists so files that reference `createClient`/`SupabaseClient` at
  module scope don't fail to *load* when esm.sh isn't reachable.
- `import-map.offline.json` — maps the real `@supabase/supabase-js`
  import to the stub above.

Use via `../run-tests.sh` with `NAZAI_TEST_OFFLINE=1` — see that script's
header comment for details, including the one test file (`canva_test.ts`)
that still needs real network access to `deno.land` regardless, since
nothing here stubs that.

In a normal environment with real network access, none of this is
needed — just run `./run-tests.sh` with no env vars and every test uses
its real imports.
