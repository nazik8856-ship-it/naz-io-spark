// Outer Control (active): drives one session against one external tool.
//
//   gate the contact -> build a structured request (objective, masked context,
//   active rules) -> call the tool -> read the reply -> evaluate it with the
//   same text gate the foundation uses -> decide what happens next.
//
// A person is involved only when a reply needs approval, the tool asks for
// information, the contact itself needs approval, or the tool is new. Everything
// else continues by itself. The driver is resumable: state lives in the session
// row, so outer-control-session-sweep can pick a session up after a pause.
import { checkKillSwitches, createPendingApproval, runControlGate } from "./control-gate.ts";
import { extractExternalText } from "./outer-control-intake.ts";
import { evaluateExternalText, textSafeToStore, TEXT_REVIEW_ACTION_TYPE } from "./outer-control-text-review.ts";
import { loadSafetyRules, scanWithRules, type SafetyRule } from "./safety-scanner.ts";
import { ruleMatchesAction, selectRulesForEntity } from "./rule-matching.ts";
import { sha256Hex } from "./api-key-auth.ts";
import { validateOutboundUrl } from "./url-safety.ts";
import { sendCriticalAlert } from "./critical-alerts.ts";
import { buildToolRequest, parseToolReply, type RuleLine, type ToolFormat } from "./outer-control-tool-request.ts";
import { decideNextAction, DEFAULT_MAX_FAILURES, SESSION_TIME_LIMIT_MS } from "./outer-control-next-action.ts";
import { loadMemory, recordMemory, renderMemory } from "./outer-control-memory.ts";
import { buildWorkingMemory, decisionRecord, factsFor, planNextAction, think, type MemoryRow, type RequestChanges } from "./outer-control-brain.ts";
import { planRequest, preflightRequest } from "./outer-control-planner.ts";
import { classifyFailure, MAX_INLINE_DELAY_MS, parseRetryAfter, truncationOf, type FailureClass } from "./outer-control-recovery.ts";
import { buildHandoff, decodeChoice, type HandoffKind } from "./outer-control-handoff.ts";

// deno-lint-ignore no-explicit-any
type AnyAdmin = any;

export type SessionRow = {
  id: string; user_id: string; tool_id: string; api_key_id: string | null;
  objective: string; context: string | null; status: string;
  step_count: number; max_steps: number; max_retries: number; retries_used: number; failures_used: number;
  correction: string | null; history: { step: number; text: string }[]; next_input: string | null;
  final_output: string | null; stop_reason: string | null;
  pending_kind: "first_contact" | "contact_gate" | "reply_approval" | "question" | "handoff" | null;
  pending_approval_id: string | null; pending_step_no: number | null;
  pending_question: string | null; pending_answer: string | null;
  gate_cleared_step: number; lease_until: string | null; started_at: string; updated_at: string; waited_ms: number;
  workflow_id: string | null; leg_no: number | null; fallback_tool_id: string | null; fallback_used: boolean;
  on_failure: "handoff" | "reject"; resume_at: string | null; attempt_base: number;
  request_mods_used: number; request_mods: RequestChanges | null;
};

export type ToolRow = {
  id: string; user_id: string; name: string; endpoint_url: string; request_format: ToolFormat; model: string | null;
  auth_header: string; auth_scheme: string; credentials_secret_id: string | null; enabled: boolean; approved_at: string | null;
};

export type SessionDeps = {
  fetchImpl: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  validateUrl: (url: string) => Promise<{ ok: boolean; reason: string }>;
  /** How long one invocation may keep stepping before handing back to the sweep. */
  budgetMs: number;
  toolTimeoutMs: number;
};

export const defaultSessionDeps = (): SessionDeps => ({
  fetchImpl: fetch,
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  validateUrl: validateOutboundUrl,
  budgetMs: 100_000,
  toolTimeoutMs: 60_000,
});

const LEASE_MS = 150_000;
const MAX_ANSWER_CHARS = 2000;
const MAX_EDIT_CHARS = 8000;
export const APPROVED_STATUSES = new Set(["approved", "auto_approved"]);
const PENDING_STATUSES = new Set(["pending"]);
const WITHHELD = "[content withheld";

const iso = (ms: number) => new Date(ms).toISOString();

const CONTRACT_STATUSES = new Set(["done", "continue", "need_info"]);

/**
 * A generic JSON tool answers in the shape we asked for ({status, answer, question?}),
 * or with a single obvious text field. Provider-shaped bodies go through the shared intake.
 */
export function readGenericPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const o = payload as Record<string, unknown>;
  if (typeof o.status === "string" && CONTRACT_STATUSES.has(o.status)) return JSON.stringify(o);
  for (const key of ["answer", "response", "text", "output", "reply"]) {
    if (typeof o[key] === "string" && (o[key] as string).trim()) return o[key] as string;
  }
  return null;
}

/** Writes only while the session is still open, so a cancelled or finished session is never revived by a late write. */
async function patch(admin: AnyAdmin, id: string, fields: Record<string, unknown>, deps: SessionDeps) {
  await admin.from("outer_control_sessions").update({ ...fields, updated_at: iso(deps.now()) }).eq("id", id).in("status", ["running", "awaiting_human"]);
}

/** Time the session has actually been working: wall clock minus the time spent waiting for a person. */
function activeMs(s: SessionRow, deps: SessionDeps): number {
  return Math.max(0, deps.now() - Date.parse(s.started_at) - (s.waited_ms ?? 0));
}

