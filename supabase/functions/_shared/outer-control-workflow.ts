// Outer Control (active): runs several tools at once as one workflow. Each leg is an
// ordinary session, so everything a session does (gate, rules, recovery, hand-off) applies
// to every leg unchanged. This file only starts the legs, lets waiting legs begin once what
// they depend on has finished (handing them the results), and keeps the workflow's status.
import { advanceSession, alertSnippet, defaultSessionDeps, resumeSession, type SessionDeps } from "./outer-control-session.ts";
import { loadSafetyRules, scanWithRules } from "./safety-scanner.ts";
import { isRedactableMatch } from "./outer-control-scoring.ts";
import { textSafeToStore } from "./outer-control-text-review.ts";
import { sha256Hex } from "./api-key-auth.ts";
import { sendCriticalAlert } from "./critical-alerts.ts";
import { buildTaskArtifact, officialOutput, validateArtifact, type TaskArtifactHandoff } from "./outer-control-artifact.ts";
import {
  chainLegs, contextFromHandoffs, deriveTaskState, makeHandoff, type HandoffCheck, type HandoffRecord, type TaskKind, type TaskLeg, type TaskOrigin,
} from "./outer-control-task.ts";
import {
  buildLegContext, isLegOpen, legReadiness, MAX_CONTEXT_CHARS, MAX_LEGS, validateLegs, type LegState,
} from "./outer-control-workflow-plan.ts";

// deno-lint-ignore no-explicit-any
type AnyAdmin = any;

const iso = () => new Date().toISOString();

/** A report that was paid for with a credit and did not get delivered gives the credit back, once (the database makes it once). */
export async function refundWorkflowCredit(admin: AnyAdmin, workflowId: string): Promise<boolean> {
  try {
    const { data } = await admin.rpc("refund_workflow_credit", { p_workflow_id: workflowId });
    return data === true;
  } catch { return false; }
}

type LegRow = LegState & { id: string; depends_on: number[]; context: string | null; tool_id: string; user_id: string; api_key_id: string | null; objective: string; final_artifact: unknown; handoff_mode?: string };

async function loadLegs(admin: AnyAdmin, workflowId: string): Promise<LegRow[]> {
  const { data } = await admin.from("outer_control_sessions")
    .select("id, leg_no, status, depends_on, final_output, stop_reason, context, condition, tool_id, user_id, api_key_id, objective, final_artifact, handoff_mode").eq("workflow_id", workflowId).order("leg_no");
  // Only the final artifact is a result. A leg recorded as completed without a valid one has no result and counts as failed.
  return ((data ?? []) as LegRow[]).map((l) => {
    const base = { ...l, depends_on: l.depends_on ?? [] };
    if (l.status !== "completed") return base;
    const out = officialOutput(l.final_artifact, "session");
    return out === null
      ? { ...base, status: "failed", final_output: null, stop_reason: "It was recorded as completed but has no valid final result, so it is not treated as completed." }
      : { ...base, final_output: out };
  });
}

type ToolInfo = { name: string; agent_id: string | null };

async function loadToolInfo(admin: AnyAdmin, legs: LegRow[]): Promise<Map<string, ToolInfo>> {
  const ids = [...new Set(legs.map((l) => l.tool_id))];
  if (!ids.length) return new Map();
  const { data } = await admin.from("external_tools").select("id, name, agent_id").in("id", ids);
  return new Map(((data ?? []) as { id: string; name: string; agent_id: string | null }[]).map((t) => [t.id, { name: t.name, agent_id: t.agent_id ?? null }]));
}

/**
 * The same rules a step's own replies are checked against, applied to a result about to be handed to it:
 * the account's rules, the API key's, and (when the receiver is a NazAI agent) that agent's own. A blocking
 * rule that cannot be worked around stops the hand-off; text a rule can remove is handed over without it.
 */
export async function checkForReceiver(
  admin: AnyAdmin, userId: string, apiKeyId: string | null, receiverAgentId: string | null, text: string,
): Promise<HandoffCheck> {
  const rules = (await loadSafetyRules(admin, userId, receiverAgentId, apiKeyId)).filter((r) => !r.shadow_mode);
  const scan = scanWithRules(rules, text, "");
  const blocked: string[] = [];
  const changed: string[] = [];
  for (const m of scan.matches) {
    if (m.severity === "block") (isRedactableMatch(m) ? changed : blocked).push(m.name);
    // An approval rule already had its say when the sending step's result was accepted.
  }
  const uniq = (a: string[]) => [...new Set(a)];
  return { blocked: uniq(blocked), changed: uniq(changed), cleaned: changed.length ? textSafeToStore(text, scan.matches.filter((m) => m.severity === "block" && isRedactableMatch(m))) : text };
}

