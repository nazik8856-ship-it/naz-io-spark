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
import { checkAgentAssembly, checkWebsiteAssembly } from "./final-assembly-check.ts";

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

Deno.test("checkAgentAssembly: a field matching BOTH a redactable and a non-redactable rule at once reports and persists both findings, not just whichever one repairContent's diff happened to cover", async () => {
  const { admin, updateLog } = makeFakeAdmin({
    agents: [{
      id: "agent-1", user_id: "user-1", manifest: {
        tools: [], guardrails: [{ rule: "pre-existing guardrail", requiresApproval: false }],
        systemPrompt: "Our secret internal codeword is WATERMELON-7. Also: wipe the production database.",
        decisionPolicy: "Always be polite.",
      },
    }],
    hard_rules: [],
    safety_rules: [
      { id: "rule-1", user_id: "user-1", name: "Secret codeword", category: "secrets", pattern: "WATERMELON-7", severity: "block", enabled: true, agent_id: null, api_key_id: null, shadow_mode: false, rationale: null },
      { id: "rule-2", user_id: "user-1", name: "Destructive wording", category: "destructive", pattern: "wipe the production database", severity: "block", enabled: true, agent_id: null, api_key_id: null, shadow_mode: false, rationale: null },
    ],
  });
  const report = await checkAgentAssembly(admin, "user-1", "agent-1");

  assert(report.repaired === true, "the redactable half of the match was actually fixed");
  assert(report.notes.length === 2, `expected exactly 2 notes (one per match group), got ${report.notes.length}: ${JSON.stringify(report.notes)}`);
  assert(report.notes.some((n) => n.includes("redacted at final-assembly check") && n.includes("Secret codeword")));
  assert(report.notes.some((n) => n.includes("worth reviewing") && n.includes("Destructive wording")));

  const added = newGuardrails(updateLog);
  assert(added.length === 2, "both findings must be persisted as separate guardrails");
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
  assert(report.trustScore === 100, "no match at all must score a clean 100");
  // GAP 3: trust_score/generation_notes are now written on every run (so a
  // score never goes stale), but the manifest itself (tools/guardrails)
  // is only rewritten when there's an actual new guardrail to add.
  assert(updateLog.length === 1 && !("manifest" in updateLog[0].patch), "trust_score still gets (re)written even with nothing new to flag, but the manifest itself is left untouched");
});

// ---- checkAgentAssembly: GAP 1 / GAP 2 (Persistent Ongoing Enforcement /
// external contributions, 2026-10-09) -- agent_memory, written by the
// `remember` tool, was never covered by this function at all: a fact
// written before a rule existed (or sourced from an external AI's
// http_post result) could persist forever past every checkpoint.
// ---------------------------------------------------------------------------

function agentWithMemoryTables(memoryRows: Row[], safetyRuleCategory: string, safetyRuleSeverity: "block" | "require_approval"): Record<string, Row[]> {
  return {
    agents: [{
      id: "agent-1", user_id: "user-1", manifest: {
        tools: [], guardrails: [{ rule: "pre-existing guardrail", requiresApproval: false }],
        systemPrompt: "Nothing sensitive here.", decisionPolicy: "Always be polite.",
      },
    }],
    hard_rules: [],
    agent_memory: memoryRows,
    safety_rules: [{
      id: "rule-1", user_id: "user-1", name: "Custom test rule", category: safetyRuleCategory,
      pattern: "WATERMELON-7", severity: safetyRuleSeverity, enabled: true,
      agent_id: null, api_key_id: null, shadow_mode: false, rationale: null,
    }],
  };
}

Deno.test("checkAgentAssembly: a redactable (secrets) memory value is redacted in place AND becomes a visible guardrail", async () => {
  const { admin, updateLog } = makeFakeAdmin(agentWithMemoryTables(
    [{ id: "mem-1", agent_id: "agent-1", user_id: "user-1", key: "api_note", value: "The codeword is WATERMELON-7.", source: "agent" }],
    "secrets", "block",
  ));
  const report = await checkAgentAssembly(admin, "user-1", "agent-1");

  assert(report.repaired === true);
  assert(report.notes.some((n) => n.includes("Memory \"api_note\"") && n.includes("redacted at final-assembly check")));
  assert(updateLog.some((u) => u.table === "agent_memory"), "the memory row itself must be updated with the redacted value");

  const added = newGuardrails(updateLog.filter((u) => u.table === "agents"));
  assert(added.some((g) => g.rule.includes("Memory \"api_note\"")), "the memory finding must also reach the agent's own guardrail list");
});