/** The extra column values to write when a paused session resumes: the wait is not counted. */
function waited(s: SessionRow, deps: SessionDeps): { waited_ms: number } {
  const since = Date.parse(s.updated_at);
  return { waited_ms: (s.waited_ms ?? 0) + (Number.isFinite(since) ? Math.max(0, deps.now() - since) : 0) };
}

async function finish(admin: AnyAdmin, s: SessionRow, status: string, stop_reason: string, deps: SessionDeps, extra: Record<string, unknown> = {}) {
  await patch(admin, s.id, { status, stop_reason, finished_at: iso(deps.now()), lease_until: null, pending_kind: null, pending_approval_id: null, ...extra }, deps);
  if (status === "failed") await notifyFailure(admin, s, stop_reason);
}

/** Rule names and what a match does, in the same terms GET /control-api/v1/criteria uses. */
export async function loadRuleLines(admin: AnyAdmin, userId: string, apiKeyId: string | null, toolName: string): Promise<RuleLine[]> {
  const lines: RuleLine[] = [];
  const provider = `tool:${toolName}`.slice(0, 80);
  try {
    const { data } = await admin.from("hard_rules")
      .select("id, rule_text, action_type_pattern, effect, provider, enabled, shadow_mode, agent_id, api_key_id")
      .eq("user_id", userId).eq("enabled", true);
    const scoped = selectRulesForEntity((data ?? []) as Record<string, unknown>[] as never[], apiKeyId ? "api_key" : null, apiKeyId) as unknown as
      { rule_text: string; effect: string; action_type_pattern: string; provider: string | null; shadow_mode?: boolean }[];
    for (const r of scoped) {
      if (r.shadow_mode) continue;
      if (!ruleMatchesAction({ action_type_pattern: r.action_type_pattern, provider: r.provider }, TEXT_REVIEW_ACTION_TYPE, provider)) continue;
      lines.push({ name: String(r.rule_text).slice(0, 160), action: r.effect === "always_block" ? "block" : "approval" });
    }
  } catch { /* hard rules are enrichment for the prompt; the gate still enforces them */ }
  const safety = await loadSafetyRules(admin, userId, null, apiKeyId);
  for (const r of safety) {
    if (r.shadow_mode) continue;
    const removable = r.severity === "block" && (r.redact === true || r.category === "secrets" || r.category === "pii");
    lines.push({ name: r.name, action: r.severity === "require_approval" ? "approval" : removable ? "remove_text" : "block" });
  }
  return lines;
}

/**
 * Whether an account rule stands between Outer Control and this tool, without creating any
 * approval or decision record. Used by the connection test, which sends a ping outside a session.
 * Returns a sentence for the person, or null when nothing stops the contact.
 */
export async function contactRuleStopping(admin: AnyAdmin, userId: string, toolName: string): Promise<string | null> {
  const { data } = await admin.from("hard_rules")
    .select("id, rule_text, action_type_pattern, effect, provider, enabled, shadow_mode, agent_id, api_key_id")
    .eq("user_id", userId).eq("enabled", true);
  const scoped = selectRulesForEntity((data ?? []) as Record<string, unknown>[] as never[], null, null) as unknown as
    { rule_text: string; effect: string; action_type_pattern: string; provider: string | null; shadow_mode?: boolean }[];
  for (const r of scoped) {
    if (r.shadow_mode) continue;
    if (!ruleMatchesAction({ action_type_pattern: r.action_type_pattern, provider: r.provider }, "outer_control_contact", toolName)) continue;
    return r.effect === "always_block"
      ? `The rule "${String(r.rule_text).slice(0, 120)}" blocks contacting this tool.`
      : `The rule "${String(r.rule_text).slice(0, 120)}" requires approval for every contact, so no test message was sent. Start a session instead.`;
  }
  return null;
}

/** Masks anything the rules would remove before text leaves the platform. */
export function maskForSend(rules: SafetyRule[], text: string | null | undefined): string {
  if (!text) return "";
  const scan = scanWithRules(rules.filter((r) => !r.shadow_mode), text, "");
  return textSafeToStore(text, scan.matches);
}

async function notifyQuestion(admin: AnyAdmin, userId: string, toolName: string, question: string) {
  try {
    await sendCriticalAlert(admin, userId, {
      event: "agent_clarification_needed",
      summary: `Outer Control paused a session with "${toolName}": it needs your answer to continue. Question: ${question.slice(0, 300)}`,
    });
  } catch { /* the dashboard card still shows it */ }
}

/** A short piece of the objective that is safe to put in an alert (anything the rules would remove is masked). */
async function alertSnippet(admin: AnyAdmin, s: SessionRow): Promise<string> {
  try { return maskForSend(await loadSafetyRules(admin, s.user_id, null, s.api_key_id), s.objective).slice(0, 80); }
  catch { return "(objective hidden)"; }
}

async function notifyFailure(admin: AnyAdmin, s: SessionRow, reason: string) {
  try {
    await sendCriticalAlert(admin, s.user_id, {
      event: "outer_control_session_failed",
      summary: `An Outer Control session failed: "${await alertSnippet(admin, s)}". ${reason.slice(0, 200)}`,
    });
  } catch { /* the dashboard card still shows it */ }
}

