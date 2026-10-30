#!/usr/bin/env bash
# Runs the secrets-handling database tests against a throwaway Postgres (16+) database:
#   PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/secrets/run.sh
# Each run uses a new database built from baseline.sql (a Supabase-like copy of the live tables, grants and row level security),
# applies the secrets migrations in order and runs every *_test.sql. Exits non-zero on the first failing check.
set -euo pipefail
cd "$(dirname "$0")"
db="secrets_test_$(date +%s)_$$"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE $db"
trap 'psql -q -d postgres -c "DROP DATABASE IF EXISTS $db" >/dev/null 2>&1 || true' EXIT
run() { psql -q -v ON_ERROR_STOP=1 -d "$db" "$@"; }
run -f baseline.sql
run -f ../../migrations/20261030010000_secret_column_grants.sql
run -f column_grants_test.sql
run -f vault_signing_secrets_test.sql
run -f drop_credentials_column_test.sql
run -f redact_stored_errors_test.sql
run -f secret_lifecycle_test.sql
run -f api_key_revocation_test.sql
run -f https_addresses_test.sql
run -f encryption_report_test.sql
run -f encrypt_outer_control_test.sql
run -f encrypt_front4_test.sql
run -f encrypt_front5_test.sql
run -f isolation_register_test.sql
echo "secrets database tests: all passed"