async function logHandoffs(admin: AnyAdmin, taskId: string, userId: string, records: HandoffRecord[]) {
  if (!records.length) return;
  const rows = await Promise.all(records.map(async (h) => ({
    task_id: taskId, user_id: userId, from_leg: h.from_leg, from_label: h.from_label.slice(0, 120), to_leg: h.to_leg, outcome: h.outcome,
    rules: h.rules, chars: h.text.length, text_sha256: h.text ? await sha256Hex(h.text) : null, note: h.note.slice(0, 500),
  })));
  try { await admin.from("outer_control_task_handoffs").insert(rows); } catch { /* the audit row must never break the Task */ }
}

/**
 * Starts legs whose dependencies are done, cancels legs that can never run, and updates the
 * workflow's status. Returns the sessions it just started so the caller can drive them.
 */
export async function progressWorkflow(admin: AnyAdmin, workflowId: string): Promise<string[]> {
  const started: string[] = [];
  const { data: wf } = await admin.from("outer_control_workflows").select("id, context, status, kind, objective, user_id, origin").eq("id", workflowId).maybeSingle();
  if (!wf) return started;
  const workflow = wf as { id: string; context: string | null; status: string; kind: TaskKind; objective: string; user_id: string; origin: unknown };

  let legs = await loadLegs(admin, workflowId);
  const tools = await loadToolInfo(admin, legs);
  for (let round = 0; round <= MAX_LEGS; round++) {
    let changed = false;
    for (const leg of legs.filter((l) => l.status === "queued")) {
      const verdict = legReadiness(leg, legs);
      if (verdict === "ready") {
        const deps = legs.filter((d) => leg.depends_on.includes(d.leg_no));
        // The hand-off step: each completed dependency's controlled result is checked for this step, then passed on.
        const receiverAgent = tools.get(leg.tool_id)?.agent_id ?? null;
        const records: HandoffRecord[] = [];
        // An independent step ("none") is asked on its own: it receives the Task's request, not the earlier steps' answers.
        for (const d of leg.handoff_mode === "none" ? [] : deps.filter((x) => x.status === "completed" && (x.final_output ?? "").trim())) {
          const check = await checkForReceiver(admin, leg.user_id, leg.api_key_id, receiverAgent, d.final_output as string);
          records.push(makeHandoff({
            from_leg: d.leg_no, from_label: tools.get(d.tool_id)?.name ?? "tool", to_leg: leg.leg_no,
            text: d.final_output as string, check, maxChars: MAX_CONTEXT_CHARS,
          }));
        }
        const stopped = records.find((r) => r.outcome === "blocked");
        if (stopped) {
          const { data: moved } = await admin.from("outer_control_sessions")
            .update({ status: "rejected", stop_reason: stopped.note, finished_at: iso(), updated_at: iso() })
            .eq("id", leg.id).eq("status", "queued").select("id").maybeSingle();
          if (moved) { await logHandoffs(admin, workflowId, leg.user_id, records); changed = true; }
          continue;
        }
        const failedNotes = leg.handoff_mode === "none" ? "" : buildLegContext(null, deps.filter((d) => d.status !== "completed"));
        const context = [contextFromHandoffs(workflow.context, records), failedNotes].filter(Boolean).join("\n\n").slice(0, MAX_CONTEXT_CHARS) || null;
        const { data: moved } = await admin.from("outer_control_sessions")
          .update({ status: "running", context, updated_at: iso() })
          .eq("id", leg.id).eq("status", "queued").select("id").maybeSingle();
        if (moved) { started.push(leg.id); await logHandoffs(admin, workflowId, leg.user_id, records); changed = true; }
      } else if (verdict === "cancel") {
        await admin.from("outer_control_sessions")
          .update({ status: "cancelled", stop_reason: "A step it depends on did not finish.", finished_at: iso(), updated_at: iso() })
          .eq("id", leg.id).eq("status", "queued");
        changed = true;
      } else if (verdict === "skipped") {
        await admin.from("outer_control_sessions")
          .update({ status: "skipped", stop_reason: "Its condition was not met, so this branch was not taken.", finished_at: iso(), updated_at: iso() })
          .eq("id", leg.id).eq("status", "queued");
        changed = true;
      }
    }
    if (!changed) break;
    legs = await loadLegs(admin, workflowId);
  }

  if (workflow.status !== "cancelled" && legs.length) {
    const taskLegs: TaskLeg[] = legs.map((l) => ({ ...l, label: tools.get(l.tool_id)?.name }));
    let state = deriveTaskState(taskLegs);
    // "Completed" needs the Task's own final artifact, built from the verified artifacts of its steps.
    let finalArtifact: unknown = null;
    if (state.status === "completed") {
      const { data: hand } = await admin.from("outer_control_task_handoffs").select("from_leg, from_label, to_leg, outcome, rules").eq("task_id", workflowId).order("created_at");
      const built = buildTaskArtifact({
        id: workflowId, request: workflow.objective, origin: (workflow.origin as { source_model?: string; verdict?: string } | null) ?? null, completedAt: iso(),
        legs: legs.map((l) => ({ leg_no: l.leg_no, tool: tools.get(l.tool_id)?.name ?? "tool", status: l.status, artifact: l.final_artifact })),
        finalLeg: state.final_leg,
        handoffs: ((hand ?? []) as { from_leg: number | null; from_label: string; to_leg: number; outcome: string; rules: string[] }[])
          .map((h): TaskArtifactHandoff => ({ from: h.from_leg, from_label: h.from_label, to: h.to_leg, outcome: h.outcome, rules: h.rules ?? [] })),
      });
      if (built.ok && validateArtifact(built.artifact, "task").ok) finalArtifact = built.artifact;
      else state = { ...state, status: "failed", final_output: null, final_leg: null, stop_reason: `Every step finished, but the Task's final result could not be verified (${built.ok ? "the artifact is invalid" : built.reason}).` };
    }
    const terminal = state.status === "completed" || state.status === "failed" || state.status === "cancelled";
    const { data: wrote } = await admin.from("outer_control_workflows")
      .update({
        status: state.status, summary: state.summary, current_leg: state.current_leg, steps_total: state.steps_total, steps_done: state.steps_done,
        final_output: state.final_output, final_leg: state.final_leg, failed_leg: state.failed_leg, stop_reason: state.stop_reason, final_artifact: finalArtifact,
        updated_at: iso(), ...(terminal ? { finished_at: iso() } : {}),
      })
      .eq("id", workflowId).in("status", ["running", "awaiting_human"]).select("id").maybeSingle();
    if (wrote && (state.status === "failed" || state.status === "cancelled")) await refundWorkflowCredit(admin, workflowId);
    // A chain that stopped on a failure or a rule tells the owner once, and says which step and why.
    if (wrote && state.status === "failed" && workflow.kind === "chain") {
      try {
        await sendCriticalAlert(admin, workflow.user_id, {
          event: "outer_control_session_failed",
          summary: `An Outer Control task stopped: "${await alertSnippet(admin, { user_id: workflow.user_id, api_key_id: legs[0]?.api_key_id ?? null, objective: workflow.objective })}". ${(state.stop_reason ?? state.summary).slice(0, 220)}`,
        });
      } catch { /* the dashboard still shows it */ }
    }
  }
  return started;
}

