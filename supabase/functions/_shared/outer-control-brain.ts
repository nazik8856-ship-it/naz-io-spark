// Outer Control: the decision brain for one task loop.
//
// The foundation judges a single reply (kill switch -> hard rules -> safety rules ->
// verdict). This module sits on top of that and answers four things the foundation cannot,
// because it only ever sees one reply at a time:
//
//   1. working memory   what already happened in THIS loop (rules that fired, how often,
//                       which texts were decided and how, which approvals a person gave)
//   2. rule resolver    when several rules match, which one wins, which ones it overrode,
//                       and an explicit note when they disagreed
//   3. consistency guard rules that fired earlier in the loop stay in force for the rest of
//                       it (even if someone disables them meanwhile); the same text gets the
//                       same decision; a decision is never WEAKER than the foundation's
//   4. next-action planner  continue / retry / modify the request / ask a person / finish,
//                       each with the facts it was based on
//
// `think()` ties them into ONE decision object. Everything here is pure: the session driver
// loads the inputs and applies the result.
import { scanWithRules, type SafetyMatch, type SafetyRule } from "./safety-scanner.ts";
import { isRedactableMatch, redactWithChanges, type OuterControlVerdict, type RedactionChange } from "./outer-control-scoring.ts";
import { decideNextAction, type NextAction, type NextActionInput, type NextActionKind } from "./outer-control-next-action.ts";
import {
  buildTrace, classifyRisk, fingerprintOf, learnedSignal, needsCare, scoreConfidence,
  type Confidence, type Correction, type Learned, type Risk,
} from "./outer-control-judgement.ts";

// ---------------------------------------------------------------------------------------
// Rules as the resolver sees them

export type Effect = "block" | "approval" | "redact";
export type Origin = "hard" | "safety" | "builtin" | "pinned";
export type Scope = "key" | "account" | "builtin";

export type RuleHit = {
  id: string;
  name: string;
  effect: Effect;
  origin: Origin;
  scope: Scope;
  category: string;
  pattern: string | null;
};

const EFFECT_RANK: Record<Effect, number> = { block: 3, approval: 2, redact: 1 };
const SCOPE_RANK: Record<Scope, number> = { key: 2, account: 1, builtin: 0 };
const ORIGIN_RANK: Record<Origin, number> = { hard: 3, safety: 2, pinned: 2, builtin: 1 };
const VERDICT_RANK: Record<OuterControlVerdict, number> = { allow: 0, modify: 1, escalate: 2, block: 3 };

export const stricterVerdict = (...vs: OuterControlVerdict[]): OuterControlVerdict =>
  vs.reduce((a, b) => (VERDICT_RANK[b] > VERDICT_RANK[a] ? b : a), "allow" as OuterControlVerdict);

const EFFECT_VERDICT: Record<Effect, OuterControlVerdict> = { block: "block", approval: "escalate", redact: "modify" };
const EFFECT_TEXT: Record<Effect, string> = { block: "block", approval: "require approval", redact: "remove text" };

/** A scanner match, with the scope of the rule that produced it. */
export function hitsFromMatches(matches: SafetyMatch[], rules: SafetyRule[]): RuleHit[] {
  const byId = new Map(rules.map((r) => [r.id, r]));
  return matches.map((m) => {
    const rule = byId.get(m.rule_id);
    const scope: Scope = !rule || rule.builtin ? "builtin" : rule.api_key_id || rule.agent_id ? "key" : "account";
    const effect: Effect = m.severity === "require_approval" ? "approval" : isRedactableMatch(m) ? "redact" : "block";
    return { id: m.rule_id, name: m.name, effect, origin: scope === "builtin" ? "builtin" : "safety", scope, category: m.category, pattern: m.pattern ?? null };
  });
}

// ---------------------------------------------------------------------------------------
// Rule priority and conflict resolution

export type Resolution = {
  effect: Effect | null;
  verdict: OuterControlVerdict;
  winner: RuleHit | null;
  /** Every rule that applies at the winning level (all of them are enforced). */
  applied: RuleHit[];
  /** Rules that asked for a weaker outcome than the winner's. */
  overridden: { rule: RuleHit; by: RuleHit; reason: string }[];
  /** One sentence per disagreement; empty when the matched rules all want the same thing. */
  conflicts: string[];
};

