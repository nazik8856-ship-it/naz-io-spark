// Run with: deno test --allow-env supabase/functions/_shared/outer-control-judgement_test.ts
import { buildWorkingMemory, decisionRecord, think, type RuleHit } from "./outer-control-brain.ts";
import {
  checkGoal, classifyRisk, fingerprintOf, largestAmount, learnedSignal, needsCare, salientTerms, scoreConfidence, similarity, LONG_REPLY,
  type Correction, type Learned,
} from "./outer-control-judgement.ts";
import { decideExternalText } from "./outer-control-decision.ts";
import { BUILTIN_SAFETY_RULES, type SafetyRule } from "./safety-scanner.ts";
import type { NextActionInput } from "./outer-control-next-action.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }

const KEY = "sk-" + "a".repeat(24);
const hit = (o: Partial<RuleHit>): RuleHit => ({ id: "h", name: "H", effect: "block", origin: "safety", scope: "account", category: "custom", pattern: null, ...o });
const noLearning: Learned = { approved: 0, declined: 0, edited: 0, tighten: false, lines: [] };
const loop = (o: Partial<Omit<NextActionInput, "verdict">> = {}): Omit<NextActionInput, "verdict"> => ({
  toolStatus: "done", stepNo: 1, maxSteps: 5, retriesUsed: 0, maxRetries: 3, failuresUsed: 0, maxFailures: 3,
  elapsedMs: 1000, maxMs: 600_000, onExhausted: "handoff", ...o,
});
const emptyWm = () => buildWorkingMemory([]);
const refundRule: SafetyRule = { id: "r1", name: "Quote prices", category: "custom", pattern: "zzquote", severity: "require_approval", enabled: true, builtin: false };
const foundationOf = (rules: SafetyRule[], content: string) => {
  const d = decideExternalText(rules, content);
  return { verdict: d.verdict, output: d.output, matches: d.matches, changes: d.changes, summary: d.summary };
};
const thinkOn = (rules: SafetyRule[], content: string, extra: { corrections?: Correction[]; maxRetries?: number } = {}) =>
  think({ foundation: foundationOf(rules, content), content, contentHash: "h1", rules, wm: emptyWm(), loop: loop({ maxRetries: extra.maxRetries ?? 3 }), requestModsUsed: 0, corrections: extra.corrections });

// ---- 4. risk ------------------------------------------------------------------------------
Deno.test("risk: a blocking rule is high; removal of secrets/personal data is high; removal of other text is medium", () => {
  assertEquals(classifyRisk({ hits: [hit({ effect: "block" })], content: "x", ruleOutcomes: {} }).level, "high");
  assertEquals(classifyRisk({ hits: [hit({ effect: "redact", category: "secrets" })], content: "x", ruleOutcomes: {} }).level, "high");
  assertEquals(classifyRisk({ hits: [hit({ effect: "redact", category: "pii" })], content: "x", ruleOutcomes: {} }).level, "high");
  assertEquals(classifyRisk({ hits: [hit({ effect: "redact", category: "custom" })], content: "x", ruleOutcomes: {} }).level, "medium");
});

Deno.test("risk: a rule that needs approval is medium; a rule broken twice already in the task is high", () => {
  assertEquals(classifyRisk({ hits: [hit({ effect: "approval", category: "financial" })], content: "x", ruleOutcomes: {} }).level, "medium");
  const r = classifyRisk({ hits: [hit({ effect: "approval", name: "Refunds" })], content: "x", ruleOutcomes: { Refunds: { blocked: 2 } } });
  assertEquals(r.level, "high"); assert(r.reasons.some((x) => /already broken 2 times/.test(x)), r.reasons.join("|"));
});

Deno.test("risk: with no rule match, a large amount or an email address makes it medium; plain text is low", () => {
  assertEquals(classifyRisk({ hits: [], content: "Thanks, noted.", ruleOutcomes: {} }).level, "low");
  assertEquals(classifyRisk({ hits: [], content: "We will credit $1,200 to you.", ruleOutcomes: {} }).level, "medium");
  assertEquals(classifyRisk({ hits: [], content: "We will credit $20 to you.", ruleOutcomes: {} }).level, "low");
  assertEquals(classifyRisk({ hits: [], content: "Write to jane@example.com.", ruleOutcomes: {} }).level, "medium");
  assertEquals(largestAmount("3 items at 750 EUR or $40"), 750);
});