async function pauseForHandoff(
  admin: AnyAdmin, s: SessionRow, tool: ToolRow, stepNo: number, deps: SessionDeps,
  input: { kind: HandoffKind; ruleNames: string[]; failure: FailureClass | null },
) {
  const memory = await loadMemory(admin, s);
  const handoff = buildHandoff({
    kind: input.kind, stepNo, toolName: tool.name, ruleNames: input.ruleNames, failure: input.failure,
    attempts: s.attempt_base + s.retries_used + s.failures_used + 1, memory,
  });
  if (input.kind === "rule_exhausted") {
    // The last rejected reply (stored with sensitive text masked) is the starting point for "write the reply myself".
    const { data: last } = await admin.from("outer_control_session_steps").select("reply_text")
      .eq("session_id", s.id).eq("step_no", stepNo).order("attempt", { ascending: false }).limit(1).maybeSingle();
    handoff.draft = ((last as { reply_text: string | null } | null)?.reply_text ?? null)?.slice(0, MAX_EDIT_CHARS) ?? null;
  }
  await patch(admin, s.id, {
    status: "awaiting_human", pending_kind: "handoff", handoff, pending_answer: null, pending_approval_id: null,
    pending_step_no: stepNo, lease_until: null,
  }, deps);
  try {
    await sendCriticalAlert(admin, s.user_id, {
      event: "agent_clarification_needed",
      summary: `Outer Control needs a decision on "${await alertSnippet(admin, s)}": ${handoff.title}. Recommended: ${handoff.options.find((o) => o.id === handoff.recommended)?.label}.`,
    });
  } catch { /* the dashboard card still shows it */ }
}

type Accept = { text: string; toolStatus: "done" | "continue" | "need_info" | null };

/** A reply that is usable (allow, cleaned modify, or human-approved) moves the session forward. */
async function acceptReply(admin: AnyAdmin, s: SessionRow, tool: ToolRow, stepNo: number, a: Accept, deps: SessionDeps): Promise<void> {
  const action = decideNextAction({
    verdict: "allow", toolStatus: a.toolStatus, stepNo, maxSteps: s.max_steps, retriesUsed: 0, maxRetries: s.max_retries,
    failuresUsed: 0, maxFailures: DEFAULT_MAX_FAILURES, elapsedMs: activeMs(s, deps), maxMs: SESSION_TIME_LIMIT_MS,
  });
  const history = [...(s.history ?? []), ...(a.toolStatus === "need_info" ? [] : [{ step: stepNo, text: a.text }])];
  const advance = { step_count: stepNo, retries_used: 0, failures_used: 0, attempt_base: 0, correction: null, next_input: null, resume_at: null, handoff: null, request_mods_used: 0, request_mods: null, history };
  if (action.kind === "finish") return finish(admin, s, "completed", action.reason, deps, { ...advance, final_output: a.text });
  if (action.kind === "stop") return finish(admin, s, "stopped", action.reason, deps, { ...advance, final_output: history.at(-1)?.text ?? null });
  if (action.kind === "pause_human") {
    await patch(admin, s.id, { ...advance, status: "awaiting_human", pending_kind: "question", pending_question: a.text, pending_answer: null, pending_approval_id: null, pending_step_no: stepNo, lease_until: null }, deps);
    await notifyQuestion(admin, s.user_id, tool.name, a.text);
    return;
  }
  await patch(admin, s.id, { ...advance, status: "running" }, deps);
}

/**
 * Runs steps until the session finishes, pauses for a person, or the invocation's
 * time budget is spent (the sweep carries on after that).
 */
