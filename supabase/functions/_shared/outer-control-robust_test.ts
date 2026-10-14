// Run with: deno test --allow-env supabase/functions/_shared/outer-control-robust_test.ts
import { classifyFailure, parseRetryAfter, truncationOf } from "./outer-control-recovery.ts";
import { buildHandoff, decodeChoice, encodeChoice, findOption } from "./outer-control-handoff.ts";
import { humanRetriesAt, renderMemory, ruleNamesSeen, type MemoryEntry } from "./outer-control-memory.ts";
import { MAX_RULES_IN_REQUEST, planRequest, preflightRequest } from "./outer-control-planner.ts";
import { buildLegContext, legReadiness, rollupStatus, validateLegs } from "./outer-control-workflow-plan.ts";
import { buildToolRequest } from "./outer-control-tool-request.ts";
import { BUILTIN_SAFETY_RULES } from "./safety-scanner.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";

// ---- recovery ----------------------------------------------------------------------
Deno.test("classifyFailure: transient errors back off, rate limits honour Retry-After, auth/client errors stop", () => {
  assertEquals(classifyFailure({ httpStatus: 503, attempt: 1 }).delayMs, 1000);
  assertEquals(classifyFailure({ httpStatus: 503, attempt: 3 }).delayMs, 4000);
  assertEquals(classifyFailure({ httpStatus: 500, attempt: 9 }).delayMs, 8000);
  const rl = classifyFailure({ httpStatus: 429, retryAfterMs: 30_000, attempt: 1 });
  assertEquals([rl.kind, rl.retry, rl.delayMs], ["rate_limited", true, 30_000]);
  assertEquals(classifyFailure({ httpStatus: 429, retryAfterMs: 99 * 60_000, attempt: 1 }).delayMs, 5 * 60_000);
  assertEquals(classifyFailure({ httpStatus: 401, attempt: 1 }).retry, false);
  assertEquals(classifyFailure({ httpStatus: 403, attempt: 1 }).kind, "auth");
  assertEquals(classifyFailure({ httpStatus: 404, attempt: 1 }).retry, false);
  assertEquals(classifyFailure({ httpStatus: 400, attempt: 1 }).kind, "client");
  assertEquals(classifyFailure({ httpStatus: 408, attempt: 1 }).retry, true);
  assertEquals(classifyFailure({ httpStatus: null, timedOut: true, attempt: 1 }).kind, "transient");
  assertEquals(classifyFailure({ httpStatus: null, unreachable: true, attempt: 2 }).delayMs, 2000);
});

Deno.test("classifyFailure: incomplete replies are retried with a correction; unusable ones are not", () => {
  const empty = classifyFailure({ httpStatus: 200, incomplete: "empty", attempt: 1 });
  assertEquals([empty.kind, empty.retry, empty.delayMs], ["incomplete", true, 0]);
  assert(/empty/.test(empty.correction ?? ""), "correction names the problem");
  assert(/cut off/.test(classifyFailure({ httpStatus: 200, incomplete: "truncated", attempt: 1 }).correction ?? ""), "truncated");
  const tc = classifyFailure({ httpStatus: 200, unusableCode: "tool_calls_present", attempt: 1 });
  assertEquals([tc.kind, tc.retry], ["unusable", false]);
});

Deno.test("truncationOf and parseRetryAfter read provider signals", () => {
  assertEquals(truncationOf({ choices: [{ finish_reason: "length" }] }), true);
  assertEquals(truncationOf({ choices: [{ finish_reason: "stop" }] }), false);
  assertEquals(truncationOf({ stop_reason: "max_tokens" }), true);
  assertEquals(truncationOf({ candidates: [{ finishReason: "MAX_TOKENS" }] }), true);
  assertEquals(truncationOf({ status: "done" }), false);
  assertEquals(truncationOf(null), false);
  assertEquals(parseRetryAfter("7"), 7000);
  assertEquals(parseRetryAfter(null), null);
  assertEquals(parseRetryAfter(new Date(Date.now() + 5000).toUTCString(), Date.now()) !== null, true);
  assertEquals(parseRetryAfter("soon"), null);
});

// ---- memory ------------------------------------------------------------------------
const mem = (o: Partial<MemoryEntry>): MemoryEntry => ({ step_no: 1, kind: "rejection", rule_names: [], summary: "x", ...o });

Deno.test("memory: lines are cut to size, deduplicated and limited to the most recent", () => {
  const lines = renderMemory([mem({ summary: "a" }), mem({ summary: "a" }), mem({ summary: "b " + "x".repeat(500) })]);
  assertEquals(lines.length, 2);
  assert(lines[1].length <= 300, "clipped");
  assertEquals(renderMemory(Array.from({ length: 50 }, (_, i) => mem({ summary: `s${i}` }))).length, 20);
});

