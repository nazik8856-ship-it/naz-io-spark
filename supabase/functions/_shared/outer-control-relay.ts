// Outer Control: an external agent hands its work to one of the account's own NazAI agents (or another tool)
// through Outer Control, and reads back the controlled result.
//
//   external agent --(POST /outer-control/relay: its output + the steps to run)--> Outer Control
//   Outer Control judges the output (same rules and verdicts as /evaluate); only an allowed or cleaned output moves on
//   the cleaned output becomes the first step's input; the steps run as one Task (hand-offs checked at every step)
//   the external agent polls GET /outer-control/task/<id> and receives only the controlled final result
//
// The other direction (a NazAI agent's result going to an external tool) is an ordinary Task whose first step is the
// agent and whose later step is the external tool; it needs no entry point of its own.

import { extractExternalText } from "./outer-control-intake.ts";
import { evaluateExternalText } from "./outer-control-text-review.ts";
import { sha256Hex } from "./api-key-auth.ts";
import { createAgentTool } from "./outer-control-tools.ts";
import { startTask } from "./outer-control-workflow.ts";
import { originContext, type TaskOrigin } from "./outer-control-task.ts";
import { officialOutput } from "./outer-control-artifact.ts";
import { honestStatus } from "./outer-control-status.ts";

// deno-lint-ignore no-explicit-any
type AnyAdmin = any;

export type RelayAuth = { userId: string; keyId: string | null; isTest: boolean; scopes: string[] };
export type RelayResult = { status: number; body: Record<string, unknown> };

const MAX_STEPS = 5;
const MAX_ORIGIN_CHARS = 6000;
const MAX_TOOLS_PER_ACCOUNT = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (status: number, error: string, message: string): RelayResult => ({ status, body: { error, message } });

export async function relayToTask(
  admin: AnyAdmin, auth: RelayAuth, body: Record<string, unknown>, drive: (sessionIds: string[]) => void,
): Promise<RelayResult> {
  if (!auth.scopes.includes("outer_control:execute")) {
    return err(403, "insufficient_scope", "Relaying work to an agent runs it, so the API key needs the outer_control:execute scope.");
  }
  const sourceModel = String(body.source_model ?? "").trim().slice(0, 80);
  if (!sourceModel) return err(400, "source_model_required", "source_model (which external AI/tool produced this) is required.");
  const intake = extractExternalText(body.content);
  if (!intake.ok) return err(400, intake.code, intake.message);

  const rawSteps = body.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length === 0 || rawSteps.length > MAX_STEPS) {
    return err(400, "invalid_steps", `steps must list 1 to ${MAX_STEPS} steps, each with an agent_id or tool_id and an instruction.`);
  }
  // Resolve every step to a tool row before anything is judged or started.
  const steps: Record<string, unknown>[] = [];
  for (let i = 0; i < rawSteps.length; i++) {
    const raw = (rawSteps[i] ?? {}) as Record<string, unknown>;
    const instruction = typeof raw.instruction === "string" ? raw.instruction.trim() : "";
    if (!instruction) return err(400, "invalid_steps", `Step ${i + 1}: say what it should do (instruction).`);
    let toolId: string | null = null;
    if (typeof raw.agent_id === "string") {
      const made = await createAgentTool(admin, auth.userId, raw.agent_id, MAX_TOOLS_PER_ACCOUNT);
      if (!made.ok) return err(made.status, made.code, `Step ${i + 1}: ${made.message}`);
      toolId = made.tool.id;
    } else if (typeof raw.tool_id === "string" && UUID.test(raw.tool_id)) {
      toolId = raw.tool_id;
    }
    if (!toolId) return err(400, "invalid_steps", `Step ${i + 1}: give an agent_id or a tool_id.`);
    steps.push({ tool_id: toolId, instruction, on_failure: raw.on_failure });
  }

  // 1. Judge what the external agent sent, exactly as /evaluate does.
  const content = intake.text;
  const result = await evaluateExternalText(admin, {
    userId: auth.userId, agentId: null, apiKeyId: auth.keyId, isTest: auth.isTest, sourceModel, content,
    origin: "external-api", externalId: null, contentHash: await sha256Hex(content),
  });
  if (!result.evaluationId) return err(500, "internal_error", "Could not record this evaluation.");
  const verdictBody = { verdict: result.verdict, evaluation_id: result.evaluationId, summary: result.summary, trust_score: result.trustScore, approval_id: result.approvalId ?? undefined };
  if ((result.verdict !== "allow" && result.verdict !== "modify") || !result.output || !result.output.trim()) {
    // Blocked, or waiting for a person: nothing is passed on and no Task is started.
    return { status: 200, body: { ok: true, relayed: false, next_step: result.nextStep, ...verdictBody } };
  }

  // 2. The cleaned output becomes the first step's input; the Task runs the steps in order.
  const origin: TaskOrigin = {
    kind: "external_agent", source_model: sourceModel, evaluation_id: result.evaluationId,
    controlled_text: result.output.slice(0, MAX_ORIGIN_CHARS), verdict: result.verdict,
  };
  const goal = typeof body.goal === "string" && body.goal.trim() ? body.goal.trim().slice(0, 2000) : String(steps[0].instruction).slice(0, 2000);
  const started = await startTask(admin, auth.userId, {
    request: goal, context: originContext(origin), steps, api_key_id: auth.keyId, origin,
  });
  if (!started.ok) return err(started.code === "internal_error" ? 500 : 400, started.code, started.message);

  const cleaned = result.verdict === "modify";
  try {
    await admin.from("outer_control_task_handoffs").insert({
      task_id: started.workflowId, user_id: auth.userId, from_leg: null, from_label: sourceModel.slice(0, 120), to_leg: 1,
      outcome: cleaned ? "modified" : "passed", rules: (result.changes ?? []).map((c: { name: string }) => c.name),
      chars: origin.controlled_text.length, text_sha256: await sha256Hex(origin.controlled_text),
      note: cleaned ? `Removed text matching ${(result.changes ?? []).map((c: { name: string }) => c.name).join("; ") || "a rule"} before passing it to step 1.` : "Passed to step 1 unchanged.",
    });
  } catch { /* the audit row must never break the Task */ }
  drive(started.running);
  return { status: 200, body: { ok: true, relayed: true, task_id: started.workflowId, status: "running", ...verdictBody } };
}