// ---- 1. confidence --------------------------------------------------------------------------
const base = { verdict: "allow", foundationVerdict: "allow", hits: [] as RuleHit[], conflicts: [] as string[], tightened: false, removalFailed: false, shadowMatches: 0, contentLength: 50, priorConcerns: false, learned: noLearning, decidedByHardRule: false };

Deno.test("confidence: a clean reply and a rule-decided verdict are high, each with its reason", () => {
  const clean = scoreConfidence(base);
  assertEquals(clean.level, "high"); assert(/no rule matched/.test(clean.reasons[0]), clean.reasons[0]);
  const byRule = scoreConfidence({ ...base, verdict: "block", foundationVerdict: "block", hits: [hit({ name: "No quotes" })] });
  assertEquals(byRule.level, "high"); assert(/No quotes/.test(byRule.reasons[0]), byRule.reasons[0]);
  assert(/hard rule/.test(scoreConfidence({ ...base, verdict: "block", decidedByHardRule: true }).reasons[0]), "hard rule reason");
});

Deno.test("confidence: conflicts, tightening, shadow matches, earlier concerns and long replies make it medium", () => {
  for (const o of [{ conflicts: ["x"] }, { tightened: true }, { shadowMatches: 2 }, { priorConcerns: true }, { contentLength: LONG_REPLY + 1 }]) {
    assertEquals(scoreConfidence({ ...base, ...o }).level, "medium", JSON.stringify(o));
  }
  // priorConcerns and length only matter for an allow
  assertEquals(scoreConfidence({ ...base, verdict: "block", priorConcerns: true, contentLength: 9000 }).level, "high");
});

Deno.test("confidence: an unprovable removal or earlier declines make it low; earlier rewrites cap it at medium", () => {
  assertEquals(scoreConfidence({ ...base, verdict: "block", removalFailed: true }).level, "low");
  assertEquals(scoreConfidence({ ...base, learned: { ...noLearning, declined: 1 } }).level, "low");
  assertEquals(scoreConfidence({ ...base, learned: { ...noLearning, edited: 1 } }).level, "medium");
  // the lowest signal wins
  assertEquals(scoreConfidence({ ...base, tightened: true, learned: { ...noLearning, declined: 1 } }).level, "low");
});

Deno.test("needsCare: only high risk with low confidence", () => {
  assertEquals(needsCare({ level: "high", reasons: [] }, { level: "low", reasons: [] }), true);
  assertEquals(needsCare({ level: "high", reasons: [] }, { level: "medium", reasons: [] }), false);
  assertEquals(needsCare({ level: "medium", reasons: [] }, { level: "low", reasons: [] }), false);
});

// ---- 3. learning ----------------------------------------------------------------------------
Deno.test("fingerprint: only hashes, stable, ignores case and punctuation; similarity reflects word overlap", () => {
  const a = fingerprintOf("We will refund the customer in full today.");
  assertEquals(a, fingerprintOf("we WILL refund the customer, in full today!"));
  assert(a.every((n) => Number.isInteger(n) && n >= 0), "plain non-negative integers");
  assertEquals(similarity(a, a), 1);
  assertEquals(similarity(a, fingerprintOf("The weather is sunny and warm in the mountains.")), 0);
  assert(similarity(a, fingerprintOf("We will refund the customer in full tomorrow.")) > 0.4, "close texts overlap");
  assertEquals(fingerprintOf(""), []); assertEquals(similarity([], a), 0);
  assert(fingerprintOf("word ".repeat(500)).length <= 64, "bounded");
});