Deno.test("memory: rule names seen and human retries are read from the right kinds", () => {
  const e = [mem({ kind: "rejection", rule_names: ["A"] }), mem({ kind: "modification", rule_names: ["B", "A"] }), mem({ kind: "plan", rule_names: ["Z"] }),
    mem({ kind: "human", step_no: 2, summary: "A person chose to retry step 2." }), mem({ kind: "human", step_no: 3, summary: "A person chose to retry step 3." })];
  assertEquals(ruleNamesSeen(e), ["A", "B"]);
  assertEquals(humanRetriesAt(e, 2), 1);
  assertEquals(humanRetriesAt(e, 1), 0);
});

// ---- planner -----------------------------------------------------------------------
Deno.test("planRequest: rules already triggered come first, then blocking, approval, removal; the list is capped", () => {
  const rules = [
    { name: "Remove cards", action: "remove_text" as const }, { name: "Ask on refunds", action: "approval" as const },
    { name: "No price quotes", action: "block" as const }, { name: "Hit before", action: "remove_text" as const },
  ];
  const plan = planRequest({ rules, memory: [mem({ kind: "rejection", rule_names: ["Hit before"] })] });
  assertEquals(plan.rules.map((r) => r.name), ["Hit before", "No price quotes", "Ask on refunds", "Remove cards"]);
  assertEquals(plan.rules[0].matchedBefore, true);
  assertEquals(plan.avoid, ["Hit before"]);
  const many = planRequest({ rules: Array.from({ length: 40 }, (_, i) => ({ name: `r${i}`, action: "block" as const })), memory: [] });
  assertEquals([many.rules.length, many.omitted], [MAX_RULES_IN_REQUEST, 40 - MAX_RULES_IN_REQUEST]);
});

Deno.test("preflightRequest: a removable secret is masked and allowed; destructive wording cannot be worked around", () => {
  const key = "sk-" + "a".repeat(24);
  assertEquals(preflightRequest(BUILTIN_SAFETY_RULES, [`Use ${key} to log in`, "Summarise the refund policy"]).ok, true);
  const bad = preflightRequest(BUILTIN_SAFETY_RULES, ["Please drop table customers", null, undefined]);
  assertEquals(bad.ok, false);
  assert(bad.names.length >= 1, "names the rule");
  assertEquals(preflightRequest(BUILTIN_SAFETY_RULES, []).ok, true);
});

Deno.test("the request carries the plan: ordered rules, what was decided, and what to avoid", () => {
  const plan = planRequest({ rules: [{ name: "No price quotes", action: "block" }], memory: [mem({ kind: "rejection", rule_names: ["No price quotes"] })] });
  const r = buildToolRequest({
    format: "generic_json", objective: "Reply to the customer", rules: plan.rules, history: [], sessionId: "s", step: 2,
    memory: ["Step 1: reply broke \"No price quotes\" and was rejected."], avoid: plan.avoid, omittedRules: 3,
  });
  const instruction = String((r.body as { instruction: string }).instruction);
  assert(instruction.includes("Decisions already made in this run"), "memory section");
  assert(instruction.includes("already triggered this"), "flagged rule");
  assert(instruction.includes("3 further rule(s)"), "omitted note");
  assertEquals((r.body as { avoid: string[] }).avoid, ["No price quotes"]);
});

// ---- hand-off ----------------------------------------------------------------------
Deno.test("buildHandoff: a rule that keeps being broken recommends one more try, then stopping", () => {
  const first = buildHandoff({ kind: "rule_exhausted", stepNo: 2, toolName: "Bot", ruleNames: ["No price quotes"], failure: null, attempts: 2, memory: [] });
  assertEquals(first.recommended, "retry");
  assertEquals(first.options.map((o) => o.id), ["retry", "stop"]);
  assert(first.summary.some((l) => l.includes("No price quotes")), "names the rule");
  const again = buildHandoff({ kind: "rule_exhausted", stepNo: 2, toolName: "Bot", ruleNames: ["No price quotes"], failure: null, attempts: 4,
    memory: [mem({ kind: "human", step_no: 2, summary: "A person chose to retry step 2." })] });
  assertEquals(again.recommended, "stop");
});

