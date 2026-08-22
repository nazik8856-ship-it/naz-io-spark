// Real tests for the shared decision-scoring module -- previously
// untested despite backing both control-engine's model-scoring path and
// the strictness dial every gate layer scales by.
//
// Run with: deno test --allow-none supabase/functions/_shared/decision-scoring_test.ts
import {
  scoreFromLabel,
  labelFromScore,
  readConfidence,
  normalizeAlternatives,
  normalizeStrictness,
  thresholdForRisk,
  irreversibleNeedsHuman,
  fitDefers,
  resolveStrictness,
  loadStrictness,
  logDecision,
  STRICTNESS_PRESETS,
} from "./decision-scoring.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ---- scoreFromLabel / labelFromScore ---------------------------------------

Deno.test("scoreFromLabel: known labels map to their fixed scores", () => {
  assertEquals(scoreFromLabel("high"), 90);
  assertEquals(scoreFromLabel("medium"), 65);
  assertEquals(scoreFromLabel("low"), 35);
});

Deno.test("scoreFromLabel: an unknown label defaults to 50", () => {
  assertEquals(scoreFromLabel("unknown"), 50);
});

Deno.test("labelFromScore: boundaries are inclusive on the low end of each band", () => {
  assertEquals(labelFromScore(80), "high");
  assertEquals(labelFromScore(79), "medium");
  assertEquals(labelFromScore(50), "medium");
  assertEquals(labelFromScore(49), "low");
});

// ---- readConfidence ---------------------------------------------------------

Deno.test("readConfidence: a numeric confidence_score is used directly, clamped to 0-100", () => {
  assertEquals(readConfidence({ confidence_score: 150 }), { score: 100, label: "high" });
  assertEquals(readConfidence({ confidence_score: -10 }), { score: 0, label: "low" });
});

Deno.test("readConfidence: a numeric string confidence_score is parsed", () => {
  assertEquals(readConfidence({ confidence_score: "72" }), { score: 72, label: "medium" });
});

Deno.test("readConfidence: an explicit label wins over the score-derived label", () => {
  assertEquals(readConfidence({ confidence_score: 10, confidence: "high" }), { score: 10, label: "high" });
});

Deno.test("readConfidence: no usable score and no label at all defaults to a flat 50/medium", () => {
  assertEquals(readConfidence({}), { score: 50, label: "medium" });
});

Deno.test("readConfidence: no usable score but an explicit label derives the score from that label", () => {
  assertEquals(readConfidence({ confidence: "low" }), { score: 35, label: "low" });
});

Deno.test("readConfidence: a garbage confidence_score string is ignored, not NaN -- falls back to the flat 50 default (no label to derive a score from)", () => {
  assertEquals(readConfidence({ confidence_score: "not-a-number" }), { score: 50, label: "medium" });
});

// ---- normalizeAlternatives --------------------------------------------------

Deno.test("normalizeAlternatives: an array is truncated per-item and capped at 8 entries", () => {
  const many = Array.from({ length: 12 }, (_, i) => `alt-${i}`);
  const result = normalizeAlternatives(many);
  assertEquals(result.length, 8);
  assertEquals(result[0], "alt-0");
});

Deno.test("normalizeAlternatives: a single string becomes a one-item array", () => {
  assertEquals(normalizeAlternatives("just one"), ["just one"]);
});

Deno.test("normalizeAlternatives: an empty/blank string or anything else is an empty array", () => {
  assertEquals(normalizeAlternatives(""), []);
  assertEquals(normalizeAlternatives("   "), []);
  assertEquals(normalizeAlternatives(null), []);
  assertEquals(normalizeAlternatives(42), []);
});

// ---- normalizeStrictness / thresholdForRisk / irreversibleNeedsHuman / fitDefers ---

Deno.test("normalizeStrictness: only 'loose'/'strict' are recognized, everything else is 'balanced'", () => {
  assertEquals(normalizeStrictness("loose"), "loose");
  assertEquals(normalizeStrictness("strict"), "strict");
  assertEquals(normalizeStrictness("balanced"), "balanced");
  assertEquals(normalizeStrictness("garbage"), "balanced");
  assertEquals(normalizeStrictness(undefined), "balanced");
});

Deno.test("thresholdForRisk: strict raises the bar more than loose for the same risk tier", () => {
  const loose = thresholdForRisk("high", 60, "loose");
  const strict = thresholdForRisk("high", 60, "strict");
  assert(strict > loose);
});

Deno.test("thresholdForRisk: clamps to [0, 100]", () => {
  assertEquals(thresholdForRisk("high", 200, "strict"), 100);
  assertEquals(thresholdForRisk("low", -200, "loose"), 0);
});

Deno.test("thresholdForRisk: an unrecognized risk tier is treated as low", () => {
  assertEquals(thresholdForRisk("something-else", 60, "balanced"), thresholdForRisk("low", 60, "balanced"));
});

Deno.test("irreversibleNeedsHuman: matches each preset's configured tiers exactly", () => {
  for (const [strictness, preset] of Object.entries(STRICTNESS_PRESETS)) {
    for (const tier of ["low", "medium", "high"] as const) {
      assertEquals(
        irreversibleNeedsHuman(tier, strictness as "loose" | "balanced" | "strict"),
        preset.irreversibleNeedsHuman.includes(tier),
      );
    }
  }
});

Deno.test("fitDefers: 'not_a_fit' always defers regardless of strictness", () => {
  assert(fitDefers("not_a_fit", "loose"));
  assert(fitDefers("not_a_fit", "strict"));
});

Deno.test("fitDefers: 'unclear' only defers under strict (deferOnUnclearFit)", () => {
  assert(!fitDefers("unclear", "loose"));
  assert(!fitDefers("unclear", "balanced"));
  assert(fitDefers("unclear", "strict"));
});