/** What an external agent may read back about a Task it started through its own key: state and the controlled final result. */
export async function taskForKey(admin: AnyAdmin, auth: RelayAuth, taskId: string): Promise<RelayResult> {
  if (!taskId || taskId.length > 64) return err(404, "not_found", "Task not found.");
  const { data: t } = await admin.from("outer_control_workflows")
    .select("id, status, summary, current_leg, steps_total, steps_done, final_output, final_leg, failed_leg, stop_reason, final_artifact, api_key_id, started_at, finished_at")
    .eq("id", taskId).eq("user_id", auth.userId).maybeSingle();
  // A key sees only the Tasks started with that key.
  if (!t || (t.api_key_id ?? null) !== (auth.keyId ?? null)) return err(404, "not_found", "Task not found.");
  const { data: legs } = await admin.from("outer_control_sessions").select("leg_no, status, tool_id").eq("workflow_id", taskId).order("leg_no");
  const legRows = (legs ?? []) as { leg_no: number; status: string }[];
  const root = legRows.find((l) => l.leg_no === t.failed_leg)?.status ?? null;
  const st = honestStatus({
    kind: "task", status: t.status, artifact: t.final_artifact, stop_reason: t.stop_reason, current_leg: t.current_leg,
    steps_total: t.steps_total, steps_done: t.steps_done, failed_leg: t.failed_leg, root_status: root,
  });
  // The final artifact is the only result: its controlled output is returned only when the status is Completed.
  const artifact = st.key === "completed" ? t.final_artifact : null;
  return {
    status: 200,
    body: {
      ok: true,
      task: {
        id: t.id, status: st.label, status_key: st.key, status_reason: st.reason, raw_status: t.status, summary: t.summary,
        current_step: t.current_leg, steps_total: t.steps_total, steps_done: t.steps_done,
        final_output: artifact ? officialOutput(artifact, "task") : null, final_artifact: artifact,
        failed_step: t.failed_leg, stop_reason: t.stop_reason, started_at: t.started_at, finished_at: t.finished_at,
        steps: legRows.map((l) => ({ step: l.leg_no, status: l.status })),
      },
    },
  };
}
