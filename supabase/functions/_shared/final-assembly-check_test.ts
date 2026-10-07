// AUDIT 5 (Trust Score + Provenance + Control Report, 2026-10-07): real
// tests for the completeness gap this audit found and fixed -- a prose
// safety-rule match found at final-assembly check was reported ONLY in
// this function's return value, which agent-runtime's one caller wrote to
// an agent_events row of a kind ("first_deploy_check") that nothing in
// the UI ever reads (confirmed by searching every agent_events consumer
// in src/). A redaction never became a guardrail (only a blocked TOOL
// did); a matched-but-non-redactable finding was dropped with no note at
// all. Both now land in manifest.guardrails -- the one channel for this
// agent that IS actually rendered (GeneratedAgentDashboard.tsx's
// guardrail_panel widget).
//
// Uses a minimal fake Supabase client (this module's only real dependency
// surface) rather than a live database -- enough to drive the exact two
// code paths these tests care about.
//
// Run with: deno test --allow-none supabase/functions/_shared/final-assembly-check_test.ts
import { checkAgentAssembly } from "./final-assembly-check.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}

type Row = Record<string, unknown>;

function makeFakeAdmin(tables: Record<string, Row[]>) {
  const updateLog: { table: string; patch: Record<string, unknown> }[] = [];
  function from(table: string) {
    const rows = tables[table] ?? [];
    const filters: Record<string, unknown> = {};
    // deno-lint-ignore no-explicit-any
    const builder: any = {
      select() { return builder; },
      eq(col: string, val: unknown) { filters[col] = val; return builder; },
      maybeSingle() {
        const match = rows.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
        return Promise.resolve({ data: match ?? null, error: null });
      },
      update(patch: Record<string, unknown>) {
        return {
          eq(_col: string, _val: unknown) {
            updateLog.push({ table, patch });
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
      then(resolve: (v: unknown) => void) {
        const matched = rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
        resolve({ data: matched, error: null });
      },
    };
    return builder;
  }
  return { admin: { from }, updateLog };
}

function baseTables(safetyRuleCategory: string, safetyRuleSeverity: "block" | "require_approval"): Record<string, Row[]> {
  return {
    agents: [{
      id: "agent-1", user_id: "user-1", manifest: {
        tools: [],
        guardrails: [{ rule: "pre-existing guardrail", requiresApproval: false }],
        systemPrompt: "Our secret internal codeword is WATERMELON-7.",
        decisionPolicy: "Always be polite.",
      },
    }],
    hard_rules: [],
    safety_rules: [{
      id: "rule-1", user_id: "user-1", name: "Custom test rule", category: safetyRuleCategory,
      pattern: "WATERMELON-7", severity: safetyRuleSeverity, enabled: true,
      agent_id: null, api_key_id: null, shadow_mode: false, rationale: null,
    }],
  };
}

function newGuardrails(updateLog: { table: string; patch: Record<string, unknown> }[]): { rule: string }[] {
  if (!updateLog.length) return [];
  const manifest = (updateLog[0].patch as { manifest?: { guardrails?: { rule: string }[] } }).manifest;
  const all = manifest?.guardrails ?? [];
  return all.filter((g) => g.rule !== "pre-existing guardrail");
}

Deno.test("checkAgentAssembly: a redactable (secrets) prose match is redacted AND becomes a visible guardrail", async () => {
  const { admin, updateLog } = makeFakeAdmin(baseTables("secrets", "block"));
  const report = await checkAgentAssembly(admin, "user-1", "agent-1");

  assert(report.repaired === true, "content was actually changed, repaired must be true");
  assert(report.notes.length === 1 && report.notes[0].includes("redacted at final-assembly check"));

  const added = newGuardrails(updateLog);
  assert(added.length === 1, "exactly one new guardrail must be persisted");
  assert(added[0].rule.includes("redacted at final-assembly check"));
});

Deno.test("checkAgentAssembly: a non-redactable (destructive) prose match is NOT silently dropped -- it becomes a visible guardrail even though nothing was repaired", async () => {
  const { admin, updateLog } = makeFakeAdmin(baseTables("destructive", "block"));
  const report = await checkAgentAssembly(admin, "user-1", "agent-1");

  assert(report.repaired === false, "nothing was mechanically fixable, repaired must stay false");
  assert(report.notes.length === 1 && report.notes[0].includes("worth reviewing"));

  const added = newGuardrails(updateLog);
  assert(added.length === 1, "the flagged-but-not-fixed finding must still be persisted as a guardrail -- this is exactly the bug AUDIT 5 found (it used to be dropped with NO note and NO guardrail at all)");
  assert(added[0].rule.includes("worth reviewing"));
});

Deno.test("checkAgentAssembly: no safety-rule match at all -> no new guardrail, no notes", async () => {
  const { admin, updateLog } = makeFakeAdmin({
    agents: [{
      id: "agent-1", user_id: "user-1", manifest: {
        tools: [], guardrails: [{ rule: "pre-existing guardrail", requiresApproval: false }],
        systemPrompt: "Nothing sensitive here.", decisionPolicy: "Always be polite.",
      },
    }],
    hard_rules: [],
    safety_rules: [],
  });
  const report = await checkAgentAssembly(admin, "user-1", "agent-1");
  assert(report.repaired === false);
  assert(report.notes.length === 0);
  assert(updateLog.length === 0, "nothing new to persist means no update call at all");
});