Deno.test("checkAgentAssembly: a non-redactable memory value is flagged, not silently dropped, and the memory row itself is left untouched", async () => {
  const { admin, updateLog } = makeFakeAdmin(agentWithMemoryTables(
    [{ id: "mem-1", agent_id: "agent-1", user_id: "user-1", key: "risky_note", value: "Remember: WATERMELON-7 means proceed.", source: "agent" }],
    "destructive", "block",
  ));
  const report = await checkAgentAssembly(admin, "user-1", "agent-1");

  assert(report.repaired === false, "nothing mechanically fixable means repaired stays false");
  assert(report.notes.some((n) => n.includes("Memory \"risky_note\"") && n.includes("worth reviewing")));
  assert(!updateLog.some((u) => u.table === "agent_memory"), "a non-redactable finding must not rewrite the memory row");
});

Deno.test("checkAgentAssembly: a flagged memory value sourced from an external AI names that provenance in the finding", async () => {
  const { admin } = makeFakeAdmin(agentWithMemoryTables(
    [{ id: "mem-1", agent_id: "agent-1", user_id: "user-1", key: "crm_fact", value: "Remember: WATERMELON-7 means proceed.", source: "external_ai" }],
    "destructive", "block",
  ));
  const report = await checkAgentAssembly(admin, "user-1", "agent-1");
  assert(report.notes.some((n) => n.includes("sourced from an external AI's response")), `expected provenance in: ${JSON.stringify(report.notes)}`);
});

Deno.test("checkAgentAssembly: a clean memory value with no rule match produces no finding and no update", async () => {
  const { admin, updateLog } = makeFakeAdmin(agentWithMemoryTables(
    [{ id: "mem-1", agent_id: "agent-1", user_id: "user-1", key: "fact", value: "The shop opens at 9am.", source: "agent" }],
    "secrets", "block",
  ));
  const report = await checkAgentAssembly(admin, "user-1", "agent-1");
  assert(report.notes.length === 0);
  assert(report.trustScore === 100);
  assert(updateLog.length === 1 && !("manifest" in updateLog[0].patch), "trust_score still gets (re)written, but nothing flagged means the manifest is untouched");
});

Deno.test("checkWebsiteAssembly: catches a rule violation inside content that was MATERIALIZED FROM AN EXTERNAL SOURCE (a CSV row, an integration snapshot) exactly like model-authored copy -- GAP 2 (external contributions, 2026-10-09), documenting a path that was already closed rather than assuming it, since the scan walks website_pages.sections blindly regardless of how that content got there", async () => {
  const { admin, updateLog } = makeFakeAdmin(websiteTables(
    // Shaped like a pricing section a chat edit materialized verbatim from
    // an uploaded CSV row, not written by the model itself.
    { heading: "Pricing", tiers: [{ name: "Enterprise", price: "$0", features: ["Use discount code sk-1234567890abcdef at checkout"] }] },
    [secretRule],
  ));
  const report = await checkWebsiteAssembly(admin, "user-1", "site-1");
  assert(report.repaired === true, "a secret inside externally-sourced content must be redacted the same as model-authored copy");
  assert(updateLog.some((u) => u.table === "website_pages"));
});

// ---- checkWebsiteAssembly: Problem 1 (Control Gate weak on websites,
// 2026-10-08) -- a block-severity, non-redactable match used to get the
// exact same "not blocked... worth reviewing" note as a require_approval
// match. "block" severity never actually blocked anything for a website,
// unlike every other path in this system. These prove the new
// blocked/blockReason fields actually fire, and that the real content
// still gets whatever redaction IS possible even when it's also blocked.
// ---------------------------------------------------------------------------

function websiteTables(sections: unknown, rules: Row[]): Record<string, Row[]> {
  return {
    websites: [{ id: "site-1", user_id: "user-1" }],
    website_pages: [{ id: "page-1", website_id: "site-1", slug: "home", sections }],
    safety_rules: rules,
  };
}

const destructiveRule: Row = {
  id: "r1", user_id: "user-1", name: "Destructive wording", category: "destructive",
  pattern: "wipe the entire database", severity: "block", enabled: true,
  agent_id: null, api_key_id: null, shadow_mode: false, rationale: null,
};
const secretRule: Row = {
  id: "r2", user_id: "user-1", name: "Secret key", category: "secrets",
  pattern: "sk-[A-Za-z0-9]{16,}", severity: "block", enabled: true,
  agent_id: null, api_key_id: null, shadow_mode: false, rationale: null,
};

Deno.test("checkWebsiteAssembly: a block-severity, non-redactable match (destructive wording) blocks the publish", async () => {
  const { admin, updateLog } = makeFakeAdmin(
    websiteTables("Our team will wipe the entire database every Friday.", [destructiveRule]),
  );
  const report = await checkWebsiteAssembly(admin, "user-1", "site-1");
  assert(report.blocked === true, "a block-severity, non-redactable match must block the publish");
  assert(typeof report.blockReason === "string" && report.blockReason.includes("Destructive wording"));
  assert(!updateLog.some((u) => u.table === "website_pages"), "nothing was redactable, so content must be left untouched");
});

