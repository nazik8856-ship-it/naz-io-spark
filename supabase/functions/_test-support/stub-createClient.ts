// No-op stand-in for @supabase/supabase-js, used only via an import-map in
// network-restricted environments (see run-tests.sh / README.md in this
// directory). Every test that needs real Supabase behavior builds its own
// fake client inline (see e.g. webhooks_test.ts) -- this stub exists
// purely so files that import `createClient`/`SupabaseClient` at module
// scope (for typing, or in a code path a given test never exercises)
// don't fail to even load when esm.sh isn't reachable.
export function createClient(..._args: unknown[]): unknown {
  return {};
}
export type SupabaseClient = unknown;