Deno.test("learning: matches by rule + similar text, or by very similar text alone; counts each outcome", () => {
  const text = "We will refund the customer in full today.";
  const mk = (outcome: Correction["outcome"], over: Partial<Correction> = {}): Correction => ({ outcome, rule_ids: ["r1"], rule_names: ["Quote prices"], fingerprint: fingerprintOf(text), ...over });
  const L = learnedSignal({ corrections: [mk("declined"), mk("approved"), mk("edited"), mk("declined", { rule_ids: ["other"], rule_names: ["Other"], fingerprint: fingerprintOf("unrelated words about the sunny weather here today") })], fingerprint: fingerprintOf(text), hitIds: ["r1"], hitNames: ["Quote prices"] });
  assertEquals([L.approved, L.declined, L.edited], [1, 1, 1]);
  assertEquals(L.tighten, false, "equal declines and approvals do not tighten");
  assertEquals(L.lines.length, 3);
  // different rule but the same text still matches
  assertEquals(learnedSignal({ corrections: [mk("declined", { rule_ids: ["x"], rule_names: ["X"] })], fingerprint: fingerprintOf(text), hitIds: ["r1"], hitNames: [] }).declined, 1);
  // same rule but unrelated text does not
  assertEquals(learnedSignal({ corrections: [mk("declined", { fingerprint: fingerprintOf("a completely different message about shipping dates") })], fingerprint: fingerprintOf(text), hitIds: ["r1"], hitNames: [] }).declined, 0);
});

Deno.test("learning: declines outnumbering approvals tighten; approvals alone never do", () => {
  const text = "We will refund the customer in full today.";
  const c = (outcome: Correction["outcome"]): Correction => ({ outcome, rule_ids: [], rule_names: [], fingerprint: fingerprintOf(text) });
  const args = { fingerprint: fingerprintOf(text), hitIds: [], hitNames: [] };
  assertEquals(learnedSignal({ corrections: [c("declined"), c("declined"), c("approved")], ...args }).tighten, true);
  assertEquals(learnedSignal({ corrections: [c("approved"), c("approved"), c("approved")], ...args }).tighten, false);
  assertEquals(learnedSignal({ corrections: [c("edited")], ...args }).tighten, false);
});

Deno.test("think: a rule softened to 'remove text' still goes to a person when similar replies were declined", () => {
  const text = `Our zzquote is final. Use ${KEY} to check it.`;
  const softened: SafetyRule = { ...refundRule, severity: "block", redact: true };
  const plain = thinkOn([softened], text);
  assertEquals(plain.verdict, "modify");
  const declined: Correction = { outcome: "declined", rule_ids: ["r1"], rule_names: ["Quote prices"], fingerprint: fingerprintOf(text) };
  const learned = thinkOn([softened], text, { corrections: [declined] });
  assertEquals(learned.verdict, "escalate");
  assertEquals(learned.escalatedByLearning, true);
  assertEquals(learned.output, null, "nothing is released while a person decides");
  assert(learned.trace.some((l) => /declines outnumber approvals/.test(l)), learned.trace.join("|"));
  assertEquals(learned.confidence.level, "low");
  // an approval of a similar reply balances it: back to the plain decision
  const balanced = thinkOn([softened], text, { corrections: [declined, { ...declined, outcome: "approved" }] });
  assertEquals(balanced.verdict, "modify");
});

Deno.test("think: learning never loosens a block", () => {
  const text = "I will drop table customers now.";
  const approved: Correction = { outcome: "approved", rule_ids: [], rule_names: [], fingerprint: fingerprintOf(text) };
  assertEquals(thinkOn(BUILTIN_SAFETY_RULES, text, { corrections: [approved, approved, approved] }).verdict, "block");
});

// ---- 4. risk in the decision, strictness -----------------------------------------------------
Deno.test("think: the decision carries risk, confidence and a readable trace", () => {
  const d = thinkOn(BUILTIN_SAFETY_RULES, `Use ${KEY} to connect.`);
  assertEquals(d.verdict, "modify");
  assertEquals(d.risk.level, "high");
  assertEquals(d.confidence.level, "high");
  assert(d.trace[0].startsWith("Decision: Modify"), d.trace[0]);
  assert(d.trace.some((l) => l.startsWith("Decided by")), d.trace.join("|"));
  assert(d.trace.some((l) => l.startsWith("Risk: high")), d.trace.join("|"));
  assert(d.trace.some((l) => l.startsWith("Confidence: high")), d.trace.join("|"));
  assert(d.trace.length <= 9 && d.trace.every((l) => l.length <= 240), "short");
  const rec = decisionRecord(d);
  assertEquals([rec.risk.level, rec.confidence.level, rec.trace.length > 0], ["high", "high", true]);
  assert(Array.isArray(rec.fingerprint) && rec.fingerprint.length > 0, "fingerprint kept for later corrections");
  assert(!JSON.stringify(rec).includes(KEY), "no secret in the stored record");
});