Deno.test("fitDefers: a clear fit never defers", () => {
  assert(!fitDefers("good_fit", "strict"));
});

// ---- resolveStrictness (per-agent override precedence, Wave 5 session 1) ---

Deno.test("resolveStrictness: an agent override wins over the account default", () => {
  assertEquals(resolveStrictness({ strictness: "strict" }, { control_strictness: "loose" }), "strict");
});

Deno.test("resolveStrictness: no override falls back to the account default", () => {
  assertEquals(resolveStrictness(null, { control_strictness: "strict" }), "strict");
  assertEquals(resolveStrictness(undefined, { control_strictness: "loose" }), "loose");
});

Deno.test("resolveStrictness: an override row with no strictness value falls back too", () => {
  assertEquals(resolveStrictness({ strictness: null }, { control_strictness: "strict" }), "strict");
});

Deno.test("resolveStrictness: neither present defaults to balanced", () => {
  assertEquals(resolveStrictness(null, null), "balanced");
});

// ---- loadStrictness (DB-coupled, fake client) ------------------------------

type Row = { data?: unknown; error?: unknown };
class FakeQuery implements PromiseLike<Row> {
  constructor(private resolve: () => Row) {}
  select() { return this; }
  eq() { return this; }
  maybeSingle() { return this; }
  single() { return this; }
  insert(_row?: unknown) { return this; }
  // deno-lint-ignore no-explicit-any
  then<T1 = Row, T2 = never>(onf?: ((v: Row) => T1 | PromiseLike<T1>) | null, onr?: ((r: unknown) => T2 | PromiseLike<T2>) | null): any {
    return Promise.resolve(this.resolve()).then(onf ?? undefined, onr ?? undefined);
  }
}
function fakeSupabase(tables: Record<string, Row>) {
  const calls: { table: string }[] = [];
  const inserts: Record<string, unknown[]> = {};
  return {
    from: (table: string) => {
      calls.push({ table });
      const q = new FakeQuery(() => tables[table] ?? { data: null, error: null });
      // deno-lint-ignore no-explicit-any
      (q as any).insert = (row?: unknown) => { (inserts[table] ??= []).push(row); return q; };
      return q;
    },
    calls,
    inserts,
    // deno-lint-ignore no-explicit-any
  } as any;
}

Deno.test("loadStrictness: with an agent override configured, it wins", async () => {
  const client = fakeSupabase({
    agent_strictness_overrides: { data: { strictness: "strict" }, error: null },
    profiles: { data: { control_strictness: "loose" }, error: null },
  });
  assertEquals(await loadStrictness(client, "user-1", "agent-1"), "strict");
});

Deno.test("loadStrictness: with no agentId given, only the account default is read", async () => {
  const client = fakeSupabase({
    profiles: { data: { control_strictness: "strict" }, error: null },
  });
  assertEquals(await loadStrictness(client, "user-1"), "strict");
});

Deno.test("loadStrictness: an agentId with no override row falls back to the account default", async () => {
  const client = fakeSupabase({
    agent_strictness_overrides: { data: null, error: null },
    profiles: { data: { control_strictness: "loose" }, error: null },
  });
  assertEquals(await loadStrictness(client, "user-1", "agent-1"), "loose");
});

Deno.test("logDecision: checks for a decision_logged webhook subscriber (SIEM export) after logging", async () => {
  // No webhooks table row configured -> triggerWebhooks sees zero hooks
  // and never calls fetch, keeping this a pure, network-free test while
  // still proving logDecision actually queries for one.
  const client = fakeSupabase({
    agent_decisions: { data: { id: "decision-1" }, error: null },
  });
  const decisionId = await logDecision(client, { userId: "user-1" }, {
    decision: "ALLOW send_email (Gmail)", reasoning: "fine", alternatives: [], score: 80,
  });
  assertEquals(decisionId, "decision-1");
  assert((client.calls as { table: string }[]).some((c) => c.table === "webhooks"), "expected logDecision to check for a decision_logged webhook subscriber");
});

Deno.test("logDecision: writes structured action_type/provider alongside the free-text decision (2026-08-23)", async () => {
  const client = fakeSupabase({
    agent_decisions: { data: { id: "decision-2" }, error: null },
  });
  await logDecision(client, { userId: "user-1" }, {
    decision: "ALLOW send_email (Gmail)", reasoning: "fine", alternatives: [], score: 80,
    actionType: "send_email", provider: "Gmail",
  });
  const logged = (client.inserts as Record<string, unknown[]>).agent_decisions?.[0] as { action_type?: string; provider?: string } | undefined;
  assertEquals(logged?.action_type, "send_email");
  assertEquals(logged?.provider, "Gmail");
});

Deno.test("logDecision: action_type/provider are null when not supplied, not undefined/omitted", async () => {
  const client = fakeSupabase({
    agent_decisions: { data: { id: "decision-3" }, error: null },
  });
  await logDecision(client, { userId: "user-1" }, {
    decision: "ALLOW something", reasoning: "fine", alternatives: [], score: 80,
  });
  const logged = (client.inserts as Record<string, unknown[]>).agent_decisions?.[0] as { action_type?: string | null; provider?: string | null } | undefined;
  assertEquals(logged?.action_type ?? null, null);
  assertEquals(logged?.provider ?? null, null);
});

Deno.test("loadStrictness: never throws, defaults to balanced on error", async () => {
  // deno-lint-ignore no-explicit-any
  const client = { from: () => { throw new Error("boom"); } } as any;
  assertEquals(await loadStrictness(client, "user-1", "agent-1"), "balanced");
});