/**
 * Order: the strictest EFFECT wins (block > require approval > remove text); among equal
 * effects the more specific SCOPE (key > account > built-in), then the stronger ORIGIN
 * (hard rule > safety rule), then the rule id, decides which rule is named. Specificity never
 * weakens an outcome: a key-scoped "remove text" cannot override an account-wide "block".
 */
export function resolveRules(hits: RuleHit[]): Resolution {
  // One entry per rule id (a rule that matched twice, or live and pinned, counts once).
  const sorted = [...hits].sort((a, b) =>
    EFFECT_RANK[b.effect] - EFFECT_RANK[a.effect] || SCOPE_RANK[b.scope] - SCOPE_RANK[a.scope] ||
    ORIGIN_RANK[b.origin] - ORIGIN_RANK[a.origin] || Number(a.origin === "pinned") - Number(b.origin === "pinned") ||
    a.id.localeCompare(b.id)
  );
  const unique: RuleHit[] = [];
  for (const h of sorted) if (!unique.some((u) => u.id === h.id)) unique.push(h);
  if (!unique.length) return { effect: null, verdict: "allow", winner: null, applied: [], overridden: [], conflicts: [] };

  const winner = unique[0];
  const applied = unique.filter((h) => h.effect === winner.effect);
  const overridden = unique.filter((h) => h.effect !== winner.effect).map((rule) => ({
    rule, by: winner, reason: `${EFFECT_TEXT[winner.effect]} outranks ${EFFECT_TEXT[rule.effect]}`,
  }));
  const conflicts: string[] = [];
  if (overridden.length) {
    const levels = [...new Set(unique.map((h) => h.effect))].sort((a, b) => EFFECT_RANK[b] - EFFECT_RANK[a]);
    const parts = levels.map((e) => `${EFFECT_TEXT[e]}: ${unique.filter((h) => h.effect === e).map((h) => `"${h.name}"`).join(", ")}`);
    conflicts.push(`Matched rules asked for different outcomes (${parts.join("; ")}). The strictest wins: ${EFFECT_TEXT[winner.effect]} ("${winner.name}").`);
  }
  return { effect: winner.effect, verdict: EFFECT_VERDICT[winner.effect], winner, applied, overridden, conflicts };
}

// ---------------------------------------------------------------------------------------
// Working memory

/** What a memory row's `data` column holds (all optional; older rows have none). */
export type BrainFacts = {
  verdict?: OuterControlVerdict;
  attempt?: number;
  content_hash?: string;
  /** Rules that fired and can be re-applied later in the loop. */
  rules?: { id: string; name: string; category: string; pattern: string; effect: "block" | "redact"; scope: Scope }[];
  human?: "approved" | "declined";
  /** Which reply (step, attempt) a person's decision was about. */
  about?: { step: number; attempt: number };
};

export type MemoryRow = {
  step_no: number;
  kind: string;
  rule_names: string[];
  summary: string;
  data?: BrainFacts | null;
  session_id?: string | null;
};

export type PinnedRule = { id: string; name: string; category: string; pattern: string; effect: "block" | "redact"; scope: Scope; step: number };

export type WorkingMemory = {
  /** Per rule name: how many times it blocked / removed text / needed approval in this loop. */
  ruleOutcomes: Record<string, { blocked: number; modified: number; escalated: number; lastStep: number }>;
  /** Rules that blocked or removed text earlier in the loop; they stay in force until it ends. */
  pinned: PinnedRule[];
  /** Verdict per content hash for texts already decided in this loop. */
  decided: Record<string, { verdict: OuterControlVerdict; step: number; attempt: number }>;
  /** Content hashes a person approved. */
  approvedHashes: string[];
  /** How many times each step has been tried (all attempts recorded). */
  attemptsAtStep: Record<number, number>;
};