Deno.test("think: a high-risk block gets one correction attempt, a low-risk escalation keeps the usual limits", () => {
  const blocked = thinkOn(BUILTIN_SAFETY_RULES, "I will drop table customers now.", { maxRetries: 3 });
  assertEquals(blocked.risk.level, "high");
  assertEquals(blocked.plan.kind, "retry_with_correction", "first attempt: asks again");
  const again = think({ foundation: foundationOf(BUILTIN_SAFETY_RULES, "I will drop table customers now."), content: "I will drop table customers now.", contentHash: "h2", rules: BUILTIN_SAFETY_RULES, wm: emptyWm(), loop: loop({ maxRetries: 3, retriesUsed: 1 }), requestModsUsed: 1 });
  assert(again.plan.kind !== "retry_with_correction", `high risk stops retrying after one: ${again.plan.kind}`);
  const med = thinkOn([refundRule], "Our zzquote is 5.", { maxRetries: 3 });
  assertEquals(med.risk.level, "medium");
  assertEquals(med.verdict, "escalate");
});

Deno.test("think: high risk with low confidence goes to a person instead of being released", () => {
  // Redaction demanded by a pinned rule that cannot be carried out leaves the foundation 'allow' -> block (low confidence);
  // a high-risk modify that learning marks low is escalated for care.
  const text = `Use ${KEY} to connect.`;
  const declinedLater: Correction = { outcome: "declined", rule_ids: ["builtin:secret_key"], rule_names: [], fingerprint: fingerprintOf(text) };
  const d = thinkOn(BUILTIN_SAFETY_RULES, text, { corrections: [{ ...declinedLater }, { ...declinedLater, outcome: "edited" }] });
  assertEquals(d.verdict, "escalate");
  assertEquals(d.escalatedByLearning, true);
  assertEquals(d.output, null);
});

// ---- 5. goal alignment ------------------------------------------------------------------------
Deno.test("goal: key terms leave out task verbs and bracketed markers", () => {
  assertEquals(salientTerms("[stub:secret] Summarise the refund policy for premium customers"), ["refund", "policy", "premium", "customers"]);
  assertEquals(salientTerms("Write a reply"), []);
});

Deno.test("goal: an on-topic result passes; an off-topic paragraph is flagged; short replies are not judged", () => {
  const goal = "Explain our refund policy for premium customers";
  assertEquals(checkGoal(goal, "Premium customers can request a refund within thirty days of purchase, no questions asked.").ok, true);
  const off = checkGoal(goal, "The weather tomorrow will be sunny with light winds across the whole region, so plan accordingly.");
  assertEquals(off.ok, false); assert(/key term/.test(off.problems[0]), off.problems[0]);
  assertEquals(checkGoal(goal, "Done.").ok, true, "too short to judge");
  assertEquals(checkGoal("Write a reply", "The weather tomorrow will be sunny with light winds across the whole region, so plan accordingly.").ok, true, "a goal with no key terms is not judged on topic");
});

Deno.test("goal: a stated word limit and a forbidden quoted phrase are enforced", () => {
  const limited = checkGoal("Describe the plan in at most 5 words", "This plan has many more than five words.");
  assertEquals(limited.ok, false); assert(/at most 5/.test(limited.problems[0]), limited.problems[0]);
  assertEquals(checkGoal("Describe the plan in at most 8 words", "A short plan.").ok, true);
  assertEquals(checkGoal("Keep it under 3 words", "Too many words here").ok, false);
  assertEquals(checkGoal("Say hello, but do not mention \"price\"", "Hello, the price is low.").ok, false);
  assertEquals(checkGoal("Say hello, but do not mention \"price\"", "Hello there.").ok, true);
});
