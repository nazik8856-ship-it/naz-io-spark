// Run with: deno test --allow-env supabase/functions/_shared/outer-control-brain_test.ts
import {
  buildWorkingMemory, decisionRecord, factsFor, guardConsistency, hitsFromMatches, planNextAction, requestChangesFor,
  resolveRules, stricterVerdict, think, type MemoryRow, type RuleHit, type WorkingMemory,
} from "./outer-control-brain.ts";
import { decideExternalText } from "./outer-control-decision.ts";
import { BUILTIN_SAFETY_RULES, type SafetyRule } from "./safety-scanner.ts";
import type { NextActionInput } from "./outer-control-next-action.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }

const KEY = "sk-" + "a".repeat(24);
const custom = (o: Partial<SafetyRule>): SafetyRule => ({
  id: "c1", name: "Custom", category: "custom", pattern: "internal-only", severity: "block", enabled: true, builtin: false, ...o,
});
const hit = (o: Partial<RuleHit>): RuleHit => ({ id: "h", name: "H", effect: "block", origin: "safety", scope: "account", category: "custom", pattern: null, ...o });
const emptyWm = (): WorkingMemory => buildWorkingMemory([]);
const loop = (o: Partial<Omit<NextActionInput, "verdict">> = {}): Omit<NextActionInput, "verdict"> => ({
  toolStatus: "done", stepNo: 1, maxSteps: 5, retriesUsed: 0, maxRetries: 1, failuresUsed: 0, maxFailures: 3,
  elapsedMs: 1000, maxMs: 600_000, onExhausted: "handoff", ...o,
});
const foundationOf = (rules: SafetyRule[], content: string) => {
  const d = decideExternalText(rules, content);
  return { verdict: d.verdict, output: d.output, matches: d.matches, changes: d.changes, summary: d.summary };
};
const thinkOn = (rules: SafetyRule[], content: string, wm = emptyWm(), l = loop(), mods = 0, hash = "hash-1") =>
  think({ foundation: foundationOf(rules, content), content, contentHash: hash, rules, wm, loop: l, requestModsUsed: mods });

// ---- 3. rule priority and conflict resolution -------------------------------------------
Deno.test("resolver: no matches -> allow; the strictest effect wins and the others are listed as overridden", () => {
  assertEquals(resolveRules([]).verdict, "allow");
  const r = resolveRules([hit({ id: "a", name: "Redact cards", effect: "redact" }), hit({ id: "b", name: "No quotes", effect: "block" })]);
  assertEquals([r.verdict, r.winner?.name, r.overridden.map((o) => o.rule.name)], ["block", "No quotes", ["Redact cards"]]);
  assert(r.conflicts.length === 1 && r.conflicts[0].includes("strictest wins"), r.conflicts.join("|"));
});

Deno.test("resolver: approval outranks removal (matches the foundation: secret + refund wording -> escalate)", () => {
  const r = resolveRules([hit({ id: "a", effect: "redact" }), hit({ id: "b", effect: "approval" })]);
  assertEquals(r.verdict, "escalate");
});

Deno.test("resolver: equal effects are all applied; scope, then origin, then id decide which is named", () => {
  const r = resolveRules([
    hit({ id: "z", name: "Account rule", scope: "account" }), hit({ id: "y", name: "Key rule", scope: "key" }),
    hit({ id: "x", name: "Built-in", scope: "builtin", origin: "builtin" }),
  ]);
  assertEquals(r.winner?.name, "Key rule"); assertEquals(r.applied.length, 3); assertEquals(r.conflicts, []);
  const byOrigin = resolveRules([hit({ id: "b", name: "Safety", origin: "safety" }), hit({ id: "a", name: "Hard", origin: "hard" })]);
  assertEquals(byOrigin.winner?.name, "Hard");
  const byId = resolveRules([hit({ id: "b", name: "B" }), hit({ id: "a", name: "A" })]);
  assertEquals(byId.winner?.name, "A", "deterministic tie-break");
});

Deno.test("resolver: specificity never weakens an outcome (a key-scoped removal cannot beat an account-wide block)", () => {
  const r = resolveRules([hit({ id: "k", name: "Key remove", scope: "key", effect: "redact" }), hit({ id: "a", name: "Account block", scope: "account", effect: "block" })]);
  assertEquals([r.verdict, r.winner?.name], ["block", "Account block"]);
});

Deno.test("resolver: one rule matched twice (or live and pinned) counts once, and the live one is named", () => {
  const r = resolveRules([hit({ id: "a", origin: "pinned" }), hit({ id: "a", origin: "safety" }), hit({ id: "a", origin: "safety" })]);
  assertEquals([r.applied.length, r.winner?.origin], [1, "safety"]);
});