export function buildWorkingMemory(rows: MemoryRow[]): WorkingMemory {
  const wm: WorkingMemory = { ruleOutcomes: {}, pinned: [], decided: {}, approvedHashes: [], attemptsAtStep: {} };
  const hashByReply = new Map<string, string>(); // `${session}:${step}:${attempt}` -> hash
  for (const r of rows) {
    const d = r.data ?? null;
    const bump = (name: string, field: "blocked" | "modified" | "escalated") => {
      const o = (wm.ruleOutcomes[name] ??= { blocked: 0, modified: 0, escalated: 0, lastStep: 0 });
      o[field]++; o.lastStep = Math.max(o.lastStep, r.step_no);
    };
    if (r.kind === "rejection") r.rule_names.forEach((n) => bump(n, "blocked"));
    else if (r.kind === "modification") r.rule_names.forEach((n) => bump(n, "modified"));
    else if (r.kind === "rule") r.rule_names.forEach((n) => bump(n, "escalated"));
    for (const rule of d?.rules ?? []) {
      if (!wm.pinned.some((p) => p.id === rule.id)) wm.pinned.push({ ...rule, step: r.step_no });
    }
    if (d?.content_hash && d.verdict) {
      wm.decided[d.content_hash] = { verdict: d.verdict, step: r.step_no, attempt: d.attempt ?? 1 };
      hashByReply.set(`${r.session_id ?? ""}:${r.step_no}:${d.attempt ?? 1}`, d.content_hash);
      wm.attemptsAtStep[r.step_no] = Math.max(wm.attemptsAtStep[r.step_no] ?? 0, d.attempt ?? 1);
    }
  }
  for (const r of rows) {
    const d = r.data ?? null;
    if (d?.human === "approved" && d.about) {
      const h = hashByReply.get(`${r.session_id ?? ""}:${d.about.step}:${d.about.attempt}`);
      if (h && !wm.approvedHashes.includes(h)) wm.approvedHashes.push(h);
    }
  }
  return wm;
}

// ---------------------------------------------------------------------------------------
// Consistency guard

export type Guard = {
  /** Matches of rules pinned earlier in the loop that the foundation did not report itself. */
  pinnedHits: RuleHit[];
  /** The verdict this guard insists on at minimum (allow when it has no objection). */
  floor: OuterControlVerdict;
  findings: string[];
};

const pinnedAsRules = (pinned: PinnedRule[]): SafetyRule[] =>
  pinned.map((p) => ({
    id: p.id, name: p.name, category: p.category, pattern: p.pattern, severity: "block" as const,
    enabled: true, builtin: p.scope === "builtin", redact: p.effect === "redact",
  }));

export function guardConsistency(input: {
  content: string; contentHash: string; wm: WorkingMemory; reportedRuleIds: string[];
}): Guard {
  const findings: string[] = [];
  let floor: OuterControlVerdict = "allow";

  // 1. A rule that fired earlier in this loop still applies, even if it has been disabled or
  //    switched to shadow since: within one loop, rules only ever get stricter.
  const pinnedHits: RuleHit[] = [];
  const pinned = input.wm.pinned.filter((p) => !input.reportedRuleIds.includes(p.id));
  if (pinned.length) {
    const scan = scanWithRules(pinnedAsRules(pinned), input.content, "");
    for (const m of scan.matches) {
      const p = pinned.find((x) => x.id === m.rule_id)!;
      pinnedHits.push({ id: p.id, name: p.name, effect: p.effect, origin: "pinned", scope: p.scope, category: p.category, pattern: p.pattern });
      findings.push(`"${p.name}" ${p.effect === "block" ? "blocked" : "removed text"} at step ${p.step} of this task, so it still applies.`);
    }
  }

  // 2. The same text gets the same decision: a text that was blocked or cleaned earlier in the
  //    loop is never waved through later.
  const prior = input.wm.decided[input.contentHash];
  if (prior && (prior.verdict === "block" || prior.verdict === "modify")) {
    floor = stricterVerdict(floor, prior.verdict);
    findings.push(`This exact text was decided "${prior.verdict}" at step ${prior.step}; the decision is kept.`);
  }
  return { pinnedHits, floor, findings };
}