/** Drives one session, then lets its workflow start whatever was waiting for it. */
export async function driveSession(admin: AnyAdmin, sessionId: string, deps: SessionDeps = defaultSessionDeps(), depth = 0) {
  const result = await advanceSession(admin, sessionId, deps);
  const { data } = await admin.from("outer_control_sessions").select("workflow_id").eq("id", sessionId).maybeSingle();
  const workflowId = (data as { workflow_id?: string | null } | null)?.workflow_id;
  if (workflowId && depth < MAX_LEGS) {
    const started = await progressWorkflow(admin, workflowId);
    await Promise.all(started.map((id) => driveSession(admin, id, deps, depth + 1)));
  }
  return result;
}

/** After a person's decision changed a session: keep driving it, or let its workflow react to it ending. */
export async function continueSession(admin: AnyAdmin, sessionId: string, deps: SessionDeps = defaultSessionDeps()) {
  const { data } = await admin.from("outer_control_sessions").select("status, workflow_id").eq("id", sessionId).maybeSingle();
  const row = data as { status?: string; workflow_id?: string | null } | null;
  if (!row) return;
  if (row.status === "running") { await driveSession(admin, sessionId, deps); return; }
  if (row.workflow_id) await Promise.all((await progressWorkflow(admin, row.workflow_id)).map((id) => driveSession(admin, id, deps)));
}

/** A person answered or decided: resume the session and keep going. */
export async function resumeAndDrive(admin: AnyAdmin, sessionId: string, deps: SessionDeps = defaultSessionDeps()) {
  const r = await resumeSession(admin, sessionId, deps);
  await continueSession(admin, sessionId, deps);
  return r;
}

