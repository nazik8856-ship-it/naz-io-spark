// Outer Control (active): a workflow is several sessions ("legs"), each against one tool,
// some waiting for earlier ones, some running only when an earlier result calls for it.
// This is the pure part: checking a definition, deciding when a waiting leg may start (or
// is skipped, or can never run), passing results along, and rolling the legs up.

export const MAX_LEGS = 6;
export const MAX_CONTEXT_CHARS = 8000;
export const MAX_CONDITION_VALUE = 200;

/**
 * Run a step only when an earlier step's result says so.
 *   contains / not_contains: the earlier step completed and its result does / does not contain `value`
 *   dep_failed:              the earlier step ended failed, rejected or stopped (an error branch)
 */
export type LegCondition = { leg: number; op: "contains" | "not_contains" | "dep_failed"; value: string | null };

export type LegInput = {
  tool_id?: unknown; instruction?: unknown; depends_on?: unknown; fallback_tool_id?: unknown;
  condition?: unknown; on_failure?: unknown;
  /** "none": the step does not receive the earlier steps' results (an independent opinion). Default "pass". */
  handoff?: unknown;
};
export type Leg = {
  leg_no: number; tool_id: string; instruction: string; depends_on: number[]; fallback_tool_id: string | null;
  condition: LegCondition | null; on_failure: "handoff" | "reject" | null; handoff: "pass" | "none";
};

export type ValidatedLegs = { ok: true; legs: Leg[] } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateLegs(input: unknown): ValidatedLegs {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, message: "Add at least one step." };
  if (input.length > MAX_LEGS) return { ok: false, message: `A workflow can have at most ${MAX_LEGS} steps.` };
  const legs: Leg[] = [];
  for (let idx = 0; idx < input.length; idx++) {
    const raw = (input[idx] ?? {}) as LegInput;
    const n = idx + 1;
    const toolId = typeof raw.tool_id === "string" ? raw.tool_id.trim() : "";
    if (!UUID.test(toolId)) return { ok: false, message: `Step ${n}: choose a tool.` };
    const instruction = typeof raw.instruction === "string" ? raw.instruction.trim() : "";
    if (!instruction) return { ok: false, message: `Step ${n}: say what the tool should do.` };
    if (instruction.length > 2000) return { ok: false, message: `Step ${n}: the instruction is limited to 2000 characters.` };
    const deps: number[] = [];
    if (raw.depends_on !== undefined && raw.depends_on !== null) {
      if (!Array.isArray(raw.depends_on)) return { ok: false, message: `Step ${n}: dependencies must be a list of step numbers.` };
      for (const d of raw.depends_on) {
        if (!Number.isInteger(d) || (d as number) < 1 || (d as number) >= n) {
          return { ok: false, message: `Step ${n}: it can only wait for earlier steps (1 to ${n - 1}).` };
        }
        if (!deps.includes(d as number)) deps.push(d as number);
      }
    }
    let condition: LegCondition | null = null;
    if (raw.condition !== undefined && raw.condition !== null) {
      const c = raw.condition as Record<string, unknown>;
      if (typeof c !== "object" || Array.isArray(c)) return { ok: false, message: `Step ${n}: the condition is not valid.` };
      const ref = c.leg;
      if (!Number.isInteger(ref) || (ref as number) < 1 || (ref as number) >= n) {
        return { ok: false, message: `Step ${n}: a condition can only look at an earlier step (1 to ${n - 1}).` };
      }
      if (c.op !== "contains" && c.op !== "not_contains" && c.op !== "dep_failed") {
        return { ok: false, message: `Step ${n}: the condition must be "contains", "not_contains" or "dep_failed".` };
      }
      let value: string | null = null;
      if (c.op !== "dep_failed") {
        value = typeof c.value === "string" ? c.value.trim() : "";
        if (!value) return { ok: false, message: `Step ${n}: say which text the condition looks for.` };
        if (value.length > MAX_CONDITION_VALUE) return { ok: false, message: `Step ${n}: the condition text is limited to ${MAX_CONDITION_VALUE} characters.` };
      }
      condition = { leg: ref as number, op: c.op, value };
      // A step cannot look at a result it does not wait for.
      if (!deps.includes(condition.leg)) deps.push(condition.leg);
    }
    let fallback: string | null = null;
    if (raw.fallback_tool_id !== undefined && raw.fallback_tool_id !== null && raw.fallback_tool_id !== "") {
      if (typeof raw.fallback_tool_id !== "string" || !UUID.test(raw.fallback_tool_id)) return { ok: false, message: `Step ${n}: the fallback tool is not valid.` };
      if (raw.fallback_tool_id === toolId) return { ok: false, message: `Step ${n}: the fallback tool must differ from the tool.` };
      fallback = raw.fallback_tool_id;
    }
    let onFailure: "handoff" | "reject" | null = null;
    if (raw.on_failure !== undefined && raw.on_failure !== null) {
      if (raw.on_failure !== "handoff" && raw.on_failure !== "reject") return { ok: false, message: `Step ${n}: on_failure must be "handoff" or "reject".` };
      onFailure = raw.on_failure;
    }
    if (raw.handoff !== undefined && raw.handoff !== null && raw.handoff !== "pass" && raw.handoff !== "none") return { ok: false, message: `Step ${n}: handoff must be "pass" or "none".` };
    legs.push({ leg_no: n, tool_id: toolId, instruction, depends_on: deps.sort((a, b) => a - b), fallback_tool_id: fallback, condition, on_failure: onFailure, handoff: raw.handoff === "none" ? "none" : "pass" });
  }
  return { ok: true, legs };
}