// ---------------------------------------------------------------------------------------
// Next-action planner

export type RequestChanges = { constraints: string[]; dropContext: boolean };

export type PlannedKind = NextActionKind | "modify_request";
export type Plan = { kind: PlannedKind; reason: string; request: RequestChanges | null; basis: string[] };

export const MAX_REQUEST_MODS = 1;

const CONSTRAINT_BY_CATEGORY: Record<string, string> = {
  secrets: "Do not include credentials, API keys, tokens or passwords.",
  pii: "Do not include personal identifiers, contact details or card numbers.",
  destructive: "Do not propose deleting, dropping or destroying anything; describe only.",
};

/** What to tighten in the request after a rule keeps being broken. Deterministic, from the rules that fired. */
export function requestChangesFor(hits: RuleHit[], wm: WorkingMemory): RequestChanges {
  const constraints: string[] = [];
  const cats = [...new Set(hits.map((h) => h.category))];
  for (const c of cats) if (CONSTRAINT_BY_CATEGORY[c]) constraints.push(CONSTRAINT_BY_CATEGORY[c]);
  const other = hits.filter((h) => !CONSTRAINT_BY_CATEGORY[h.category]).map((h) => h.name);
  if (other.length) constraints.push(`Do not say anything covered by: ${[...new Set(other)].join("; ")}.`);
  constraints.push("Reply with only plain, verifiable facts in at most 80 words.");
  const sensitive = hits.some((h) => h.category === "secrets" || h.category === "pii");
  const repeated = hits.some((h) => (wm.ruleOutcomes[h.name]?.blocked ?? 0) >= 2);
  return { constraints, dropContext: sensitive || repeated };
}

export type PlanInput = {
  /** The usual limits and counters; `verdict` is null for a failed exchange. */
  base: NextActionInput;
  requestModsUsed: number;
  hits: RuleHit[];
  wm: WorkingMemory;
};

export function planNextAction(i: PlanInput): Plan {
  const a: NextAction = decideNextAction(i.base);
  const basis: string[] = [];
  const blockedBefore = i.hits.map((h) => ({ name: h.name, n: i.wm.ruleOutcomes[h.name]?.blocked ?? 0 })).filter((x) => x.n > 0);
  for (const b of blockedBefore) basis.push(`"${b.name}" blocked ${b.n} time(s) earlier in this task.`);

  // Retries ran out on a rule violation: change the request once before involving a person.
  const outOfRetries = i.base.verdict === "block" && (a.kind === "handoff" || a.kind === "reject");
  if (outOfRetries && i.requestModsUsed < MAX_REQUEST_MODS && i.base.elapsedMs <= i.base.maxMs) {
    const request = requestChangesFor(i.hits, i.wm);
    basis.push(`${i.base.retriesUsed} retr${i.base.retriesUsed === 1 ? "y" : "ies"} already used.`);
    return {
      kind: "modify_request", request, basis,
      reason: `The reply keeps breaking a rule. The request is tightened once (${request.constraints.length} added constraint(s)${request.dropContext ? ", earlier context left out" : ""}) before a person is asked.`,
    };
  }
  if (i.base.verdict === "escalate") basis.push("A rule requires a person's approval for this reply.");
  if (i.base.toolStatus === "need_info") basis.push("The tool says it cannot go on without information from a person.");
  return { kind: a.kind, reason: a.reason, request: null, basis };
}

// ---------------------------------------------------------------------------------------
// The decision core

/** The foundation's judgement of one reply (the fields of TextReviewResult this needs). */
export type Foundation = {
  verdict: OuterControlVerdict;
  output: string | null;
  matches: SafetyMatch[];
  changes: RedactionChange[];
  summary: string;
  /** Observe-only (shadow) rules that also matched; they never change the verdict. */
  shadowMatches?: number;
};