Deno.test("hitsFromMatches: scope comes from the rule, effect from severity and redactability", () => {
  const rules = [...BUILTIN_SAFETY_RULES, custom({ id: "k1", name: "Key only", api_key_id: "key-1" }), custom({ id: "acc", name: "Account", pattern: "falcon", redact: true })];
  const hits = hitsFromMatches(decideExternalText(rules, `x ${KEY} internal-only falcon`).matches, rules);
  const by = (n: string) => hits.find((h) => h.name === n)!;
  assertEquals([by("Key only").scope, by("Key only").effect], ["key", "block"]);
  assertEquals([by("Account").scope, by("Account").effect], ["account", "redact"]);
  assertEquals([by("API key or secret in payload").scope, by("API key or secret in payload").effect], ["builtin", "redact"]);
});

// ---- 2. working memory ---------------------------------------------------------------------
const row = (o: Partial<MemoryRow>): MemoryRow => ({ step_no: 1, kind: "rejection", rule_names: [], summary: "s", data: null, session_id: "s1", ...o });
const pin = (id: string, effect: "block" | "redact" = "block") => ({ id, name: `Rule ${id}`, category: "custom", pattern: `word${id}`, effect, scope: "account" as const });

Deno.test("working memory: counts what each rule did, pins rules once, remembers decided texts and approvals", () => {
  const wm = buildWorkingMemory([
    row({ kind: "rejection", rule_names: ["A"], data: { verdict: "block", attempt: 1, content_hash: "h1", rules: [pin("a")] } }),
    row({ kind: "rejection", rule_names: ["A"], step_no: 2, data: { verdict: "block", attempt: 1, content_hash: "h2", rules: [pin("a")] } }),
    row({ kind: "modification", rule_names: ["B"], step_no: 2, data: { verdict: "modify", attempt: 2, content_hash: "h3", rules: [pin("b", "redact")] } }),
    row({ kind: "rule", rule_names: ["C"], step_no: 3, data: { verdict: "escalate", attempt: 1, content_hash: "h4" } }),
    row({ kind: "human", step_no: 3, data: { human: "approved", about: { step: 3, attempt: 1 } } }),
  ]);
  assertEquals(wm.ruleOutcomes.A, { blocked: 2, modified: 0, escalated: 0, lastStep: 2 });
  assertEquals(wm.ruleOutcomes.B.modified, 1); assertEquals(wm.ruleOutcomes.C.escalated, 1);
  assertEquals(wm.pinned.map((p) => p.id), ["a", "b"]);
  assertEquals(wm.decided.h1.verdict, "block"); assertEquals(wm.decided.h3.verdict, "modify");
  assertEquals(wm.approvedHashes, ["h4"]);
  assertEquals(wm.attemptsAtStep[2], 2);
});

Deno.test("working memory: rows from before this existed (no data) still count what they can", () => {
  const wm = buildWorkingMemory([row({ kind: "rejection", rule_names: ["Old"] }), row({ kind: "plan" })]);
  assertEquals(wm.ruleOutcomes.Old.blocked, 1); assertEquals(wm.pinned, []);
});

// ---- 5. consistency guard -----------------------------------------------------------------
Deno.test("guard: a rule pinned earlier still applies after it was disabled, and is not double counted when it still fires", () => {
  const wm = buildWorkingMemory([row({ data: { verdict: "block", content_hash: "x", rules: [{ ...pin("1"), pattern: "internal-only" }] } })]);
  const g = guardConsistency({ content: "this is internal-only data", contentHash: "n", wm, reportedRuleIds: [] });
  assertEquals(g.pinnedHits.map((h) => [h.id, h.effect, h.origin]), [["1", "block", "pinned"]]);
  assert(g.findings[0].includes("still applies"), g.findings.join("|"));
  assertEquals(guardConsistency({ content: "this is internal-only data", contentHash: "n", wm, reportedRuleIds: ["1"] }).pinnedHits, []);
  assertEquals(guardConsistency({ content: "harmless", contentHash: "n", wm, reportedRuleIds: [] }).pinnedHits, []);
});

Deno.test("guard: the same text keeps the same decision; an escalation is not pinned by hash", () => {
  const wm = buildWorkingMemory([
    row({ data: { verdict: "block", content_hash: "hb" } }), row({ step_no: 2, data: { verdict: "modify", content_hash: "hm" } }),
    row({ step_no: 3, data: { verdict: "escalate", content_hash: "he" } }),
  ]);
  const g = (h: string) => guardConsistency({ content: "t", contentHash: h, wm, reportedRuleIds: [] }).floor;
  assertEquals([g("hb"), g("hm"), g("he"), g("new")], ["block", "modify", "allow", "allow"]);
});