export async function advanceSession(admin: AnyAdmin, sessionId: string, deps: SessionDeps = defaultSessionDeps()): Promise<{ status: string; steps: number }> {
  const began = deps.now();
  // Claim: one driver per session at a time.
  const { data: claimed } = await admin.from("outer_control_sessions")
    .update({ lease_until: iso(began + LEASE_MS) })
    .eq("id", sessionId).eq("status", "running")
    .or(`lease_until.is.null,lease_until.lt.${iso(began)}`)
    .select("id").maybeSingle();
  if (!claimed) {
    const { data: cur } = await admin.from("outer_control_sessions").select("status").eq("id", sessionId).maybeSingle();
    return { status: (cur as { status?: string } | null)?.status ?? "missing", steps: 0 };
  }

  let steps = 0;
  try {
    while (deps.now() - began < deps.budgetMs) {
      const { data: row } = await admin.from("outer_control_sessions").select("*").eq("id", sessionId).maybeSingle();
      const s = row as SessionRow | null;
      if (!s) return { status: "missing", steps };
      if (s.status !== "running") return { status: s.status, steps };

      const { data: toolRow } = await admin.from("external_tools").select("*").eq("id", s.tool_id).maybeSingle();
      const tool = toolRow as ToolRow | null;
      if (!tool || !tool.enabled) { await finish(admin, s, "failed", "The tool was removed or disabled.", deps); return { status: "failed", steps }; }

      const stepNo = s.step_count + 1;
      const attempt = s.attempt_base + s.retries_used + s.failures_used + 1;
      // A back-off longer than one invocation is scheduled, not slept through.
      if (s.resume_at && Date.parse(s.resume_at) > deps.now()) return { status: "running", steps };

      // 1. A destination nobody has approved yet needs a person once.
      if (!tool.approved_at) {
        const host = (() => { try { return new URL(tool.endpoint_url).hostname; } catch { return tool.endpoint_url; } })();
        const outcome = await createPendingApproval(admin, {
          userId: s.user_id, decisionId: null, agentId: null, actionType: "outer_control_first_contact", provider: tool.name,
          description: `First contact with the external tool "${tool.name}" (${host}). Approving lets Outer Control contact it from now on.`,
          reason: "Outer Control has never contacted this destination before.", riskTier: "high", requiredApprovals: 1, origin: "external-api", apiKeyId: s.api_key_id,
        });
        if (outcome.autoResolved && outcome.resolution === "approved") {
          await admin.from("external_tools").update({ approved_at: iso(deps.now()), updated_at: iso(deps.now()) }).eq("id", tool.id);
          continue;
        }
        if (outcome.autoResolved) { await finish(admin, s, "rejected", "First contact with this tool was rejected.", deps); return { status: "rejected", steps }; }
        await patch(admin, s.id, { status: "awaiting_human", pending_kind: "first_contact", pending_approval_id: outcome.approvalId, pending_step_no: stepNo, lease_until: null }, deps);
        return { status: "awaiting_human", steps };
      }

      // 2. Kill switches.
      const kill = await checkKillSwitches(admin, s.user_id, null);
      if (kill.killed) { await finish(admin, s, "stopped", kill.reason ?? "A kill switch is active.", deps); return { status: "stopped", steps }; }

      // 3. The contact itself is an action the control gate governs.
      if (s.gate_cleared_step < stepNo) {
        const gate = await runControlGate(admin, {
          userId: s.user_id, actionType: "outer_control_contact", provider: tool.name,
          // Deliberately neutral: the objective is the user's own text and says nothing about the
          // contact itself. Putting it here made the safety scanner raise an approval for any
          // objective that merely mentions "refund" or "all customers".
          description: `Contact the external tool "${tool.name}" (session step ${stepNo})`,
          params: { tool_id: tool.id, session_id: s.id, step: stepNo },
          agentId: null, origin: "external-api", apiKeyId: s.api_key_id, isTest: false,
        });
        if (gate.verdict === "allow") {
          await patch(admin, s.id, { gate_cleared_step: stepNo }, deps);
          s.gate_cleared_step = stepNo;
        } else if (gate.verdict === "block") {
          await finish(admin, s, "rejected", gate.reason ?? "The control gate blocked this contact.", deps);
          return { status: "rejected", steps };
        } else {
          await patch(admin, s.id, { status: "awaiting_human", pending_kind: "contact_gate", pending_approval_id: gate.approvalId, pending_step_no: stepNo, lease_until: null }, deps);
          return { status: "awaiting_human", steps };
        }
      }

      // 4. The destination is checked again on every call (DNS can change).
      const urlCheck = await deps.validateUrl(tool.endpoint_url);
      if (!urlCheck.ok) { await finish(admin, s, "failed", `The tool's address is not allowed: ${urlCheck.reason}.`, deps); return { status: "failed", steps }; }

      // 5. Structured request: objective, masked context, active rules.
      const safetyRules = await loadSafetyRules(admin, s.user_id, null, s.api_key_id);
      const ruleLines = await loadRuleLines(admin, s.user_id, s.api_key_id, tool.name);
      const memory = await loadMemory(admin, s);
      // Plan first: a request that itself breaks a rule that cannot be worked around is not sent.
      const pre = preflightRequest(safetyRules, [s.objective, s.context, s.next_input]);
      if (!pre.ok) {
        const names = pre.names.join("; ");
        await recordMemory(admin, s, { stepNo, kind: "plan", ruleNames: pre.names, summary: `Step ${stepNo}: the request itself matches "${names}", so nothing was sent.` });
        await finish(admin, s, "rejected", `The request itself matches a blocking rule (${names}), so nothing was sent to the tool.`, deps);
        return { status: "rejected", steps };
      }
      const plan = planRequest({ rules: ruleLines, memory });
      const wm = buildWorkingMemory(memory as MemoryRow[]);
      const tightened = s.request_mods ?? null; // the request was tightened after repeated violations of a rule
      const request = buildToolRequest({
        format: tool.request_format, model: tool.model, objective: maskForSend(safetyRules, s.objective),
        context: tightened?.dropContext ? null : maskForSend(safetyRules, s.context), rules: plan.rules,
        history: tightened?.dropContext ? [] : (s.history ?? []), constraints: tightened?.constraints,
        correction: s.correction, answer: s.next_input ? maskForSend(safetyRules, s.next_input) : null, sessionId: s.id, step: stepNo,
        memory: renderMemory(memory).map((l) => maskForSend(safetyRules, l)), avoid: plan.avoid, omittedRules: plan.omitted,
      });

      // 6. Call the tool.
      let token = "";
      if (tool.credentials_secret_id) {
        const { data: secret } = await admin.rpc("read_integration_secret", { sid: tool.credentials_secret_id });
        token = String((secret as { token?: string } | null)?.token ?? "");
      }
      const headers: Record<string, string> = { "Content-Type": "application/json", ...request.headers };
      if (token) headers[tool.auth_header] = `${tool.auth_scheme}${token}`;
      if (tool.request_format === "anthropic_messages") headers["anthropic-version"] = "2023-06-01";

      let httpStatus: number | null = null;
      let rawText = "";
      let failed = false;
      let timedOut = false;
      let unreachable = false;
      let retryAfterMs: number | null = null;
      let incomplete: "empty" | "truncated" | "too_long" | null = null;
      let unusableCode: string | null = null;
      try {
        const res = await deps.fetchImpl(tool.endpoint_url, { method: "POST", headers, body: JSON.stringify(request.body), signal: AbortSignal.timeout(deps.toolTimeoutMs) });
        httpStatus = res.status;
        retryAfterMs = parseRetryAfter(res.headers?.get?.("retry-after"), deps.now());
        rawText = await res.text();
        if (!res.ok) failed = true;
      } catch (e) {
        failed = true;
        if (e instanceof Error && e.name === "TimeoutError") timedOut = true; else unreachable = true;
      }

      // 7. Read the reply.
      let content = "";
      let reply = null as ReturnType<typeof parseToolReply> | null;
      if (!failed) {
        let payload: unknown = rawText;
        try { payload = JSON.parse(rawText); } catch { /* plain text body */ }
        const generic = readGenericPayload(payload);
        const intake = generic !== null ? ({ ok: true, text: generic } as const) : extractExternalText(payload);
        if (!intake.ok) {
          failed = true;
          if (intake.code === "content_required") incomplete = "empty";
          else if (intake.code === "content_too_long") incomplete = "too_long";
          else unusableCode = intake.code;
        } else if (truncationOf(payload)) {
          failed = true; incomplete = "truncated";
        } else {
          reply = parseToolReply(intake.text);
          content = [reply.answer, reply.question].filter((p) => p && p.trim()).join("\n\n");
          if (!content.trim()) { failed = true; incomplete = "empty"; }
        }
      }
      const failureClass = failed
        ? classifyFailure({ httpStatus: httpStatus !== null && httpStatus < 400 ? null : httpStatus, timedOut, unreachable, retryAfterMs, incomplete, unusableCode, attempt: s.failures_used + 1 })
        : null;

      const stepBase = {
        session_id: s.id, user_id: s.user_id, step_no: stepNo, attempt,
        request: { headers: request.headers, body: request.body }, http_status: httpStatus,
      };

      // 8a. No usable reply: classify why, then retry, switch tool, hand off or end.
      if (failed || !reply) {
        const fc = failureClass ?? classifyFailure({ httpStatus, attempt: s.failures_used + 1 });
        const action = planNextAction({
          base: {
            verdict: null, toolStatus: null, stepNo, maxSteps: s.max_steps, retriesUsed: s.retries_used, maxRetries: s.max_retries,
            failuresUsed: s.failures_used, maxFailures: DEFAULT_MAX_FAILURES, elapsedMs: activeMs(s, deps), maxMs: SESSION_TIME_LIMIT_MS,
            failure: fc, canFallback: !!s.fallback_tool_id && !s.fallback_used, onExhausted: s.on_failure,
          },
          requestModsUsed: s.request_mods_used, hits: [], wm,
        });
        await admin.from("outer_control_session_steps").insert({ ...stepBase, error: fc.reason, next_action: action.kind, note: action.reason });
        steps++;
        await recordMemory(admin, s, { stepNo, kind: "recovery", summary: `Step ${stepNo}: ${fc.reason} (${action.kind.replace(/_/g, " ")}).` });
        if (action.kind === "retry_same") {
          const patchFields: Record<string, unknown> = { failures_used: s.failures_used + 1 };
          if (fc.correction) patchFields.correction = fc.correction;
          if (fc.delayMs > MAX_INLINE_DELAY_MS) {
            patchFields.resume_at = iso(deps.now() + fc.delayMs);
            await patch(admin, s.id, patchFields, deps);
            return { status: "running", steps };
          }
          await patch(admin, s.id, patchFields, deps);
          if (fc.delayMs > 0) await deps.sleep(fc.delayMs);
          continue;
        }
        if (action.kind === "switch_tool" && s.fallback_tool_id) {
          await patch(admin, s.id, {
            tool_id: s.fallback_tool_id, fallback_used: true, failures_used: 0, retries_used: 0, gate_cleared_step: s.step_count,
            attempt_base: s.attempt_base + s.retries_used + s.failures_used + 1, correction: null, resume_at: null,
          }, deps);
          await recordMemory(admin, s, { stepNo, kind: "recovery", summary: `Step ${stepNo}: switched to the fallback tool after "${tool.name}" kept failing.` });
          continue;
        }
        if (action.kind === "handoff") {
          await pauseForHandoff(admin, s, tool, stepNo, deps, { kind: "tool_failed", ruleNames: [], failure: fc });
          return { status: "awaiting_human", steps };
        }
        await finish(admin, s, action.kind === "stop" ? "stopped" : "failed", fc.reason, deps);
        return { status: action.kind === "stop" ? "stopped" : "failed", steps };
      }

      // 8b. The foundation judges the reply; the brain turns that into one decision for this loop.
      const contentHash = await sha256Hex(content);
      const result = await evaluateExternalText(admin, {
        userId: s.user_id, agentId: null, apiKeyId: s.api_key_id, isTest: false,
        sourceModel: `tool:${tool.name}`.slice(0, 80), content, origin: "external-api",
        externalId: `${s.id}:${stepNo}:${attempt}`, contentHash,
      });
      const matches = result.matches ?? [];
      const brain = think({
        foundation: { verdict: result.verdict, output: result.output, matches, changes: result.changes ?? [], summary: result.summary },
        content, contentHash, rules: safetyRules, wm, requestModsUsed: s.request_mods_used,
        loop: {
          toolStatus: reply.status, stepNo, maxSteps: s.max_steps, retriesUsed: s.retries_used, maxRetries: s.max_retries,
          failuresUsed: s.failures_used, maxFailures: DEFAULT_MAX_FAILURES, elapsedMs: activeMs(s, deps), maxMs: SESSION_TIME_LIMIT_MS,
          onExhausted: s.on_failure,
        },
      });
      const verdict = brain.verdict;
      const action = brain.plan;
      const ruleNames = [...new Set([...matches.map((m) => m.name), ...brain.applied.filter((h) => h.origin === "pinned").map((h) => h.name)])];
      const names = ruleNames.join("; ");
      // What is stored is the masked/cleaned form, never the raw reply.
      const stored = brain.output ?? textSafeToStore(content, matches);
      await admin.from("outer_control_session_steps").insert({
        ...stepBase, reply_text: stored, tool_status: reply.status, evaluation_id: result.evaluationId, verdict,
        next_action: action.kind, note: brain.why.slice(0, 500), decision: decisionRecord(brain),
      });
      steps++;

      // What was decided, changed and applied is remembered for every later request (and re-applied by the guard).
      const facts = factsFor(brain, contentHash, attempt) as unknown as Record<string, unknown>;
      if (verdict === "block") {
        await recordMemory(admin, s, { stepNo, kind: "rejection", ruleNames, data: facts, summary: `Step ${stepNo}: the reply broke "${names || "a rule"}" and was rejected.` });
      } else if (verdict === "modify") {
        await recordMemory(admin, s, {
          stepNo, kind: "modification", ruleNames: brain.changes.map((c) => c.name), data: facts,
          summary: `Step ${stepNo}: removed ${brain.changes.map((c) => `${c.count}× "${c.name}"`).join(", ") || "sensitive text"} from the reply; the cleaned reply was used.`,
        });
      } else if (verdict === "escalate") {
        await recordMemory(admin, s, { stepNo, kind: "rule", ruleNames, data: facts, summary: `Step ${stepNo}: the reply matched "${names || "a rule"}" and needed a person's approval.` });
      }

      // 9. Apply the plan.
      if (action.kind === "retry_with_correction") {
        await patch(admin, s.id, { retries_used: s.retries_used + 1, correction: `It matched: ${names || "a rule"}.` }, deps);
        continue;
      }
      if (action.kind === "modify_request" && action.request) {
        await patch(admin, s.id, {
          retries_used: s.retries_used + 1, request_mods_used: s.request_mods_used + 1, request_mods: action.request,
          correction: `It matched: ${names || "a rule"}.`,
        }, deps);
        await recordMemory(admin, s, {
          stepNo, kind: "plan", ruleNames, data: { request_mod: true },
          summary: `Step ${stepNo}: the request was tightened (${action.request.constraints.length} constraint(s)${action.request.dropContext ? ", earlier context left out" : ""}) after "${names || "a rule"}" kept being broken.`,
        });
        continue;
      }
      if (action.kind === "handoff") {
        await pauseForHandoff(admin, s, tool, stepNo, deps, { kind: "rule_exhausted", ruleNames, failure: null });
        return { status: "awaiting_human", steps };
      }
      if (action.kind === "reject") { await finish(admin, s, "rejected", `${action.reason}${names ? ` (${names})` : ""}`, deps); return { status: "rejected", steps }; }
      if (action.kind === "stop" && verdict !== "allow" && verdict !== "modify") {
        await finish(admin, s, "stopped", action.reason, deps);
        return { status: "stopped", steps };
      }
      if (action.kind === "pause_human" && verdict === "escalate") {
        await patch(admin, s.id, { status: "awaiting_human", pending_kind: "reply_approval", pending_approval_id: result.approvalId ?? null, pending_step_no: stepNo, lease_until: null }, deps);
        return { status: "awaiting_human", steps };
      }
      // allow / modify: continue, finish, or ask a person a question.
      await acceptReply(admin, s, tool, stepNo, { text: brain.output ?? content, toolStatus: reply.status }, deps);
      const { data: after } = await admin.from("outer_control_sessions").select("status").eq("id", s.id).maybeSingle();
      const st = (after as { status?: string } | null)?.status ?? "running";
      if (st !== "running") return { status: st, steps };
    }
    return { status: "running", steps };
  } finally {
    // Release the lease unless the session already cleared it (finished/paused).
    await admin.from("outer_control_sessions").update({ lease_until: null }).eq("id", sessionId).eq("status", "running");
  }
}