export type StartWorkflowResult =
  | { ok: true; workflowId: string; running: string[]; legIds: string[] }
  | { ok: false; code: string; message: string };

export async function startWorkflow(
  admin: AnyAdmin, userId: string,
  input: { objective: unknown; context: unknown; legs: unknown; api_key_id?: unknown; max_steps?: unknown; kind?: TaskKind; origin?: TaskOrigin | null },
): Promise<StartWorkflowResult> {
  const objective = typeof input.objective === "string" ? input.objective.trim() : "";
  const context = typeof input.context === "string" && input.context.trim() ? input.context.trim() : null;
  if (!objective || objective.length > 2000) return { ok: false, code: "invalid_objective", message: "Describe the overall goal (2000 characters or fewer)." };
  if (context && context.length > 8000) return { ok: false, code: "invalid_context", message: "The context is limited to 8000 characters." };
  const checked = validateLegs(input.legs);
  if (!checked.ok) return { ok: false, code: "invalid_steps", message: checked.message };

  const toolIds = [...new Set(checked.legs.flatMap((l) => [l.tool_id, ...(l.fallback_tool_id ? [l.fallback_tool_id] : [])]))];
  const { data: tools } = await admin.from("external_tools").select("id, enabled").eq("user_id", userId).in("id", toolIds);
  const usable = new Map(((tools ?? []) as { id: string; enabled: boolean }[]).map((t) => [t.id, t.enabled]));
  for (const l of checked.legs) {
    if (!usable.get(l.tool_id)) return { ok: false, code: "tool_unavailable", message: `Step ${l.leg_no}: that tool was not found or is disabled.` };
    if (l.fallback_tool_id && !usable.get(l.fallback_tool_id)) return { ok: false, code: "tool_unavailable", message: `Step ${l.leg_no}: the fallback tool was not found or is disabled.` };
  }

  let apiKeyId: string | null = null;
  if (input.api_key_id) {
    const { data: key } = await admin.from("api_keys").select("id, revoked_at").eq("id", String(input.api_key_id)).eq("user_id", userId).maybeSingle();
    if (!key || (key as { revoked_at: string | null }).revoked_at) return { ok: false, code: "invalid_key", message: "That API key is not available." };
    apiKeyId = (key as { id: string }).id;
  }
  const maxSteps = Math.max(1, Math.min(20, Number.isFinite(Number(input.max_steps)) ? Math.trunc(Number(input.max_steps)) : 5));

  const { data: wf, error } = await admin.from("outer_control_workflows")
    .insert({
      user_id: userId, api_key_id: apiKeyId, objective, context, status: "running", kind: input.kind ?? "chain",
      origin: input.origin ?? null, steps_total: checked.legs.length, current_leg: 1,
    }).select("id").maybeSingle();
  if (error || !wf) return { ok: false, code: "internal_error", message: "Could not start the workflow." };
  const workflowId = (wf as { id: string }).id;

  // A step that an error branch watches must end (not wait for a person), or the branch could never run.
  const watched = new Set(checked.legs.filter((l) => l.condition?.op === "dep_failed").map((l) => l.condition!.leg));
  const rows = checked.legs.map((l) => ({
    user_id: userId, tool_id: l.tool_id, api_key_id: apiKeyId, workflow_id: workflowId, leg_no: l.leg_no, depends_on: l.depends_on,
    fallback_tool_id: l.fallback_tool_id, handoff_mode: l.handoff, objective: l.instruction, context: l.depends_on.length ? null : context, max_steps: maxSteps,
    status: l.depends_on.length ? "queued" : "running", condition: l.condition,
    on_failure: l.on_failure ?? (watched.has(l.leg_no) ? "reject" : "handoff"),
  }));
  const { data: made, error: legErr } = await admin.from("outer_control_sessions").insert(rows).select("id, status, leg_no");
  if (legErr || !made) {
    await admin.from("outer_control_workflows").update({ status: "failed", summary: "The steps could not be created.", finished_at: iso() }).eq("id", workflowId);
    return { ok: false, code: "internal_error", message: "Could not create the workflow's steps." };
  }
  const madeRows = made as { id: string; status: string; leg_no: number }[];
  return {
    ok: true, workflowId, running: madeRows.filter((r) => r.status === "running").map((r) => r.id),
    legIds: [...madeRows].sort((a, b) => a.leg_no - b.leg_no).map((r) => r.id),
  };
}

