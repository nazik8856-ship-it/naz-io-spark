// Automated test runner for the 30-scenario control-system suite.
//
// POST /control-test-suite
//   {
//     "ids":        ["A01","B03"]        // optional subset
//     "categories": ["block"],            // optional filter
//     "dry_run":    true,                 // default true — never touches a provider
//     "concurrency": 4                    // default 4
//   }
//
// It sends each scenario to control-engine exactly as the Control System chat
// would, compares the returned verdict against the scenario's expected verdict,
// and returns a pass/fail report with every mismatch spelled out.
//
// Requires the caller's JWT — the run is scoped to that user's own rules,
// breakers, spend cap and business profile, so the report reflects THEIR
// control system, not a generic one.
import { CONTROL_SCENARIOS, type Scenario, type Verdict } from "../_shared/control-scenarios.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Result = {
  id: string;
  name: string;
  category: string;
  probes: string;
  expected: Verdict;
  also_acceptable: Verdict[];
  actual: Verdict | null;
  status: "pass" | "soft_pass" | "fail" | "error";
  gate_source: string | null;
  reason: string | null;
  confidence: number | null;
  decision_id: string | null;
  approval_id: string | null;
  safety_matched: boolean;
  duration_ms: number;
  http_status: number | null;
  error: string | null;
};

const VERDICTS = ["allow", "modify", "block", "deferred"];

async function runScenario(
  s: Scenario,
  engineUrl: string,
  authHeader: string,
  apikey: string,
  dryRun: boolean,
): Promise<Result> {
  const started = Date.now();
  const base = {
    id: s.id,
    name: s.name,
    category: s.category,
    probes: s.probes,
    expected: s.expected,
    also_acceptable: s.also_acceptable ?? [],
  };
  try {
    const resp = await fetch(engineUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader, apikey },
      body: JSON.stringify({
        action_type: s.action_type,
        provider: s.provider,
        description: s.description,
        params: s.params,
        dry_run: dryRun,
      }),
    });
    const text = await resp.text();
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(text); } catch { /* keep raw below */ }

    if (!resp.ok) {
      return {
        ...base, actual: null, status: "error", gate_source: null,
        reason: String(data.error ?? text).slice(0, 400), confidence: null,
        decision_id: null, approval_id: null, safety_matched: false,
        duration_ms: Date.now() - started, http_status: resp.status,
        error: `control-engine returned ${resp.status}`,
      };
    }

    const raw = String(data.decision ?? "").toLowerCase();
    const actual = (VERDICTS.includes(raw) ? raw : null) as Verdict | null;
    const accepted = new Set<Verdict>([s.expected, ...(s.also_acceptable ?? [])]);
    const status: Result["status"] = actual === null
      ? "error"
      : actual === s.expected
        ? "pass"
        : accepted.has(actual) ? "soft_pass" : "fail";

    return {
      ...base,
      actual,
      status,
      gate_source: (data.gate_source as string) ?? (data.source as string) ?? null,
      reason: typeof data.reason === "string" ? data.reason.slice(0, 400) : null,
      confidence: typeof data.confidence_score === "number" ? data.confidence_score : null,
      decision_id: (data.decision_id as string) ?? null,
      approval_id: (data.approval_id as string) ?? null,
      safety_matched: Boolean(data.safety_scan),
      duration_ms: Date.now() - started,
      http_status: resp.status,
      error: actual === null ? `Unrecognised verdict: ${JSON.stringify(data.decision ?? null)}` : null,
    };
  } catch (e) {
    return {
      ...base, actual: null, status: "error", gate_source: null, reason: null, confidence: null,
      decision_id: null, approval_id: null, safety_matched: false,
      duration_ms: Date.now() - started, http_status: null,
      error: e instanceof Error ? e.message : "unknown error",
    };
  }
}

function renderMarkdown(results: Result[], summary: Record<string, number>, dryRun: boolean): string {
  const icon = (s: string) => (s === "pass" ? "✅" : s === "soft_pass" ? "🟡" : s === "fail" ? "❌" : "⚠️");
  const lines: string[] = [];
  lines.push(`# Control System test report`);
  lines.push("");
  lines.push(`${summary.total} scenarios · **${summary.pass} passed**, ${summary.soft_pass} soft-passed, ` +
    `**${summary.fail} failed**, ${summary.error} errored · dry_run: ${dryRun}`);
  lines.push("");
  lines.push("| | ID | Scenario | Expected | Actual | Gate |");
  lines.push("|---|---|---|---|---|---|");
  for (const r of results) {
    lines.push(`| ${icon(r.status)} | ${r.id} | ${r.name} | ${r.expected} | ${r.actual ?? "—"} | ${r.gate_source ?? "model"} |`);
  }
  const bad = results.filter((r) => r.status === "fail" || r.status === "error");
  if (bad.length) {
    lines.push("", "## Mismatches", "");
    for (const r of bad) {
      lines.push(`### ${icon(r.status)} ${r.id} — ${r.name}`);
      lines.push(`- **Expected:** ${r.expected}${r.also_acceptable.length ? ` (or ${r.also_acceptable.join(", ")})` : ""}`);
      lines.push(`- **Actual:** ${r.actual ?? "no verdict"}`);
      lines.push(`- **Probes:** ${r.probes}`);
      if (r.reason) lines.push(`- **Engine said:** ${r.reason}`);
      if (r.error) lines.push(`- **Error:** ${r.error}`);
      lines.push("");
    }
  } else {
    lines.push("", "No mismatches — every scenario landed on an accepted verdict.", "");
  }
  return lines.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const engineUrl = `${supabaseUrl}/functions/v1/control-engine`;

  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dry_run === false ? false : true;
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.map(String) : [];
  const categories: string[] = Array.isArray(body?.categories) ? body.categories.map(String) : [];
  const concurrency = Math.max(1, Math.min(8, Number(body?.concurrency) || 4));

  let scenarios = CONTROL_SCENARIOS;
  if (ids.length) scenarios = scenarios.filter((s) => ids.includes(s.id));
  if (categories.length) scenarios = scenarios.filter((s) => categories.includes(s.category));
  if (!scenarios.length) return json({ error: "no scenarios matched the filter" }, 400);

  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const results: Result[] = new Array(scenarios.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= scenarios.length) return;
      results[i] = await runScenario(scenarios[i], engineUrl, authHeader, anonKey, dryRun);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, scenarios.length) }, worker));

  const count = (s: string) => results.filter((r) => r.status === s).length;
  const summary = {
    total: results.length,
    pass: count("pass"),
    soft_pass: count("soft_pass"),
    fail: count("fail"),
    error: count("error"),
  };
  const byCategory: Record<string, { total: number; pass: number; soft_pass: number; fail: number; error: number }> = {};
  for (const r of results) {
    const c = (byCategory[r.category] ??= { total: 0, pass: 0, soft_pass: 0, fail: 0, error: 0 });
    c.total++;
    c[r.status]++;
  }

  return json({
    ok: summary.fail === 0 && summary.error === 0,
    started_at: startedAt,
    duration_ms: Date.now() - t0,
    dry_run: dryRun,
    summary,
    pass_rate_pct: Math.round(((summary.pass + summary.soft_pass) / summary.total) * 1000) / 10,
    by_category: byCategory,
    mismatches: results.filter((r) => r.status === "fail" || r.status === "error"),
    results,
    report_markdown: renderMarkdown(results, summary, dryRun),
  });
});
