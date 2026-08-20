#!/usr/bin/env bash
# Runs every backend deno test file (supabase/functions/**/*_test.ts).
#
# Normal (networked) use:
#   ./supabase/functions/run-tests.sh
#
# Network-restricted / offline sandbox use (no access to esm.sh or
# deno.land -- e.g. this repo's Claude Code sessions so far):
#   NAZAI_TEST_OFFLINE=1 ./supabase/functions/run-tests.sh
# This applies supabase/functions/_test-support/import-map.offline.json
# (stubs @supabase/supabase-js with a no-op) and skips any test file with
# a direct https://deno.land dependency that map can't cover (currently
# just canva_test.ts, which isn't otherwise affected by anything in this
# repo -- check `grep -l deno.land supabase/functions/**/*_test.ts` if
# that ever changes).
set -euo pipefail
cd "$(dirname "$0")/../.."  # repo root (this script lives in supabase/functions/)

DENO_BIN="${DENO_BIN:-deno}"
ARGS=(test --no-check --allow-env)
EXCLUDE=()

if [ "${NAZAI_TEST_OFFLINE:-}" = "1" ]; then
  ARGS+=(--import-map=supabase/functions/_test-support/import-map.offline.json)
  EXCLUDE+=("canva_test.ts")
fi

FILES=$(find supabase/functions -name "*_test.ts" | sort)
for excl in "${EXCLUDE[@]:-}"; do
  [ -n "$excl" ] && FILES=$(echo "$FILES" | grep -v "$excl" || true)
done

echo "Running $(echo "$FILES" | wc -l | tr -d ' ') test file(s)..."
"$DENO_BIN" "${ARGS[@]}" $FILES