/** Moves a paused session on, but only if it is still paused for the same reason: only one caller wins. */
async function claimPause(admin: AnyAdmin, s: SessionRow, fields: Record<string, unknown>, deps: SessionDeps): Promise<boolean> {
  const { data } = await admin.from("outer_control_sessions").update({ ...fields, updated_at: iso(deps.now()) })
    .eq("id", s.id).eq("status", "awaiting_human").eq("pending_kind", s.pending_kind).select("id").maybeSingle();
  return !!data;
}

export type EditResult = { ok: true; status: string } | { ok: false; message: string };

/**
 * A person answers a hand-off by writing (or fixing) the reply themselves. The text is judged by
 * the same rules as any tool reply: a block is refused (the hand-off stays open), a reply that needs
 * approval waits for it, anything else is used exactly as if the tool had sent it.
 */
export async function applyEditedReply(admin: AnyAdmin, sessionId: string, text: string, deps: SessionDeps = defaultSessionDeps()): Promise<EditResult> {
  const clean = (text ?? "").trim();
  if (!clean) return { ok: false, message: "Write the reply first." };
  if (clean.length > MAX_EDIT_CHARS) return { ok: false, message: `The reply is limited to ${MAX_EDIT_CHARS} characters.` };

  const { data: row } = await admin.from("outer_control_sessions").select("*").eq("id", sessionId).maybeSingle();
  const s = row as (SessionRow & { handoff: { options?: { id: string }[] } | null }) | null;
  if (!s || s.status !== "awaiting_human" || s.pending_kind !== "handoff") return { ok: false, message: "This session is not waiting for a decision." };
  if (!s.handoff?.options?.some((o) => o.id === "edit")) return { ok: false, message: "Writing the reply is not one of the options offered." };
  const { data: toolRow } = await admin.from("external_tools").select("*").eq("id", s.tool_id).maybeSingle();
  const tool = toolRow as ToolRow | null;
  if (!tool) return { ok: false, message: "The tool no longer exists." };

  const stepNo = s.pending_step_no ?? s.step_count + 1;
  const attempt = s.attempt_base + s.retries_used + s.failures_used + 2; // the attempt after the one that triggered the hand-off
  const result = await evaluateExternalText(admin, {
    userId: s.user_id, agentId: null, apiKeyId: s.api_key_id, isTest: false, sourceModel: "person:edit",
    content: clean, origin: "external-api", externalId: `${s.id}:${stepNo}:${attempt}`, contentHash: await sha256Hex(clean),
  });
  const matches = result.matches ?? [];
  // The person's text is held to everything this task already decided (rules pinned earlier included).
  const safety = await loadSafetyRules(admin, s.user_id, null, s.api_key_id);
  const wm = buildWorkingMemory((await loadMemory(admin, s)) as MemoryRow[]);
  const brain = think({
    foundation: { verdict: result.verdict, output: result.output, matches, changes: result.changes ?? [], summary: result.summary },
    content: clean, contentHash: await sha256Hex(clean), rules: safety, wm, requestModsUsed: s.request_mods_used,
    loop: { toolStatus: "done", stepNo, maxSteps: s.max_steps, retriesUsed: 0, maxRetries: s.max_retries, failuresUsed: 0, maxFailures: DEFAULT_MAX_FAILURES, elapsedMs: 0, maxMs: SESSION_TIME_LIMIT_MS, onExhausted: s.on_failure },
  });
  const names = [...new Set([...matches.map((m) => m.name), ...brain.applied.map((h) => h.name)])].filter((n) => n.length <= 80).join("; ");
  if (brain.verdict === "block") {
    return { ok: false, message: names ? `That text breaks "${names}". Change it and try again.` : `That text cannot be used: ${brain.why}` };
  }

  const { data: last } = await admin.from("outer_control_session_steps").select("tool_status")
    .eq("session_id", s.id).eq("step_no", stepNo).order("attempt", { ascending: false }).limit(1).maybeSingle();
  const toolStatus: "done" | "continue" = (last as { tool_status?: string } | null)?.tool_status === "continue" ? "continue" : "done";
  const used = brain.output ?? textSafeToStore(clean, matches);
  const w = waited(s, deps);

  const paused = brain.verdict === "escalate";
  const moved = await claimPause(admin, s, paused
    ? { pending_kind: "reply_approval", pending_approval_id: result.approvalId ?? null, handoff: null, pending_answer: null, pending_step_no: stepNo, ...w }
    : { pending_kind: null, pending_approval_id: null, handoff: null, pending_answer: null, pending_step_no: null, ...w }, deps);
  if (!moved) return { ok: false, message: "This session was already decided." };

  await admin.from("outer_control_session_steps").insert({
    session_id: s.id, user_id: s.user_id, step_no: stepNo, attempt, request: null, reply_text: used, tool_status: toolStatus,
    evaluation_id: result.evaluationId, verdict: brain.verdict, next_action: paused ? "pause_human" : "continue",
    note: `Written by a person. ${brain.why}`.slice(0, 500), decision: decisionRecord(brain),
  });
  await recordMemory(admin, s, {
    stepNo, kind: "human",
    summary: `Step ${stepNo}: a person wrote the reply${brain.verdict === "modify" ? " (sensitive text was removed)" : ""}${paused ? " and it needs approval" : " and it was used"}.`,
  });
  if (paused) return { ok: true, status: "awaiting_human" };

  await acceptReply(admin, { ...s, status: "running", ...w }, tool, stepNo, { text: used, toolStatus }, deps);
  const { data: after } = await admin.from("outer_control_sessions").select("status").eq("id", s.id).maybeSingle();
  return { ok: true, status: (after as { status?: string } | null)?.status ?? "running" };
}