export type LegState = {
  leg_no: number; status: string; final_output: string | null; stop_reason?: string | null;
  condition?: LegCondition | null;
};

export const isLegOpen = (status: string) => status === "queued" || status === "running" || status === "awaiting_human";
const ERROR_ENDS = new Set(["failed", "rejected", "stopped"]);

/**
 * ready:   start it.
 * waiting: something it depends on is still open.
 * cancel:  something it depends on ended without a usable result and nothing handles that.
 * skipped: its branch is not taken (condition false, or everything it depends on was skipped).
 */
export type Readiness = "ready" | "waiting" | "cancel" | "skipped";

export function legReadiness(leg: { depends_on: number[]; condition?: LegCondition | null }, all: LegState[]): Readiness {
  const cond = leg.condition ?? null;
  const done: LegState[] = [];
  let skipped = 0;
  let waiting = false;
  for (const d of leg.depends_on) {
    const dep = all.find((l) => l.leg_no === d);
    if (!dep) return "cancel";
    if (dep.status === "completed") { done.push(dep); continue; }
    if (isLegOpen(dep.status)) { waiting = true; continue; }
    if (dep.status === "skipped") { skipped++; continue; }
    // A step that ended badly is only acceptable when this step exists to handle exactly that.
    if (cond && cond.op === "dep_failed" && cond.leg === d && ERROR_ENDS.has(dep.status)) continue;
    return "cancel";
  }
  if (waiting) return "waiting";
  if (!cond) return done.length === 0 && skipped > 0 ? "skipped" : "ready";

  const target = all.find((l) => l.leg_no === cond.leg);
  if (!target) return "cancel";
  if (cond.op === "dep_failed") return ERROR_ENDS.has(target.status) ? "ready" : "skipped";
  if (target.status !== "completed") return "skipped";
  const hay = (target.final_output ?? "").toLowerCase();
  const needle = (cond.value ?? "").toLowerCase();
  const has = needle.length > 0 && hay.includes(needle);
  return (cond.op === "contains" ? has : !has) ? "ready" : "skipped";
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** What a leg starts with: the workflow's own context plus the results it was waiting for. */
export function buildLegContext(workflowContext: string | null, deps: LegState[]): string | null {
  const parts: string[] = [];
  if (workflowContext && workflowContext.trim()) parts.push(workflowContext.trim());
  const results = deps.filter((d) => d.status === "completed" && d.final_output && d.final_output.trim());
  if (results.length) {
    const each = Math.max(400, Math.floor((MAX_CONTEXT_CHARS - (parts[0]?.length ?? 0) - 200) / results.length));
    parts.push("Results of earlier steps:\n" + results.map((d) => `Step ${d.leg_no}: ${clip(d.final_output!.trim(), each)}`).join("\n"));
  }
  const failed = deps.filter((d) => ERROR_ENDS.has(d.status));
  if (failed.length) {
    parts.push(failed.map((d) => `Step ${d.leg_no} did not finish${d.stop_reason ? `: ${clip(d.stop_reason, 200)}` : "."}`).join("\n"));
  }
  const joined = parts.join("\n\n");
  return joined ? clip(joined, MAX_CONTEXT_CHARS) : null;
}

export type Rollup = { status: "running" | "awaiting_human" | "completed" | "failed" | "cancelled"; summary: string };

/** A failed step is "handled" when a step whose condition is dep_failed on it completed. */
const handledBy = (leg: LegState, all: LegState[]) =>
  all.find((l) => l.status === "completed" && l.condition?.op === "dep_failed" && l.condition.leg === leg.leg_no) ?? null;

export function rollupStatus(legs: LegState[]): Rollup {
  const done = legs.filter((l) => l.status === "completed").length;
  const skipped = legs.filter((l) => l.status === "skipped").length;
  const suffix = skipped ? ` (${skipped} skipped)` : "";
  if (legs.some((l) => l.status === "awaiting_human")) return { status: "awaiting_human", summary: `${done} of ${legs.length} steps completed${suffix}; a person is needed.` };
  if (legs.some((l) => isLegOpen(l.status))) return { status: "running", summary: `${done} of ${legs.length} steps completed${suffix}.` };

  const bad = legs.filter((l) => l.status !== "completed" && l.status !== "skipped");
  // Everything unfinished was cancelled, and at least one of those by the owner: the Task was cancelled, it did not fail.
  if (bad.length > 0 && bad.every((l) => l.status === "cancelled") && bad.some((l) => /^Cancelled by the owner/.test(l.stop_reason ?? ""))) {
    return { status: "cancelled", summary: `${done} of ${legs.length} steps completed${suffix}; cancelled by the owner.` };
  }
  const unhandled = bad.filter((l) => !(ERROR_ENDS.has(l.status) && handledBy(l, legs)));
  if (unhandled.length === 0 && done > 0) {
    const handled = bad.map((l) => `step ${l.leg_no} failed and was handled by step ${handledBy(l, legs)!.leg_no}`);
    if (bad.length === 0 && skipped === 0) return { status: "completed", summary: `All ${legs.length} steps completed.` };
    return { status: "completed", summary: `${done} of ${legs.length} steps completed${suffix}${handled.length ? `; ${handled.join("; ")}` : ""}.` };
  }
  const first = unhandled[0] ?? legs.find((l) => l.status !== "completed");
  return {
    status: "failed",
    summary: `${done} of ${legs.length} steps completed${suffix}. Step ${first?.leg_no} ${first?.status ?? "did not finish"}${first?.stop_reason ? `: ${clip(first.stop_reason, 160)}` : "."}`,
  };
}
