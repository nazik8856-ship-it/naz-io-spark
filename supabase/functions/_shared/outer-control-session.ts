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

// deno-lint-ignore no-explicit-any
type AnyAdmin = any;

export type SessionRow = {
  id: string; user_id: string; tool_id: string; api_key_id: string | null;
  objective: string; context: string | null; status: string;
  step_count: number; max_steps: number; max_retries: number; retries_used: number; failures_used: number;
  correction: string | null; history: { step: number; text: string }[]; next_input: string | null;
  final_output: string | null; stop_reason: string | null;
  pending_kind: "first_contact" | "contact_gate" | "reply_approval" | "question" | null;
  pending_approval_id: string | null; pending_step_no: number | null;
  pending_question: string | null; pending_answer: string | null;
  gate_cleared_step: number; lease_until: string | null; started_at: string; updated_at: string; waited_ms: number;
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

async function notifyFailure(admin: AnyAdmin, s: SessionRow, reason: string) {
  try {
    await sendCriticalAlert(admin, s.user_id, {
      event: "outer_control_session_failed",
      summary: `An Outer Control session failed: "${s.objective.slice(0, 80)}". ${reason.slice(0, 200)}`,
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
  const advance = { step_count: stepNo, retries_used: 0, failures_used: 0, correction: null, next_input: null, history };
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
      const attempt = s.retries_used + s.failures_used + 1;

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
      const request = buildToolRequest({
        format: tool.request_format, model: tool.model, objective: maskForSend(safetyRules, s.objective),
        context: maskForSend(safetyRules, s.context), rules: ruleLines, history: s.history ?? [],
        correction: s.correction, answer: s.next_input ? maskForSend(safetyRules, s.next_input) : null, sessionId: s.id, step: stepNo,
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
      let failure: string | null = null;
      try {
        const res = await deps.fetchImpl(tool.endpoint_url, { method: "POST", headers, body: JSON.stringify(request.body), signal: AbortSignal.timeout(deps.toolTimeoutMs) });
        httpStatus = res.status;
        rawText = await res.text();
        if (!res.ok) failure = `The tool answered HTTP ${res.status}.`;
      } catch (e) {
        failure = e instanceof Error && e.name === "TimeoutError" ? "The tool did not answer in time." : "The tool could not be reached.";
      }

      // 7. Read the reply.
      let content = "";
      let reply = null as ReturnType<typeof parseToolReply> | null;
      if (!failure) {
        let payload: unknown = rawText;
        try { payload = JSON.parse(rawText); } catch { /* plain text body */ }
        const generic = readGenericPayload(payload);
        const intake = generic !== null ? ({ ok: true, text: generic } as const) : extractExternalText(payload);
        if (!intake.ok) failure = `The reply could not be used (${intake.code}).`;
        else {
          reply = parseToolReply(intake.text);
          content = [reply.answer, reply.question].filter((p) => p && p.trim()).join("\n\n");
          if (!content.trim()) failure = "The tool sent an empty reply.";
        }
      }

      const stepBase = {
        session_id: s.id, user_id: s.user_id, step_no: stepNo, attempt,
        request: { headers: request.headers, body: request.body }, http_status: httpStatus,
      };

      // 8a. No usable reply.
      if (failure || !reply) {
        const action = decideNextAction({
          verdict: null, toolStatus: null, stepNo, maxSteps: s.max_steps, retriesUsed: s.retries_used, maxRetries: s.max_retries,
          failuresUsed: s.failures_used, maxFailures: DEFAULT_MAX_FAILURES, elapsedMs: activeMs(s, deps), maxMs: SESSION_TIME_LIMIT_MS,
        });
        await admin.from("outer_control_session_steps").insert({ ...stepBase, error: failure, next_action: action.kind, note: action.reason });
        steps++;
        if (action.kind === "retry_same") {
          await patch(admin, s.id, { failures_used: s.failures_used + 1 }, deps);
          await deps.sleep(500 * (s.failures_used + 1));
          continue;
        }
        await finish(admin, s, action.kind === "stop" ? "stopped" : "failed", failure ?? action.reason, deps);
        return { status: action.kind === "stop" ? "stopped" : "failed", steps };
      }

      // 8b. Evaluate the reply under the rules.
      const result = await evaluateExternalText(admin, {
        userId: s.user_id, agentId: null, apiKeyId: s.api_key_id, isTest: false,
        sourceModel: `tool:${tool.name}`.slice(0, 80), content, origin: "external-api",
        externalId: `${s.id}:${stepNo}:${attempt}`, contentHash: await sha256Hex(content),
      });
      const matches = result.matches ?? [];
      const names = [...new Set(matches.map((m) => m.name))].join("; ");
      const action = decideNextAction({
        verdict: result.verdict, toolStatus: reply.status, stepNo, maxSteps: s.max_steps, retriesUsed: s.retries_used, maxRetries: s.max_retries,
        failuresUsed: s.failures_used, maxFailures: DEFAULT_MAX_FAILURES, elapsedMs: activeMs(s, deps), maxMs: SESSION_TIME_LIMIT_MS,
      });
      // What is stored is the masked/cleaned form, never the raw reply.
      const stored = result.output ?? textSafeToStore(content, matches);
      await admin.from("outer_control_session_steps").insert({
        ...stepBase, reply_text: stored, tool_status: reply.status, evaluation_id: result.evaluationId, verdict: result.verdict,
        next_action: action.kind, note: result.summary.slice(0, 500),
      });
      steps++;

      // 9. Apply the decision.
      if (action.kind === "retry_with_correction") {
        await patch(admin, s.id, { retries_used: s.retries_used + 1, correction: `It matched: ${names || "a rule"}.` }, deps);
        continue;
      }
      if (action.kind === "reject") { await finish(admin, s, "rejected", `${action.reason}${names ? ` (${names})` : ""}`, deps); return { status: "rejected", steps }; }
      if (action.kind === "stop" && result.verdict !== "allow" && result.verdict !== "modify") {
        await finish(admin, s, "stopped", action.reason, deps);
        return { status: "stopped", steps };
      }
      if (action.kind === "pause_human" && result.verdict === "escalate") {
        await patch(admin, s.id, { status: "awaiting_human", pending_kind: "reply_approval", pending_approval_id: result.approvalId ?? null, pending_step_no: stepNo, lease_until: null }, deps);
        return { status: "awaiting_human", steps };
      }
      // allow / modify: continue, finish, or ask a person a question.
      await acceptReply(admin, s, tool, stepNo, { text: result.output ?? content, toolStatus: reply.status }, deps);
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

/** Looks at a paused session and resumes or ends it if what it was waiting for has happened. */
export async function resumeSession(admin: AnyAdmin, sessionId: string, deps: SessionDeps = defaultSessionDeps()): Promise<{ status: string; resumed: boolean }> {
  const { data: row } = await admin.from("outer_control_sessions").select("*").eq("id", sessionId).maybeSingle();
  const s = row as SessionRow | null;
  if (!s || s.status !== "awaiting_human") return { status: s?.status ?? "missing", resumed: false };

  if (s.pending_kind === "question") {
    const answer = (s.pending_answer ?? "").trim();
    if (!answer) return { status: s.status, resumed: false };
    await patch(admin, s.id, { status: "running", pending_kind: null, pending_question: null, pending_answer: null, next_input: answer.slice(0, MAX_ANSWER_CHARS), lease_until: null, ...waited(s, deps) }, deps);
    return { status: "running", resumed: true };
  }

  let approvalStatus = "pending";
  if (s.pending_approval_id) {
    const { data: ap } = await admin.from("pending_approvals").select("status").eq("id", s.pending_approval_id).maybeSingle();
    approvalStatus = (ap as { status?: string } | null)?.status ?? "rejected";
  } else {
    approvalStatus = "rejected"; // an approval that was never created cannot be waited for
  }
  if (PENDING_STATUSES.has(approvalStatus)) return { status: s.status, resumed: false };
  const approved = APPROVED_STATUSES.has(approvalStatus);

  if (!approved) {
    await finish(admin, s, "rejected", "A person declined the request.", deps);
    return { status: "rejected", resumed: true };
  }

  const stepNo = s.pending_step_no ?? s.step_count + 1;
  if (s.pending_kind === "first_contact") {
    await admin.from("external_tools").update({ approved_at: iso(deps.now()), updated_at: iso(deps.now()) }).eq("id", s.tool_id);
    await patch(admin, s.id, { status: "running", pending_kind: null, pending_approval_id: null, lease_until: null, ...waited(s, deps) }, deps);
    return { status: "running", resumed: true };
  }
  if (s.pending_kind === "contact_gate") {
    await patch(admin, s.id, { status: "running", pending_kind: null, pending_approval_id: null, gate_cleared_step: stepNo, lease_until: null, ...waited(s, deps) }, deps);
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
    await finish(admin, s, "rejected", "Approved, but the reply could not be released safely.", deps);
    return { status: "rejected", resumed: true };
  }
  const { data: toolRow } = await admin.from("external_tools").select("*").eq("id", s.tool_id).maybeSingle();
  const w = waited(s, deps);
  await patch(admin, s.id, { pending_kind: null, pending_approval_id: null, pending_step_no: null, ...w }, deps);
  await acceptReply(admin, { ...s, status: "running", ...w }, toolRow as ToolRow, stepNo, { text, toolStatus: stepData?.tool_status ?? null }, deps);
  const { data: after } = await admin.from("outer_control_sessions").select("status").eq("id", s.id).maybeSingle();
  return { status: (after as { status?: string } | null)?.status ?? "running", resumed: true };
}