Deno.test("buildHandoff: a failure retrying cannot fix recommends stopping; a passing one recommends retrying", () => {
  const auth = buildHandoff({ kind: "tool_failed", stepNo: 1, toolName: "Bot", ruleNames: [], failure: classifyFailure({ httpStatus: 401, attempt: 1 }), attempts: 1, memory: [] });
  assertEquals(auth.recommended, "stop");
  const flaky = buildHandoff({ kind: "tool_failed", stepNo: 1, toolName: "Bot", ruleNames: [], failure: classifyFailure({ httpStatus: 503, attempt: 3 }), attempts: 3, memory: [] });
  assertEquals(flaky.recommended, "retry");
});

Deno.test("hand-off choices round-trip and unknown options are refused", () => {
  const h = buildHandoff({ kind: "tool_failed", stepNo: 1, toolName: "Bot", ruleNames: [], failure: null, attempts: 1, memory: [] });
  assertEquals(findOption(h, "retry")?.id, "retry");
  assertEquals(findOption(h, "approve"), null);
  assertEquals(findOption(null, "retry"), null);
  assertEquals(decodeChoice(encodeChoice("retry", "  use the public price list  ")), { option: "retry", note: "use the public price list" });
  assertEquals(decodeChoice(encodeChoice("stop", null)), { option: "stop", note: null });
  assertEquals(decodeChoice("{bad"), null);
  assertEquals(decodeChoice(JSON.stringify({ option: "delete" })), null);
});

// ---- workflow ----------------------------------------------------------------------
Deno.test("validateLegs: accepts a dependency chain, rejects cycles, forward references and bad input", () => {
  const ok = validateLegs([{ tool_id: T1, instruction: "Research" }, { tool_id: T2, instruction: "Draft", depends_on: [1], fallback_tool_id: T1 }]);
  assert(ok.ok, "valid");
  if (ok.ok) assertEquals(ok.legs[1], { leg_no: 2, tool_id: T2, instruction: "Draft", depends_on: [1], fallback_tool_id: T1 });
  for (const bad of [
    [], "x", Array.from({ length: 7 }, () => ({ tool_id: T1, instruction: "a" })),
    [{ tool_id: T1, instruction: "a", depends_on: [1] }],
    [{ tool_id: T1, instruction: "a" }, { tool_id: T2, instruction: "b", depends_on: [3] }],
    [{ tool_id: "nope", instruction: "a" }], [{ tool_id: T1, instruction: "   " }],
    [{ tool_id: T1, instruction: "a", fallback_tool_id: T1 }], [{ tool_id: T1, instruction: "x".repeat(2001) }],
  ]) assertEquals(validateLegs(bad).ok, false, JSON.stringify(bad).slice(0, 60));
});

Deno.test("legReadiness: waits for open dependencies, starts when all completed, skips after a failure", () => {
  const states = [{ leg_no: 1, status: "completed", final_output: "a" }, { leg_no: 2, status: "running", final_output: null }, { leg_no: 3, status: "failed", final_output: null }];
  assertEquals(legReadiness({ depends_on: [] }, states), "ready");
  assertEquals(legReadiness({ depends_on: [1] }, states), "ready");
  assertEquals(legReadiness({ depends_on: [1, 2] }, states), "waiting");
  assertEquals(legReadiness({ depends_on: [1, 3] }, states), "skip");
  assertEquals(legReadiness({ depends_on: [2, 3] }, states), "skip");
  assertEquals(legReadiness({ depends_on: [9] }, states), "skip");
});

Deno.test("buildLegContext passes earlier results along within the size limit", () => {
  const ctx = buildLegContext("Customer: Dana", [{ leg_no: 1, status: "completed", final_output: "Order shipped Monday." }]);
  assert(ctx!.includes("Customer: Dana") && ctx!.includes("Step 1: Order shipped Monday."), "both parts");
  assertEquals(buildLegContext(null, []), null);
  assert(buildLegContext("c", [{ leg_no: 1, status: "completed", final_output: "y".repeat(20_000) }])!.length <= 8000, "capped");
});

Deno.test("rollupStatus: waiting on a person, still running, completed, or failed with the first bad step named", () => {
  const L = (leg_no: number, status: string, stop_reason: string | null = null) => ({ leg_no, status, final_output: null, stop_reason });
  assertEquals(rollupStatus([L(1, "completed"), L(2, "awaiting_human")]).status, "awaiting_human");
  assertEquals(rollupStatus([L(1, "completed"), L(2, "queued")]).status, "running");
  assertEquals(rollupStatus([L(1, "completed"), L(2, "completed")]).status, "completed");
  const failed = rollupStatus([L(1, "completed"), L(2, "failed", "The tool answered HTTP 404."), L(3, "cancelled")]);
  assertEquals(failed.status, "failed");
  assert(failed.summary.includes("Step 2") && failed.summary.includes("HTTP 404"), failed.summary);
});
