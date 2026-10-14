// Outer Control (active): a workflow is several sessions ("legs"), each against one tool,
// some waiting for earlier ones. This is the pure part: checking a definition, deciding
// when a waiting leg may start, passing results along, and rolling the legs up.

export const MAX_LEGS = 6;
export const MAX_CONTEXT_CHARS = 8000;

export type LegInput = { tool_id?: unknown; instruction?: unknown; depends_on?: unknown; fallback_tool_id?: unknown };
export type Leg = { leg_no: number; tool_id: string; instruction: string; depends_on: number[]; fallback_tool_id: string | null };

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
    let fallback: string | null = null;
    if (raw.fallback_tool_id !== undefined && raw.fallback_tool_id !== null && raw.fallback_tool_id !== "") {
      if (typeof raw.fallback_tool_id !== "string" || !UUID.test(raw.fallback_tool_id)) return { ok: false, message: `Step ${n}: the fallback tool is not valid.` };
      if (raw.fallback_tool_id === toolId) return { ok: false, message: `Step ${n}: the fallback tool must differ from the tool.` };
      fallback = raw.fallback_tool_id;
    }
    legs.push({ leg_no: n, tool_id: toolId, instruction, depends_on: deps.sort((a, b) => a - b), fallback_tool_id: fallback });
  }
  return { ok: true, legs };
}

export type LegState = { leg_no: number; status: string; final_output: string | null; stop_reason?: string | null };

export const isLegOpen = (status: string) => status === "queued" || status === "running" || status === "awaiting_human";

/** ready: every dependency completed. skip: a dependency ended without a usable result. waiting: otherwise. */
export function legReadiness(leg: { depends_on: number[] }, all: LegState[]): "ready" | "waiting" | "skip" {
  let waiting = false;
  for (const d of leg.depends_on) {
    const dep = all.find((l) => l.leg_no === d);
    if (!dep) return "skip";
    if (dep.status === "completed") continue;
    if (isLegOpen(dep.status)) { waiting = true; continue; }
    return "skip";
  }
  return waiting ? "waiting" : "ready";
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** What a leg starts with: the workflow's own context plus the results it was waiting for. */
export function buildLegContext(workflowContext: string | null, deps: LegState[]): string | null {
  const parts: string[] = [];
  if (workflowContext && workflowContext.trim()) parts.push(workflowContext.trim());
  const results = deps.filter((d) => d.final_output && d.final_output.trim());
  if (results.length) {
    const each = Math.max(400, Math.floor((MAX_CONTEXT_CHARS - (parts[0]?.length ?? 0) - 200) / results.length));
    parts.push("Results of earlier steps:\n" + results.map((d) => `Step ${d.leg_no}: ${clip(d.final_output!.trim(), each)}`).join("\n"));
  }
  const joined = parts.join("\n\n");
  return joined ? clip(joined, MAX_CONTEXT_CHARS) : null;
}

export type Rollup = { status: "running" | "awaiting_human" | "completed" | "failed"; summary: string };

export function rollupStatus(legs: LegState[]): Rollup {
  const done = legs.filter((l) => l.status === "completed").length;
  if (legs.some((l) => l.status === "awaiting_human")) return { status: "awaiting_human", summary: `${done} of ${legs.length} steps completed; a person is needed.` };
  if (legs.some((l) => isLegOpen(l.status))) return { status: "running", summary: `${done} of ${legs.length} steps completed.` };
  if (done === legs.length) return { status: "completed", summary: `All ${legs.length} steps completed.` };
  const bad = legs.find((l) => l.status !== "completed");
  return {
    status: "failed",
    summary: `${done} of ${legs.length} steps completed. Step ${bad?.leg_no} ${bad?.status ?? "did not finish"}${bad?.stop_reason ? `: ${clip(bad.stop_reason, 160)}` : "."}`,
  };
}
