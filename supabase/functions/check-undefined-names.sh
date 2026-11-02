#!/usr/bin/env bash
# A name a function uses but never defines or imports is a ReferenceError waiting for the one request that reaches it (the tests do
# not load the function files, and nothing else checks). This lists them and fails when there is one. `mcp` runs under a Node-style
# `process` global the linter does not know about.
set -euo pipefail
cd "$(dirname "$0")/../.."
DENO_BIN="${DENO_BIN:-deno}"
OUT="$(mktemp)"
"$DENO_BIN" lint --json supabase/functions > "$OUT" 2>/dev/null || true
"$DENO_BIN" eval '
const d = JSON.parse(Deno.readTextFileSync(Deno.args[0]));
const bad = (d.diagnostics ?? []).filter((x) => x.code === "no-undef" && !x.filename.includes("/functions/mcp/"));
for (const x of bad) console.log(`${x.filename.split("/functions/")[1]}:${x.range.start.line} ${x.message}`);
if (bad.length) { console.error(`${bad.length} undefined name(s)`); Deno.exit(1); }
console.log("no undefined names in the server functions");
' "$OUT"
