// Compromise containment (general data security, task 6; docs/compromise-containment.md).
//
// If one outside tool or path turns out to be unsafe, NazAI stops THAT path and nothing else: the tool is suspended, its work in
// flight is closed with a reason, nothing new can contact it, its first-contact approval is taken back, and a person decides when
// it comes back. The rest of the account (other tools, Tasks that do not depend on it, the website, the agents) keeps running.
//
// Unsafe signals, all of them already written as signed security evidence (security-evidence.ts), so the decision rests on the same
// record an auditor reads:
//   outbound_blocked  NazAI's own outbound guard refused a request to this tool (a credential would have gone to the wrong host, or the
//                     address left the allowlist): suspended at once.
//   content_held      the tool's reply tried to steer NazAI (external-content.ts): suspended on the third in 24 hours.
//
// Suspending is a hard state, not a warning: a suspended tool's sessions end ("stopped"), a new session aimed at it ends at its first
// step, the connection test skips it, and resuming needs the owner's own action (resume_tool) and then a fresh first-contact approval.
import { recordEvidence, type EvidenceActor } from "./security-evidence.ts";
import { stopToolWork } from "./outer-control-tools.ts";

// deno-lint-ignore no-explicit-any
type AnyAdmin = any;
const iso = (ms: number) => new Date(ms).toISOString();

/** Held replies from one tool, inside the window, that suspend it. */
export const SUSPEND_AFTER_HELD = 3;
export const CONTAINMENT_WINDOW_MS = 24 * 60 * 60_000;

export type UnsafeCounts = { held: number; blocked: number };
export type Containment = { suspend: boolean; reason: string | null; trigger: "outbound_blocked" | "content_held" | null };

/** Pure: what the counts say. An outbound refusal is enough on its own; held replies need to repeat. */
export function containmentDecision(c: UnsafeCounts): Containment {
  if (c.blocked >= 1) return { suspend: true, trigger: "outbound_blocked", reason: "NazAI refused to send a request to this tool: it would have sent a credential to a host it does not belong to, or left the allowed destinations." };
  if (c.held >= SUSPEND_AFTER_HELD) return { suspend: true, trigger: "content_held", reason: `${c.held} replies from this tool tried to give NazAI instructions and were held (3 in 24 hours stops the tool).` };
  return { suspend: false, trigger: null, reason: null };
}

/** The unsafe signals recorded for one tool since the later of: the start of the window, the last time the owner resumed it. */
export async function countUnsafeSignals(admin: AnyAdmin, userId: string, toolId: string, nowMs: number, resumedAt?: string | null): Promise<UnsafeCounts> {
  const windowStart = nowMs - CONTAINMENT_WINDOW_MS;
  const since = iso(Math.max(windowStart, resumedAt ? Date.parse(resumedAt) || 0 : 0));
  const count = async (kind: string) => {
    const { count: n } = await admin.from("security_evidence").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("kind", kind).eq("subject->>tool", toolId).gte("created_at", since);
    return n ?? 0;
  };
  return { held: await count("content_held"), blocked: await count("outbound_blocked") };
}

export type SuspendResult = { suspended: boolean; already: boolean; workflowIds: string[] };

export type SuspendOptions = {
  userId: string; toolId: string; toolName: string; reason: string; trigger: string;
  /** The session that raised the signal: the caller finishes it itself. */
  exceptSessionId?: string | null;
  actor?: EvidenceActor; actorId?: string | null;
  now?: () => number;
  /** Told once, when the tool is suspended (an alert to the owner). */
  onSuspended?: (info: { userId: string; toolName: string; reason: string }) => Promise<void> | void;
};

/**
 * Suspends one tool. The first writer wins (the update only applies while the tool is not suspended), so two sessions that raise the
 * same signal at once suspend it once, record it once and alert once.
 */
export async function suspendTool(admin: AnyAdmin, o: SuspendOptions): Promise<SuspendResult> {
  const now = (o.now ?? Date.now)();
  const reason = o.reason.slice(0, 300);
  const { data: changed } = await admin.from("external_tools")
    .update({ suspended_at: iso(now), suspended_reason: reason, approved_at: null, updated_at: iso(now) })
    .eq("id", o.toolId).eq("user_id", o.userId).is("suspended_at", null).is("removed_at", null).is("agent_id", null).select("id");
  if (!Array.isArray(changed) || changed.length === 0) return { suspended: false, already: true, workflowIds: [] };

  const stopped = await stopToolWork(admin, o.userId, o.toolId, { status: "stopped", reason: `The tool "${o.toolName}" was suspended: ${reason}`.slice(0, 500), except: o.exceptSessionId ?? null });
  await recordEvidence(admin, {
    userId: o.userId, kind: "containment", actor: o.actor ?? "system", actorId: o.actorId ?? null,
    subject: { tool: o.toolId, action: "suspend", trigger: o.trigger, sessions_stopped: stopped.sessionIds.length }, verdict: "suspended",
  });
  try { await o.onSuspended?.({ userId: o.userId, toolName: o.toolName, reason }); } catch { /* the alert must never undo the stop */ }
  return { suspended: true, already: false, workflowIds: stopped.workflowIds };
}

/** Looks at the recorded signals for a tool and suspends it when they say so. Call it right after the signal's evidence is written. */
export async function containIfUnsafe(admin: AnyAdmin, o: Omit<SuspendOptions, "reason" | "trigger"> & { resumedAt?: string | null }): Promise<(SuspendResult & { reason: string | null }) | null> {
  const now = (o.now ?? Date.now)();
  const verdict = containmentDecision(await countUnsafeSignals(admin, o.userId, o.toolId, now, o.resumedAt));
  if (!verdict.suspend || !verdict.reason || !verdict.trigger) return null;
  const r = await suspendTool(admin, { ...o, reason: verdict.reason, trigger: verdict.trigger });
  return { ...r, reason: verdict.reason };
}

export type ResumeResult = { ok: true; message: string } | { ok: false; code: string; message: string; status: number };

/**
 * The owner brings a suspended tool back. Its first-contact approval stays taken back, so the next contact needs a fresh approval, and
 * the count of unsafe signals starts over (resumed_at). Recorded as evidence with the owner as the actor.
 */
export async function resumeTool(admin: AnyAdmin, accountId: string, toolId: string, now: () => number = Date.now): Promise<ResumeResult> {
  const at = iso(now());
  const { data: changed } = await admin.from("external_tools")
    .update({ suspended_at: null, suspended_reason: null, resumed_at: at, last_error: null, updated_at: at })
    .eq("id", toolId).eq("user_id", accountId).is("removed_at", null).not("suspended_at", "is", null).select("id");
  if (!Array.isArray(changed) || changed.length === 0) return { ok: false, code: "not_suspended", message: "That tool is not suspended.", status: 409 };
  await recordEvidence(admin, { userId: accountId, kind: "containment", actor: "user", actorId: accountId, subject: { tool: toolId, action: "resume" }, verdict: "resumed" });
  return { ok: true, message: "Tool resumed. Its next contact needs a fresh first-contact approval." };
}