/**
 * Looks at a paused session and resumes or ends it if what it was waiting for has happened.
 * Safe to call from several places at once (the dashboard, the sweep): the transition out of
 * the pause is conditional, so only one caller applies it.
 */
export async function resumeSession(admin: AnyAdmin, sessionId: string, deps: SessionDeps = defaultSessionDeps()): Promise<{ status: string; resumed: boolean }> {
  const { data: row } = await admin.from("outer_control_sessions").select("*").eq("id", sessionId).maybeSingle();
  const s = row as SessionRow | null;
  if (!s || s.status !== "awaiting_human") return { status: s?.status ?? "missing", resumed: false };

  const claim = (fields: Record<string, unknown>) => claimPause(admin, s, fields, deps);
  const ended = (status: string, stop_reason: string) => ({
    status, stop_reason, finished_at: iso(deps.now()), lease_until: null, pending_kind: null, pending_approval_id: null, handoff: null, pending_answer: null,
  });
  const notResumed = { status: s.status, resumed: false };

  if (s.pending_kind === "handoff") {
    const choice = decodeChoice(s.pending_answer);
    if (!choice) return notResumed;
    const stepNo = s.pending_step_no ?? s.step_count + 1;
    if (choice.option === "stop") {
      if (!(await claim(ended("stopped", "A person stopped the session after a hand-off.")))) return notResumed;
      await recordMemory(admin, s, { stepNo, kind: "human", summary: `Step ${stepNo}: a person chose to stop the session.` });
      return { status: "stopped", resumed: true };
    }
    const note = choice.note ? maskForSend(await loadSafetyRules(admin, s.user_id, null, s.api_key_id), choice.note).slice(0, MAX_ANSWER_CHARS) : null;
    if (!(await claim({
      status: "running", pending_kind: null, handoff: null, pending_answer: null, pending_step_no: null, lease_until: null, resume_at: null,
      attempt_base: s.attempt_base + s.retries_used + s.failures_used + 1, retries_used: 0, failures_used: 0,
      next_input: choice.note ? choice.note.slice(0, MAX_ANSWER_CHARS) : s.next_input, ...waited(s, deps),
    }))) return notResumed;
    await recordMemory(admin, s, { stepNo, kind: "human", summary: `Step ${stepNo}: a person chose to retry${note ? ` and said: "${note.slice(0, 300)}"` : ""}.` });
    return { status: "running", resumed: true };
  }

  if (s.pending_kind === "question") {
    const answer = (s.pending_answer ?? "").trim();
    if (!answer) return notResumed;
    if (!(await claim({
      status: "running", pending_kind: null, pending_question: null, pending_answer: null, next_input: answer.slice(0, MAX_ANSWER_CHARS),
      lease_until: null, ...waited(s, deps),
    }))) return notResumed;
    const qStep = s.pending_step_no ?? s.step_count;
    await recordMemory(admin, s, { stepNo: qStep, kind: "human", summary: `Step ${qStep}: a person answered the tool's question.` });
    return { status: "running", resumed: true };
  }

  let approvalStatus = "pending";
  if (s.pending_approval_id) {
    const { data: ap } = await admin.from("pending_approvals").select("status").eq("id", s.pending_approval_id).maybeSingle();
    approvalStatus = (ap as { status?: string } | null)?.status ?? "rejected";
  } else {
    approvalStatus = "rejected"; // an approval that was never created cannot be waited for
  }
  if (PENDING_STATUSES.has(approvalStatus)) return notResumed;
  const approved = APPROVED_STATUSES.has(approvalStatus);

  const stepNo = s.pending_step_no ?? s.step_count + 1;
  const what = s.pending_kind === "first_contact" ? "first contact with the tool" : s.pending_kind === "contact_gate" ? "contacting the tool" : "the reply";
  // Which reply the decision was about, so the brain can tell later which texts a person approved.
  let about: { step: number; attempt: number } | undefined;
  if (s.pending_kind === "reply_approval") {
    const { data: latest } = await admin.from("outer_control_session_steps").select("attempt")
      .eq("session_id", s.id).eq("step_no", stepNo).order("attempt", { ascending: false }).limit(1).maybeSingle();
    if (latest) about = { step: stepNo, attempt: (latest as { attempt: number }).attempt };
  }
  const remember = () => recordMemory(admin, s, {
    stepNo, kind: "human", summary: `Step ${stepNo}: a person ${approved ? "approved" : "declined"} ${what}.`,
    data: { human: approved ? "approved" : "declined", ...(about ? { about } : {}) },
  });

  if (!approved) {
    if (!(await claim(ended("rejected", "A person declined the request.")))) return notResumed;
    await remember();
    return { status: "rejected", resumed: true };
  }

  if (s.pending_kind === "first_contact") {
    if (!(await claim({ status: "running", pending_kind: null, pending_approval_id: null, lease_until: null, ...waited(s, deps) }))) return notResumed;
    await admin.from("external_tools").update({ approved_at: iso(deps.now()), updated_at: iso(deps.now()) }).eq("id", s.tool_id);
    await remember();
    return { status: "running", resumed: true };
  }
  if (s.pending_kind === "contact_gate") {
    if (!(await claim({ status: "running", pending_kind: null, pending_approval_id: null, gate_cleared_step: stepNo, lease_until: null, ...waited(s, deps) }))) return notResumed;
    await remember();
    return { status: "running", resumed: true };
  }

  // reply_approval: release the verified-clean text that was stored for this step.
  const { data: stepRow } = await admin.from("outer_control_session_steps")
    .select("reply_text, tool_status").eq("session_id", s.id).eq("step_no", stepNo).order("attempt", { ascending: false }).limit(1).maybeSingle();
  const stepData = stepRow as { reply_text: string | null; tool_status: "done" | "continue" | "need_info" | null } | null;
  const text = stepData?.reply_text ?? "";
  const rules = (await loadSafetyRules(admin, s.user_id, null, s.api_key_id)).filter((r) => !r.shadow_mode && r.severity === "block");
  const stillSensitive = !text || text.startsWith(WITHHELD) || scanWithRules(rules, text, "").matched;
  if (stillSensitive) {
    if (!(await claim(ended("rejected", "Approved, but the reply could not be released safely.")))) return notResumed;
    await remember();
    return { status: "rejected", resumed: true };
  }
  const { data: toolRow } = await admin.from("external_tools").select("*").eq("id", s.tool_id).maybeSingle();
  const w = waited(s, deps);
  if (!(await claim({ pending_kind: null, pending_approval_id: null, pending_step_no: null, ...w }))) return notResumed;
  await remember();
  await acceptReply(admin, { ...s, status: "running", ...w }, toolRow as ToolRow, stepNo, { text, toolStatus: stepData?.tool_status ?? null }, deps);
  const { data: after } = await admin.from("outer_control_sessions").select("status").eq("id", s.id).maybeSingle();
  return { status: (after as { status?: string } | null)?.status ?? "running", resumed: true };
}