/**
 * A Task of several steps in sequence: step N waits for step N-1 and receives its controlled result.
 * `steps` is `[{ tool_id, instruction, fallback_tool_id?, on_failure? }]`; the Task stops at the first step
 * that fails or breaks a rule.
 */
export async function startTask(
  admin: AnyAdmin, userId: string,
  input: { request: unknown; context: unknown; steps: unknown; api_key_id?: unknown; max_steps?: unknown; origin?: TaskOrigin | null },
): Promise<StartWorkflowResult> {
  const chain = chainLegs(input.steps);
  if (!chain.ok) return { ok: false, code: "invalid_steps", message: chain.message };
  return startWorkflow(admin, userId, {
    objective: input.request, context: input.context, legs: chain.legs, api_key_id: input.api_key_id, max_steps: input.max_steps,
    kind: "chain", origin: input.origin ?? null,
  });
}

/** Cancels every open step and the workflow itself. */
export async function cancelWorkflow(admin: AnyAdmin, workflowId: string, userId: string): Promise<void> {
  await admin.from("outer_control_sessions")
    .update({ status: "cancelled", stop_reason: "Cancelled by the owner.", finished_at: iso(), updated_at: iso(), pending_kind: null, pending_approval_id: null, lease_until: null, handoff: null })
    .eq("workflow_id", workflowId).eq("user_id", userId).in("status", ["queued", "running", "awaiting_human"]);
  await admin.from("outer_control_workflows")
    .update({ status: "cancelled", summary: "Cancelled by the owner.", finished_at: iso(), updated_at: iso() })
    .eq("id", workflowId).eq("user_id", userId).in("status", ["running", "awaiting_human"]);
  await refundWorkflowCredit(admin, workflowId);
}

export const MAX_FOLLOW_UP_CHARS = 5000;

/** What the tool is told about the earlier exchange: the question and the controlled answer, never the raw reply. */
export function followUpContext(prev: { objective: string; answer: string; toolName: string }): string {
  const answer = prev.answer.length > MAX_FOLLOW_UP_CHARS ? `${prev.answer.slice(0, MAX_FOLLOW_UP_CHARS)}\n[Earlier answer shortened.]` : prev.answer;
  return [
    `Earlier in this conversation with ${prev.toolName}.`,
    `The question was: ${prev.objective}`,
    `The controlled answer (already checked against the account's rules) was:`,
    answer,
    `Answer the new request below, building on that answer.`,
  ].join("\n");
}

export type FollowUpResult = StartWorkflowResult | { ok: false; code: "not_found" | "not_completed" | "invalid_instruction"; message: string };

/**
 * A follow-up: a new request to the same tool, based on the controlled answer of a session that finished. It starts a new
 * one-step Task, so it goes through the same gate, rules and final artifact as any other. Only the official result of the
 * earlier session is passed on; a session that did not complete, or whose result is not valid, cannot be followed up.
 */
export async function startFollowUp(admin: AnyAdmin, userId: string, input: { session_id: unknown; instruction: unknown }): Promise<FollowUpResult> {
  const instruction = typeof input.instruction === "string" ? input.instruction.trim() : "";
  if (!instruction || instruction.length > 2000) return { ok: false, code: "invalid_instruction", message: "Write the follow-up request (2000 characters or fewer)." };
  const { data } = await admin.from("outer_control_sessions")
    .select("id, status, tool_id, api_key_id, objective, final_artifact").eq("id", String(input.session_id ?? "")).eq("user_id", userId).maybeSingle();
  const prev = data as { id: string; status: string; tool_id: string; api_key_id: string | null; objective: string; final_artifact: unknown } | null;
  if (!prev) return { ok: false, code: "not_found", message: "Session not found." };
  const answer = prev.status === "completed" ? officialOutput(prev.final_artifact, "session") : null;
  if (answer === null) return { ok: false, code: "not_completed", message: "Only a completed session with a valid final result can be followed up." };
  const { data: tool } = await admin.from("external_tools").select("id, name, enabled, removed_at").eq("id", prev.tool_id).eq("user_id", userId).maybeSingle();
  const t = tool as { id: string; name: string; enabled: boolean; removed_at: string | null } | null;
  if (!t || !t.enabled || t.removed_at) return { ok: false, code: "not_found", message: "That tool was removed or is switched off." };
  return startWorkflow(admin, userId, {
    objective: instruction, context: followUpContext({ objective: prev.objective, answer, toolName: t.name }),
    api_key_id: prev.api_key_id, kind: "single", legs: [{ tool_id: t.id, instruction, on_failure: "handoff" }],
  });
}

export { isLegOpen };
