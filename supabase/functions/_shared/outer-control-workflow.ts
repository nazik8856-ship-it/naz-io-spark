// Outer Control (active): runs several tools at once as one workflow. Each leg is an
// ordinary session, so everything a session does (gate, rules, recovery, hand-off) applies
// to every leg unchanged. This file only starts the legs, lets waiting legs begin once what
// they depend on has finished (handing them the results), and keeps the workflow's status.
import { advanceSession, defaultSessionDeps, resumeSession, type SessionDeps } from "./outer-control-session.ts";
import {
  buildLegContext, isLegOpen, legReadiness, MAX_LEGS, rollupStatus, validateLegs, type LegState,
} from "./outer-control-workflow-plan.ts";

// deno-lint-ignore no-explicit-any
type AnyAdmin = any;

const iso = () => new Date().toISOString();

type LegRow = LegState & { id: string; depends_on: number[]; context: string | null };

async function loadLegs(admin: AnyAdmin, workflowId: string): Promise<LegRow[]> {
  const { data } = await admin.from("outer_control_sessions")
    .select("id, leg_no, status, depends_on, final_output, stop_reason, context, condition").eq("workflow_id", workflowId).order("leg_no");
  return ((data ?? []) as LegRow[]).map((l) => ({ ...l, depends_on: l.depends_on ?? [] }));
}

/**
 * Starts legs whose dependencies are done, cancels legs that can never run, and updates the
 * workflow's status. Returns the sessions it just started so the caller can drive them.
 */
export async function progressWorkflow(admin: AnyAdmin, workflowId: string): Promise<string[]> {
  const started: string[] = [];
  const { data: wf } = await admin.from("outer_control_workflows").select("id, context, status").eq("id", workflowId).maybeSingle();
  if (!wf) return started;
  const workflow = wf as { id: string; context: string | null; status: string };

  let legs = await loadLegs(admin, workflowId);
  for (let round = 0; round <= MAX_LEGS; round++) {
    let changed = false;
    for (const leg of legs.filter((l) => l.status === "queued")) {
      const verdict = legReadiness(leg, legs);
      if (verdict === "ready") {
        const deps = legs.filter((d) => leg.depends_on.includes(d.leg_no));
        const { data: moved } = await admin.from("outer_control_sessions")
          .update({ status: "running", context: buildLegContext(workflow.context, deps), updated_at: iso() })
          .eq("id", leg.id).eq("status", "queued").select("id").maybeSingle();
        if (moved) { started.push(leg.id); changed = true; }
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
    const roll = rollupStatus(legs);
    const terminal = roll.status === "completed" || roll.status === "failed";
    await admin.from("outer_control_workflows")
      .update({ status: roll.status, summary: roll.summary, updated_at: iso(), ...(terminal ? { finished_at: iso() } : {}) })
      .eq("id", workflowId).in("status", ["running", "awaiting_human"]);
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
  | { ok: true; workflowId: string; running: string[] }
  | { ok: false; code: string; message: string };

export async function startWorkflow(
  admin: AnyAdmin, userId: string,
  input: { objective: unknown; context: unknown; legs: unknown; api_key_id?: unknown; max_steps?: unknown },
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
    .insert({ user_id: userId, api_key_id: apiKeyId, objective, context, status: "running" }).select("id").maybeSingle();
  if (error || !wf) return { ok: false, code: "internal_error", message: "Could not start the workflow." };
  const workflowId = (wf as { id: string }).id;

  // A step that an error branch watches must end (not wait for a person), or the branch could never run.
  const watched = new Set(checked.legs.filter((l) => l.condition?.op === "dep_failed").map((l) => l.condition!.leg));
  const rows = checked.legs.map((l) => ({
    user_id: userId, tool_id: l.tool_id, api_key_id: apiKeyId, workflow_id: workflowId, leg_no: l.leg_no, depends_on: l.depends_on,
    fallback_tool_id: l.fallback_tool_id, objective: l.instruction, context: l.depends_on.length ? null : context, max_steps: maxSteps,
    status: l.depends_on.length ? "queued" : "running", condition: l.condition,
    on_failure: l.on_failure ?? (watched.has(l.leg_no) ? "reject" : "handoff"),
  }));
  const { data: made, error: legErr } = await admin.from("outer_control_sessions").insert(rows).select("id, status");
  if (legErr || !made) {
    await admin.from("outer_control_workflows").update({ status: "failed", summary: "The steps could not be created.", finished_at: iso() }).eq("id", workflowId);
    return { ok: false, code: "internal_error", message: "Could not create the workflow's steps." };
  }
  return { ok: true, workflowId, running: (made as { id: string; status: string }[]).filter((r) => r.status === "running").map((r) => r.id) };
}

/** Cancels every open step and the workflow itself. */
export async function cancelWorkflow(admin: AnyAdmin, workflowId: string, userId: string): Promise<void> {
  await admin.from("outer_control_sessions")
    .update({ status: "cancelled", stop_reason: "Cancelled by the owner.", finished_at: iso(), updated_at: iso(), pending_kind: null, pending_approval_id: null, lease_until: null, handoff: null })
    .eq("workflow_id", workflowId).eq("user_id", userId).in("status", ["queued", "running", "awaiting_human"]);
  await admin.from("outer_control_workflows")
    .update({ status: "cancelled", summary: "Cancelled by the owner.", finished_at: iso(), updated_at: iso() })
    .eq("id", workflowId).eq("user_id", userId).in("status", ["running", "awaiting_human"]);
}

export { isLegOpen };