export type BrainDecision = {
  verdict: OuterControlVerdict;
  /** The text the loop may use: the original (allow), the cleaned text (modify), or null. */
  output: string | null;
  changes: RedactionChange[];
  /** Plain-language reason, one string for the step log and the dashboard. */
  why: string;
  foundationVerdict: OuterControlVerdict;
  winner: RuleHit | null;
  applied: RuleHit[];
  overridden: Resolution["overridden"];
  conflicts: string[];
  guard: string[];
  plan: Plan;
  /** How risky the situation is, and how far this decision can be trusted to stand without a person. */
  risk: Risk;
  confidence: Confidence;
  /** What earlier human decisions on similar replies say. */
  learned: Learned;
  /** Short readable lines: what was decided, by which rule, why. */
  trace: string[];
  /** Word-overlap fingerprint of the reply (hashes only), kept so a later human correction can be matched to it. */
  fingerprint: number[];
  escalatedForCare: boolean;
  escalatedByLearning: boolean;
};

export type ThinkInput = {
  foundation: Foundation;
  content: string;
  contentHash: string;
  rules: SafetyRule[];
  wm: WorkingMemory;
  /** Loop state for the planner; `verdict` is filled in from the decision. */
  loop: Omit<NextActionInput, "verdict">;
  requestModsUsed: number;
  /** Earlier human corrections for this account/key (approved, declined, edited replies). */
  corrections?: Correction[];
};

export function think(i: ThinkInput): BrainDecision {
  const f = i.foundation;
  const live = hitsFromMatches(f.matches, i.rules);
  const guard = guardConsistency({ content: i.content, contentHash: i.contentHash, wm: i.wm, reportedRuleIds: live.map((h) => h.id) });

  // A stop with no safety match behind it (kill switch, hard rule) still has to be named.
  const hits: RuleHit[] = [...live, ...guard.pinnedHits];
  if (!live.length && (f.verdict === "block" || f.verdict === "escalate")) {
    hits.push({
      id: "foundation", name: f.summary.replace(/\s+/g, " ").slice(0, 120), origin: "hard", scope: "account",
      effect: f.verdict === "block" ? "block" : "approval", category: "hard_rule", pattern: null,
    });
  }
  const res = resolveRules(hits);

  // Learning: when people declined similar replies more often than they approved them, this one goes to a
  // person too. Learning only ever tightens; approvals alone never let anything through.
  const fingerprint = fingerprintOf(i.content);
  const learned = learnedSignal({
    corrections: i.corrections ?? [], fingerprint, hitIds: hits.map((h) => h.id), hitNames: hits.map((h) => h.name),
  });

  // Never weaker than the foundation; the resolver, the guard and learning can only tighten it.
  const baseVerdict = stricterVerdict(f.verdict, res.verdict, guard.floor);
  let verdict = stricterVerdict(baseVerdict, learned.tighten ? "escalate" : "allow");
  const escalatedByLearning = verdict !== baseVerdict;
  let removalFailed = false;
  let output = f.output;
  let changes = f.changes;

  if (verdict === "block" || verdict === "escalate") {
    output = null;
    if (verdict !== f.verdict) changes = [];
  } else if (verdict === "modify") {
    // Rules pinned earlier in this loop that ask for removal apply on top of whatever the foundation cleaned.
    const pinnedRedact = guard.pinnedHits.filter((h) => h.effect === "redact" && h.pattern)
      .map((h) => ({ rule_id: h.id, name: h.name, pattern: h.pattern!, category: h.category, redact: true }));
    if (pinnedRedact.length) {
      const cleaned = redactWithChanges(output ?? i.content, pinnedRedact);
      const recheck = scanWithRules(pinnedAsRules(i.wm.pinned), cleaned.text, "");
      if (cleaned.changes.length && !recheck.matched) { output = cleaned.text; changes = [...f.changes, ...cleaned.changes]; }
      else { verdict = "block"; output = null; changes = []; removalFailed = true; }
    } else if (f.verdict !== "modify") {
      // "Clean it" was demanded but there is nothing to cut out by rule: never release it unchanged.
      verdict = "block"; output = null; changes = []; removalFailed = true;
    }
  }

  // Risk and confidence. A high-risk reply that the brain itself does not trust goes to a person.
  const risk = classifyRisk({ hits, content: i.content, ruleOutcomes: i.wm.ruleOutcomes });
  const confidence = scoreConfidence({
    verdict, foundationVerdict: f.verdict, hits, conflicts: res.conflicts, tightened: baseVerdict !== f.verdict, removalFailed,
    shadowMatches: f.shadowMatches ?? 0, contentLength: i.content.length, priorConcerns: Object.keys(i.wm.ruleOutcomes).length > 0,
    learned, decidedByHardRule: hits.some((h) => h.id === "foundation"),
  });
  let escalatedForCare = false;
  if ((verdict === "allow" || verdict === "modify") && needsCare(risk, confidence)) {
    verdict = "escalate"; output = null; changes = []; escalatedForCare = true;
  }

  const parts: string[] = [f.summary];
  if (verdict !== f.verdict) parts.push(`Tightened to "${verdict}" by this task's earlier decisions.`);
  parts.push(...res.conflicts, ...guard.findings);
  const why = parts.filter(Boolean).join(" ").slice(0, 900);

  // High risk is treated more strictly: one correction attempt, then a person.
  const loop = risk.level === "high" ? { ...i.loop, maxRetries: Math.min(i.loop.maxRetries, 1) } : i.loop;
  const plan = planNextAction({
    base: { ...loop, verdict }, requestModsUsed: i.requestModsUsed, hits, wm: i.wm,
  });
  const trace = buildTrace({
    verdict, foundationVerdict: f.verdict, winner: res.winner, overridden: res.overridden, guard: guard.findings, learned, risk, confidence,
    changesText: changes.length ? `Removed ${changes.map((c) => `${c.count}× "${c.name}"`).join(", ")}.` : "",
    escalatedForCare, escalatedByLearning,
  });
  return {
    verdict, output, changes, why, foundationVerdict: f.verdict, winner: res.winner, applied: res.applied,
    overridden: res.overridden, conflicts: res.conflicts, guard: guard.findings, plan,
    risk, confidence, learned, trace, fingerprint, escalatedForCare, escalatedByLearning,
  };
}