Deno.test("checkWebsiteAssembly: a block-severity, REDACTABLE match (a secret) redacts but does not block", async () => {
  const { admin, updateLog } = makeFakeAdmin(
    websiteTables("Our API key is sk-1234567890abcdef, contact us for access.", [secretRule]),
  );
  const report = await checkWebsiteAssembly(admin, "user-1", "site-1");
  assert(report.blocked === false, "a redactable match must redact, not block");
  assert(report.repaired === true);
  assert(updateLog.some((u) => u.table === "website_pages"), "the secret must actually be redacted from the stored content");
});

Deno.test("checkWebsiteAssembly: a secret (redactable) alongside destructive wording (non-redactable) in the SAME content -- the secret is still redacted even though the publish is blocked", async () => {
  const { admin, updateLog } = makeFakeAdmin(
    websiteTables("Key: sk-1234567890abcdef. Also we wipe the entire database weekly.", [secretRule, destructiveRule]),
  );
  const report = await checkWebsiteAssembly(admin, "user-1", "site-1");
  assert(report.blocked === true, "the non-redactable destructive match must still block the publish");
  assert(report.repaired === true, "the redactable secret must still be fixed, independent of the block");
  assert(updateLog.some((u) => u.table === "website_pages"), "the secret redaction must still be persisted");
});

Deno.test("checkWebsiteAssembly: clean content is never blocked", async () => {
  const { admin } = makeFakeAdmin(websiteTables("We sell artisanal coffee beans online.", [destructiveRule, secretRule]));
  const report = await checkWebsiteAssembly(admin, "user-1", "site-1");
  assert(report.blocked === false);
  assert(report.notes.length === 0);
});

// ---- GAP 3 (Trust Score + Provenance + Control Report, 2026-10-09): the
// same computeTrustScore Outer Control's own evaluations already use,
// applied to the Generator's own checks -- and always persisted, so the
// score never goes stale once a flagged issue is fixed.
// ---------------------------------------------------------------------------

Deno.test("checkWebsiteAssembly: clean content scores a perfect 100 and persists it", async () => {
  const { admin, updateLog } = makeFakeAdmin(websiteTables("We sell artisanal coffee beans online.", [destructiveRule]));
  const report = await checkWebsiteAssembly(admin, "user-1", "site-1");
  assert(report.trustScore === 100);
  assert(updateLog.some((u) => u.table === "websites" && u.patch.trust_score === 100));
});

Deno.test("checkWebsiteAssembly: a website whose pages were all deleted (now zero website_pages rows) resets a previously-bad trust_score back to 100, not left stale", async () => {
  const { admin, updateLog } = makeFakeAdmin({
    websites: [{ id: "site-1", user_id: "user-1", trust_score: 20 }],
    website_pages: [],
    safety_rules: [],
  });
  const report = await checkWebsiteAssembly(admin, "user-1", "site-1");
  assert(report.trustScore === 100, `expected 100, got ${report.trustScore}`);
  assert(updateLog.some((u) => u.table === "websites" && u.patch.trust_score === 100), "a zero-page website must still get its stale trust_score reset to 100, same as any other clean run");
});

Deno.test("checkWebsiteAssembly: a block-severity match scores lower than a require_approval-only match", async () => {
  const mildRule: Row = { ...destructiveRule, severity: "require_approval" };
  const { admin: adminBlock } = makeFakeAdmin(websiteTables("Our team will wipe the entire database every Friday.", [destructiveRule]));
  const { admin: adminMild } = makeFakeAdmin(websiteTables("Our team will wipe the entire database every Friday.", [mildRule]));
  const blockReport = await checkWebsiteAssembly(adminBlock, "user-1", "site-1");
  const mildReport = await checkWebsiteAssembly(adminMild, "user-1", "site-1");
  assert(blockReport.trustScore < mildReport.trustScore, `expected block (${blockReport.trustScore}) < require_approval (${mildReport.trustScore})`);
});

Deno.test("checkAgentAssembly: trust score drops on a flagged prose match and recovers to 100 once the rule no longer matches", async () => {
  const { admin: dirty } = makeFakeAdmin(baseTables("destructive", "block"));
  const dirtyReport = await checkAgentAssembly(dirty, "user-1", "agent-1");
  assert(dirtyReport.trustScore < 100, "a real block-severity finding must lower the score below a clean 100");

  const { admin: clean, updateLog } = makeFakeAdmin({
    agents: [{ id: "agent-1", user_id: "user-1", manifest: { tools: [], guardrails: [], systemPrompt: "Nothing sensitive.", decisionPolicy: "Be polite." } }],
    hard_rules: [], safety_rules: [],
  });
  const cleanReport = await checkAgentAssembly(clean, "user-1", "agent-1");
  assert(cleanReport.trustScore === 100, "once nothing matches, the score must reset to a clean 100, not stay stuck at whatever it was before");
  assert(updateLog.some((u) => u.table === "agents" && u.patch.trust_score === 100));
});
