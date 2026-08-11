# Control System — 30-scenario test suite

Automated regression check for the control gate. It sends each scenario to
`control-engine` as a proposed action, compares the returned verdict against the
expected one, and reports every mismatch.

- **Scenarios:** `supabase/functions/_shared/control-scenarios.ts` (30: 8 allow, 7 modify, 9 block, 6 deferred)
- **Runner:** `supabase/functions/control-test-suite/index.ts`
- **Local CLI:** `scripts/run-control-tests.mjs`

## Running it

The run is scoped to the caller's own account, so it exercises *their* hard
rules, circuit breakers, spend cap, kill switch and business profile. It
defaults to `dry_run: true`, so no provider is ever touched.

### From the app / any authed client

```ts
const { data } = await supabase.functions.invoke("control-test-suite", {
  body: { dry_run: true },
});
console.log(data.summary, data.report_markdown);
```

### From the terminal

```bash
node scripts/run-control-tests.mjs --token "<user access token>"
node scripts/run-control-tests.mjs --token "$TOKEN" --category block
node scripts/run-control-tests.mjs --token "$TOKEN" --ids A01,B03 --json
```

Exit code is `1` when anything fails or errors, so it drops straight into CI.

## Request options

| Field | Default | Meaning |
|---|---|---|
| `dry_run` | `true` | `false` lets allowed actions really execute — only do this deliberately |
| `ids` | all | Subset of scenario IDs, e.g. `["A01","B03"]` |
| `categories` | all | `allow` / `modify` / `block` / `deferred` |
| `concurrency` | `4` | Parallel requests (1–8) |

## Result statuses

| Status | Meaning |
|---|---|
| ✅ `pass` | Verdict matched `expected` exactly |
| 🟡 `soft_pass` | Verdict was in `also_acceptable` — defensible, not the primary expectation |
| ❌ `fail` | Verdict was outside the accepted set — a real behaviour change |
| ⚠️ `error` | Non-2xx from `control-engine`, or an unrecognised verdict |

Deterministic scenarios (safety scanner, hard rules, kill switch, breakers) have
no `also_acceptable` — they must land exactly. Model-judged scenarios (fit and
intent checks) allow a second verdict so the report flags real regressions
rather than wording drift.

## Response shape

```jsonc
{
  "ok": false,
  "summary": { "total": 30, "pass": 26, "soft_pass": 2, "fail": 1, "error": 1 },
  "pass_rate_pct": 93.3,
  "by_category": { "block": { "total": 9, "pass": 9, ... } },
  "mismatches": [ /* only fails + errors, with expected vs actual and the engine's reason */ ],
  "results":    [ /* every scenario, incl. decision_id, approval_id, gate_source, timing */ ],
  "report_markdown": "# Control System test report\n..."
}
```

Each result carries the `decision_id` it produced, so any surprising verdict can
be opened in the immutable audit record at `/control-engine/decisions/:id`.

## Adding a scenario

Append to `CONTROL_SCENARIOS` with a fresh ID (`A`/`M`/`B`/`D` + number), the
proposed action exactly as the chat would send it, the expected verdict, and a
one-line `probes` note saying what the case is actually proving.