// ---- 1. decision core -------------------------------------------------------------------------
Deno.test("core: with no history it agrees with the foundation on every verdict", () => {
  const rules = [...BUILTIN_SAFETY_RULES, custom({ id: "q", name: "Quote", pattern: "price", severity: "require_approval" })];
  for (const text of ["Hello there.", `Use ${KEY} to connect.`, "I will drop table customers.", "The price is 5.", `${KEY} and the price`]) {
    const d = thinkOn(rules, text);
    assertEquals(d.verdict, foundationOf(rules, text).verdict, text);
  }
});

Deno.test("core: it is never weaker than the foundation, and a stop from a hard rule is named", () => {
  const d = think({
    foundation: { verdict: "block", output: null, matches: [], changes: [], summary: "Blocked by the hard rule \"No outside tools\"." },
    content: "x", contentHash: "h", rules: [], wm: emptyWm(), loop: loop(), requestModsUsed: 0,
  });
  assertEquals([d.verdict, d.winner?.origin, d.winner?.effect], ["block", "hard", "block"]);
  assert(d.winner!.name.includes("No outside tools"), d.winner!.name);
});

Deno.test("core: a conflict is explained in the decision and recorded on the step", () => {
  const rules = [...BUILTIN_SAFETY_RULES, custom({ id: "q", name: "Quote", pattern: "price", severity: "require_approval" })];
  const d = thinkOn(rules, `The price and ${KEY}`);
  assertEquals(d.verdict, "escalate"); assertEquals(d.winner?.name, "Quote");
  assert(d.conflicts.length === 1 && d.why.includes("strictest wins"), d.why);
  const rec = decisionRecord(d);
  assertEquals([rec.verdict, rec.winner?.name, rec.overridden.length, typeof rec.why], ["escalate", "Quote", 1, "string"]);
});

Deno.test("core: a rule that fired earlier and was since disabled still blocks, even though the foundation says allow", () => {
  const first = thinkOn([custom({ pattern: "internal-only" })], "this is internal-only");
  assertEquals(first.verdict, "block");
  const wm = buildWorkingMemory([row({ data: factsFor(first, "h-first", 1) })]);
  const second = thinkOn([] as SafetyRule[], "now it says internal-only again", wm, loop(), 0, "h-second");
  assertEquals(second.foundationVerdict, "allow"); assertEquals(second.verdict, "block"); assertEquals(second.output, null);
  assert(second.why.includes("still applies"), second.why);
});

Deno.test("core: a pinned removal rule cleans text the (changed) rules would let through, on top of the foundation's own cleaning", () => {
  const redactRule = custom({ id: "r1", name: "Codename", pattern: "falcon", redact: true });
  const first = thinkOn([redactRule], "We shipped falcon today");
  assertEquals(first.verdict, "modify");
  const wm = buildWorkingMemory([row({ kind: "modification", data: factsFor(first, "h1", 1) })]);
  const second = thinkOn(BUILTIN_SAFETY_RULES, `Key ${KEY} and falcon again`, wm, loop(), 0, "h2");
  assertEquals(second.verdict, "modify");
  assert(!second.output!.includes("falcon") && !second.output!.includes(KEY), String(second.output));
  assertEquals(second.changes.length, 2);
});

Deno.test("core: the same text cleaned earlier is never released unchanged later", () => {
  const redactRule = custom({ id: "r1", name: "Codename", pattern: "falcon", redact: true });
  const first = thinkOn([redactRule], "We shipped falcon today");
  const facts = factsFor(first, "same", 1);
  const wm = buildWorkingMemory([row({ kind: "modification", data: { ...facts, rules: [] } })]); // nothing left to re-apply
  const second = thinkOn([] as SafetyRule[], "We shipped falcon today", wm, loop(), 0, "same");
  assertEquals([second.verdict, second.output], ["block", null]);
});

Deno.test("core: facts kept for memory pin block and removal rules, not approvals or hard rules", () => {
  const rules = [...BUILTIN_SAFETY_RULES, custom({ id: "q", name: "Quote", pattern: "price", severity: "require_approval" })];
  const d = thinkOn(rules, `price ${KEY}`);
  const f = factsFor(d, "h", 1);
  assertEquals([f.verdict, f.content_hash, f.attempt], ["escalate", "h", 1]);
  assertEquals(f.rules?.map((r) => r.effect), ["redact"], "the secret rule is pinned for removal; the approval rule is not");
  assertEquals(factsFor(thinkOn(rules, "fine"), "h", 1).rules, []);
});