/** The part of a decision worth keeping on the step row. */
export function decisionRecord(d: BrainDecision) {
  return {
    verdict: d.verdict, foundation: d.foundationVerdict, why: d.why,
    winner: d.winner ? { id: d.winner.id, name: d.winner.name, effect: d.winner.effect, scope: d.winner.scope, origin: d.winner.origin } : null,
    applied: d.applied.map((h) => h.name), changes: d.changes.map((c) => ({ name: c.name, count: c.count })), overridden: d.overridden.map((o) => ({ rule: o.rule.name, by: o.by.name, reason: o.reason })),
    conflicts: d.conflicts, guard: d.guard,
    plan: { kind: d.plan.kind, reason: d.plan.reason, basis: d.plan.basis, request: d.plan.request },
    risk: d.risk, confidence: d.confidence, trace: d.trace,
    learned: { approved: d.learned.approved, declined: d.learned.declined, edited: d.learned.edited },
    // What a later human correction needs to be matched back to this reply (hashes only, no text).
    fingerprint: d.fingerprint, rule_ids: [...d.applied, ...d.overridden.map((o) => o.rule)].map((h) => h.id)
      .filter((id, k, a) => a.indexOf(id) === k),
  };
}

/** Memory facts for a reply that was blocked, cleaned or escalated: what to pin, and what was decided. */
export function factsFor(d: BrainDecision, hash: string, attempt: number): BrainFacts {
  const pinnable = [...d.applied, ...d.overridden.map((o) => o.rule)]
    .filter((h) => (h.effect === "block" || h.effect === "redact") && h.pattern && h.origin !== "hard")
    .filter((h, idx, arr) => arr.findIndex((x) => x.id === h.id) === idx)
    .map((h) => ({ id: h.id, name: h.name, category: h.category, pattern: h.pattern!, effect: h.effect as "block" | "redact", scope: h.scope }));
  return { verdict: d.verdict, attempt, content_hash: hash, rules: d.verdict === "allow" ? [] : pinnable };
}