// ---- 4. next-action planner ------------------------------------------------------------------
const base = (o: Partial<NextActionInput> = {}): NextActionInput => ({ ...loop(), verdict: "block", ...o });

Deno.test("planner: when retries run out on a rule violation the request is tightened once before a person is asked", () => {
  const wm = buildWorkingMemory([row({ rule_names: ["No quotes"] }), row({ rule_names: ["No quotes"], step_no: 1 })]);
  const p = planNextAction({ base: base({ retriesUsed: 1 }), requestModsUsed: 0, hits: [hit({ name: "No quotes" })], wm });
  assertEquals(p.kind, "modify_request");
  assert(p.request!.constraints.some((c) => c.includes("No quotes")) && p.request!.constraints.some((c) => c.includes("80 words")), JSON.stringify(p.request));
  assertEquals(p.request!.dropContext, true, "blocked twice already -> leave earlier context out");
  assert(p.basis.some((b) => b.includes("blocked 2 time")), p.basis.join("|"));
  const spent = planNextAction({ base: base({ retriesUsed: 1 }), requestModsUsed: 1, hits: [hit({})], wm });
  assertEquals(spent.kind, "handoff");
  assertEquals(planNextAction({ base: base({ retriesUsed: 1, onExhausted: "reject" }), requestModsUsed: 1, hits: [hit({})], wm }).kind, "reject");
});

Deno.test("planner: the constraints follow the kind of rule that fired", () => {
  const s = requestChangesFor([hit({ category: "secrets", name: "Key" })], emptyWm());
  assert(s.constraints[0].includes("credentials") && s.dropContext, JSON.stringify(s));
  const d = requestChangesFor([hit({ category: "destructive", name: "Drop" })], emptyWm());
  assert(d.constraints[0].includes("deleting") && !d.dropContext, JSON.stringify(d));
});

Deno.test("planner: everything else goes through the usual rules, with the reason it was based on", () => {
  const w = emptyWm();
  assertEquals(planNextAction({ base: base({ verdict: "block" }), requestModsUsed: 0, hits: [hit({})], wm: w }).kind, "retry_with_correction");
  assertEquals(planNextAction({ base: base({ verdict: "allow" }), requestModsUsed: 0, hits: [], wm: w }).kind, "finish");
  assertEquals(planNextAction({ base: base({ verdict: "allow", toolStatus: "continue" }), requestModsUsed: 0, hits: [], wm: w }).kind, "continue");
  const esc = planNextAction({ base: base({ verdict: "escalate" }), requestModsUsed: 0, hits: [hit({ effect: "approval" })], wm: w });
  assertEquals(esc.kind, "pause_human"); assert(esc.basis.some((b) => b.includes("approval")), esc.basis.join("|"));
  const need = planNextAction({ base: base({ verdict: "allow", toolStatus: "need_info" }), requestModsUsed: 0, hits: [], wm: w });
  assertEquals(need.kind, "pause_human"); assert(need.basis.some((b) => b.includes("information")), need.basis.join("|"));
});

Deno.test("planner: the time limit still wins over tightening the request", () => {
  const p = planNextAction({ base: base({ retriesUsed: 1, elapsedMs: 700_000 }), requestModsUsed: 0, hits: [hit({})], wm: emptyWm() });
  assertEquals(p.kind, "stop");
});

Deno.test("core: a tool that keeps breaking the rule gets its request tightened once, then a hand-off", () => {
  const rules = [custom({ pattern: "internal-only" })];
  const wm = buildWorkingMemory([row({ rule_names: ["Custom"], data: { verdict: "block", content_hash: "h0", rules: [{ ...pin("c1"), name: "Custom", pattern: "internal-only" }] } })]);
  const d1 = thinkOn(rules, "internal-only again", wm, loop({ retriesUsed: 1 }), 0, "h1");
  assertEquals(d1.plan.kind, "modify_request");
  const d2 = thinkOn(rules, "internal-only again", wm, loop({ retriesUsed: 2 }), 1, "h2");
  assertEquals(d2.plan.kind, "handoff");
});

Deno.test("stricterVerdict orders allow < modify < escalate < block", () => {
  assertEquals(stricterVerdict("allow", "modify"), "modify"); assertEquals(stricterVerdict("modify", "escalate"), "escalate");
  assertEquals(stricterVerdict("escalate", "block", "allow"), "block"); assertEquals(stricterVerdict(), "allow");
});
