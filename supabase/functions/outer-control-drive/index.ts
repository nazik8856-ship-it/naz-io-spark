// Outer Control (active): the owner-facing entry point for driving external tools.
//
//   POST { action: "create_tool", name, endpoint_url, request_format, model?, auth_header?, auth_scheme?, token? }
//   POST { action: "update_key", tool_id, token }   (replaces the stored credential)
//   POST { action: "remove_tool", tool_id }         (switches it off, hides it, cancels its open sessions)
//   POST { action: "test_tool", tool_id }
//   POST { action: "start_session", tool_id, objective, context?, api_key_id?, max_steps? }   (a Task of one step)
//   POST { action: "start_task", request, context?, steps: [{ tool_id, instruction, fallback_tool_id?, on_failure? }], api_key_id? }
//   POST { action: "create_agent_tool", agent_id }   (one of the account's own NazAI agents as a step)
//   POST { action: "start_goal", goal, criteria?: [up to 5 sentences], tool_ids: [1..3], max_rounds?, context?, api_key_id? }   (a Task that goes on until its criteria are met; costs one credit)
//   POST { action: "task_decide", task_id, decision: "accept" | "more" | "stop" }   (what to do with a goal Task that is blocked)
//   POST { action: "route_task", request }   (NazAI reads a request: which action, its text, background, labels; free, starts nothing)
//   POST { action: "start_report", task?: <one of the 14 actions, default "opinions">, topic, background?, styles?, count?, tool_ids, project_id? }
//        (a multi-tool action: every tool reply is checked, then one controlled result is written; uses TASK_CREDITS[task].
//         Tool counts, text lengths and labels per action: TASK_LIMITS. styles = the styles / roles / audiences of rewrite / roles / adapt;
//         count = options for alternatives; background goes to every tool as the Task's context and to NazAI's AI; project_id = an
//         imported project whose checked text goes to every tool too, and whose own rules then apply to the Task's replies)
//   POST { action: "follow_up", session_id, instruction }   (a new request to the same tool, based on the controlled answer of a completed session)
//   POST { action: "archive", kind: "session" | "workflow", id, archived?: boolean }   (leaves a finished item out of the default list, or brings it back; nothing is deleted)
//   POST { action: "answer", session_id, answer }
//   POST { action: "decide", session_id, option, note? | text? }  (answers a hand-off; text = "write the reply myself")
//   POST { action: "cancel", session_id }
//   POST { action: "start_workflow", objective, context?, legs[], api_key_id?, max_steps? }
//   POST { action: "cancel_workflow", workflow_id }
//
// start_session, start_goal and start_report refuse (409 tool_mismatch, before any credit is used) when the request names a
// connected tool that was not chosen, or names a word that fits several tools. confirm_override: true keeps the chosen tools.
//
// verify_jwt = true. Credentials go into the vault (create_integration_secret) and are
// never returned. Sessions run in the background (EdgeRuntime.waitUntil); the dashboard
// polls, and outer-control-session-sweep picks up anything that was left mid-way.
import "../_shared/redact-console.ts"; // first: secrets never reach the function logs
import { createClient } from "../_shared/encrypted-client.ts"; // encrypts Outer Control content (data encryption, front 3)
import { resolveAccountScope } from "../_shared/account-scope.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { validateOutboundUrl } from "../_shared/url-safety.ts";
import { checkKillSwitches } from "../_shared/control-gate.ts";
import { runConnectionTest } from "../_shared/outer-control-tool-test.ts";
import { recordConnectionTest } from "../_shared/outer-control-keepalive.ts";
import { applyEditedReply, contactRuleStopping } from "../_shared/outer-control-session.ts";
import { acceptGoal, cancelWorkflow, continueSession, driveSession, extendGoal, progressWorkflow, resumeAndDrive, startFollowUp, startGoal, startTask, startWorkflow } from "../_shared/outer-control-workflow.ts";
import { encodeChoice, findOption, type Handoff } from "../_shared/outer-control-handoff.ts";
import { createAgentTool, ensureReportTool, removeTool, updateToolKey } from "../_shared/outer-control-tools.ts";
import { ensureStarterTools, isStarterUrl, STARTER_TASKS, STARTER_USED_UP, starterTasksUsed } from "../_shared/outer-control-starter.ts";
import { buildPlanPrompt, cleanCount, cleanStyles, delegateInstruction, gatewayAi, improveInstruction, multistepInstruction, NEEDS_AI, parsePlan, REPORT_TOOL_URL, routeRequest, ROUTING_TEXT, stepInstructionFor, TASK_LIMITS, taskTitle, writerInstructionFor } from "../_shared/outer-control-report.ts";
import { ACTION_INFO, MAX_BACKGROUND, REPORT_KINDS, TASK_CREDITS, type ReportKind } from "../_shared/outer-control-report-doc.ts";
import { NO_CREDITS_MESSAGE, consumeGenerationCredit } from "../_shared/credits.ts";
import { pickAiGateway } from "../_shared/ai-gateway.ts";
import { projectContextFor } from "../_shared/projects.ts";
import { projectKeysFromEnv } from "../_shared/project-crypto.ts";

import { detectMentions, namedButNotChosen } from "../_shared/outer-control-mentions.ts";

/** How many requests NazAI's AI reads per account per day (route_task). */
const ROUTE_DAILY_CAP = 200;
/** Imported projects are stored encrypted; their text is decrypted here only to go to the tools of a Task. */
const projectsKey = projectKeysFromEnv();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const RATE_LIMIT_PER_MINUTE = 30;
const MAX_TOOLS_PER_ACCOUNT = 20;
const FORMATS = new Set(["openai_chat", "anthropic_messages", "generic_json", "mcp"]);
const HEADER_NAME = /^[A-Za-z0-9-]{1,40}$/;

// deno-lint-ignore no-explicit-any
const inBackground = (p: Promise<unknown>) => {
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  const guarded = p.catch((e) => console.error("outer-control-drive background run failed:", e instanceof Error ? e.message : e));
  if (rt?.waitUntil) rt.waitUntil(guarded);
};

/**
 * The tools a request names must be among the chosen ones, unless the person confirmed their choice. Returns the refusal, or
 * null when the request may go ahead.
 */
// deno-lint-ignore no-explicit-any
async function namedToolGuard(admin: any, accountId: string, text: string, chosenIds: string[], override: unknown): Promise<Response | null> {
  if (override === true) return null;
  const { data } = await admin.from("external_tools").select("id, name, model, endpoint_url").eq("user_id", accountId).eq("enabled", true).is("removed_at", null);
  const tools = (data ?? []) as { id: string; name: string; model: string | null; endpoint_url: string }[];
  const { missing, ambiguous } = namedButNotChosen(detectMentions(text, tools), chosenIds);
  if (!missing.length && !ambiguous.length) return null;
  const pick = (t: { id: string; name: string }) => ({ id: t.id, name: t.name });
  const chosen = tools.filter((t) => chosenIds.includes(t.id)).map(pick);
  const message = missing.length
    ? `Your request names ${missing.map((t) => t.name).join(" and ")}, but ${chosen.length ? chosen.map((t) => t.name).join(" and ") : "another tool"} was chosen.`
    : `"${ambiguous[0].word}" fits more than one connected tool: ${ambiguous[0].tools.map((t) => t.name).join(", ")}. Choose which one.`;
  return json({ error: "tool_mismatch", message, mentioned: missing.map(pick), chosen, ambiguous: ambiguous.map((a) => ({ word: a.word, tools: a.tools.map(pick) })) }, 409);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ error: "invalid_json", message: "The request body must be a JSON object." }, 400);
    const accountId = await resolveAccountScope(userClient, userData.user.id, body.account_id, "integrations");
    if (!accountId) return json({ error: "forbidden", message: "You don't have owner access on that account." }, 403);

    const rate = await checkRateLimit(admin, accountId, "outer-control-drive", RATE_LIMIT_PER_MINUTE, 60);
    if (!rate.allowed) return json({ error: "rate_limited", message: "Too many requests. Try again shortly." }, 429);

    const action = String(body.action ?? "");

    // ---- create_tool -----------------------------------------------------------
    if (action === "create_tool") {
      const name = String(body.name ?? "").trim();
      const endpoint = String(body.endpoint_url ?? "").trim();
      const format = String(body.request_format ?? "generic_json");
      if (!name || name.length > 80) return json({ error: "invalid_name", message: "Give the tool a name (80 characters or fewer)." }, 400);
      if (!FORMATS.has(format)) return json({ error: "invalid_format", message: "request_format must be openai_chat, anthropic_messages, generic_json or mcp." }, 400);
      const authName = String(body.auth_header ?? "Authorization").trim() || "Authorization";
      const scheme = typeof body.auth_scheme === "string" ? body.auth_scheme : "Bearer ";
      if (!HEADER_NAME.test(authName) || scheme.length > 20 || /[\r\n]/.test(scheme)) return json({ error: "invalid_auth", message: "That authentication header is not valid." }, 400);
      const url = await validateOutboundUrl(endpoint);
      if (!url.ok) return json({ error: "address_not_allowed", message: `That address can't be used: ${url.reason}.` }, 400);
      const { count } = await admin.from("external_tools").select("id", { count: "exact", head: true }).eq("user_id", accountId).is("removed_at", null);
      if ((count ?? 0) >= MAX_TOOLS_PER_ACCOUNT) return json({ error: "too_many_tools", message: `An account can connect at most ${MAX_TOOLS_PER_ACCOUNT} tools.` }, 409);
      let secretId: string | null = null;
      const token = typeof body.token === "string" ? body.token.trim() : "";
      if (token) {
        if (token.length > 2000) return json({ error: "invalid_token", message: "That credential is too long." }, 400);
        const { data: sid, error: sErr } = await admin.rpc("create_integration_secret", { payload: { token }, label: `outer-control-tool-${crypto.randomUUID()}` });
        if (sErr || !sid) return json({ error: "secret_failed", message: "Could not store the credential." }, 500);
        secretId = String(sid);
      }
      const { data: tool, error } = await admin.from("external_tools").insert({
        user_id: accountId, name, endpoint_url: endpoint, request_format: format,
        model: typeof body.model === "string" && body.model.trim() ? body.model.trim().slice(0, 80) : null,
        auth_header: authName, auth_scheme: scheme, credentials_secret_id: secretId,
      }).select("id, name, request_format, endpoint_url, enabled, approved_at").maybeSingle();
      if (error || !tool) return json({ error: "internal_error", message: "Could not save the tool." }, 500);
      return json({ ok: true, tool });
    }

    // ---- update_key / remove_tool ----------------------------------------------------
    if (action === "update_key") {
      const r = await updateToolKey(admin, accountId, String(body.tool_id ?? ""), body.token);
      return r.ok ? json({ ok: true, message: r.message }) : json({ error: r.code, message: r.message }, r.status);
    }
    if (action === "remove_tool") {
      const r = await removeTool(admin, accountId, String(body.tool_id ?? ""));
      if (!r.ok) return json({ error: r.code, message: r.message }, r.status);
      // Steps that were waiting on a cancelled one can now move on (or be skipped).
      if (r.workflowIds?.length) inBackground(Promise.all(r.workflowIds.map((w) => progressWorkflow(admin, w).then((ids) => Promise.all(ids.map((id) => driveSession(admin, id)))))));
      return json({ ok: true, message: r.message });
    }

    // ---- test_tool ---------------------------------------------------------------
    if (action === "test_tool") {
      const { data: tool } = await admin.from("external_tools").select("*").eq("id", String(body.tool_id ?? "")).eq("user_id", accountId).is("removed_at", null).maybeSingle();
      if (!tool) return json({ error: "not_found", message: "Tool not found." }, 404);
      if (tool.agent_id) {
        // An agent is run internally: the test is that it still exists. Nothing is run.
        const { data: ag } = await admin.from("agents").select("id").eq("id", tool.agent_id).eq("user_id", accountId).maybeSingle();
        const ok = !!ag;
        await admin.from("external_tools").update({ last_checked_at: new Date().toISOString(), last_ok_at: ok ? new Date().toISOString() : tool.last_ok_at, last_error: ok ? null : "The agent no longer exists." }).eq("id", tool.id);
        return json({ ok, error: ok ? null : "The agent no longer exists." });
      }
      if (String(tool.endpoint_url).startsWith(REPORT_TOOL_URL) || isStarterUrl(tool.endpoint_url)) {
        // Internal tool: what can be checked is that NazAI's own AI is configured.
        const ok = pickAiGateway() !== null;
        const error = ok ? null : "The AI that analyses the answers is not configured.";
        await admin.from("external_tools").update({ last_checked_at: new Date().toISOString(), last_ok_at: ok ? new Date().toISOString() : tool.last_ok_at, last_error: error }).eq("id", tool.id);
        return json({ ok, error });
      }
      const kill = await checkKillSwitches(admin, accountId, null);
      if (kill.killed) return json({ error: "kill_switch", message: kill.reason }, 409);
      const record = async (o: { ok: boolean; error: string | null; ms?: number | null; sample?: string | null }) => {
        await recordConnectionTest(admin, tool, o, Date.now());
        return json({ ok: o.ok, error: o.error, ms: o.ms ?? null, sample: o.sample ?? null });
      };
      const stopped = await contactRuleStopping(admin, accountId, tool.name);
      if (stopped) return record({ ok: false, error: stopped });
      return record(await runConnectionTest(admin, tool, { fetchImpl: fetch, validateUrl: validateOutboundUrl, now: Date.now, timeoutMs: 20_000 }));
    }

    // ---- start_session: a one-tool run, carried as a Task of one step ------------------------------
    if (action === "start_session") {
      const objective = String(body.objective ?? "").trim();
      const context = typeof body.context === "string" && body.context.trim() ? body.context.trim() : null;
      if (!objective || objective.length > 2000) return json({ error: "invalid_objective", message: "Describe the objective (2000 characters or fewer)." }, 400);
      if (context && context.length > 8000) return json({ error: "invalid_context", message: "The context is limited to 8000 characters." }, 400);
      const { data: tool } = await admin.from("external_tools").select("id, enabled").eq("id", String(body.tool_id ?? "")).eq("user_id", accountId).maybeSingle();
      if (!tool || !tool.enabled) return json({ error: "not_found", message: "Tool not found or disabled." }, 404);
      const named = await namedToolGuard(admin, accountId, objective, [tool.id], body.confirm_override);
      if (named) return named;
      if (body.fallback_tool_id) {
        const { data: fb } = await admin.from("external_tools").select("id, enabled").eq("id", String(body.fallback_tool_id)).eq("user_id", accountId).maybeSingle();
        if (!fb || !fb.enabled || fb.id === tool.id) return json({ error: "invalid_fallback", message: "The fallback tool must be a different, enabled tool." }, 400);
      }
      const started = await startWorkflow(admin, accountId, {
        objective, context, api_key_id: body.api_key_id, max_steps: body.max_steps, kind: "single",
        legs: [{ tool_id: tool.id, instruction: objective, fallback_tool_id: body.fallback_tool_id || null, on_failure: body.on_failure === "reject" ? "reject" : "handoff" }],
      });
      if (!started.ok) return json({ error: started.code, message: started.message }, started.code === "internal_error" ? 500 : 400);
      inBackground(Promise.all(started.running.map((id) => driveSession(admin, id))));
      return json({ ok: true, session_id: started.legIds[0], task_id: started.workflowId, status: "running" });
    }

    // ---- archive: a finished session or Task is left out of the default list; it is never deleted ----------
    if (action === "archive") {
      const table = body.kind === "workflow" ? "outer_control_workflows" : body.kind === "session" ? "outer_control_sessions" : null;
      if (!table) return json({ error: "invalid_kind", message: "kind must be session or workflow." }, 400);
      const { data: row } = await admin.from(table).select("id, status").eq("id", String(body.id ?? "")).eq("user_id", accountId).maybeSingle();
      if (!row) return json({ error: "not_found", message: "Not found." }, 404);
      if (["queued", "running", "awaiting_human"].includes(String((row as { status: string }).status))) return json({ error: "still_open", message: "Only a finished item can be archived. Cancel it first." }, 409);
      const archived = body.archived !== false;
      await admin.from(table).update({ archived_at: archived ? new Date().toISOString() : null }).eq("id", row.id);
      return json({ ok: true, archived });
    }

    // ---- follow_up: a next request to the same tool, based on the controlled answer of a finished session ----
    if (action === "follow_up") {
      const started = await startFollowUp(admin, accountId, { session_id: body.session_id, instruction: body.instruction });
      if (!started.ok) return json({ error: started.code, message: started.message }, started.code === "not_found" ? 404 : started.code === "internal_error" ? 500 : started.code === "not_completed" ? 409 : 400);
      inBackground(Promise.all(started.running.map((id) => driveSession(admin, id))));
      return json({ ok: true, session_id: started.legIds[0], task_id: started.workflowId, status: "running" });
    }

    // ---- start_task: several tools in sequence; each step receives the previous step's controlled result ----
    if (action === "start_task") {
      const started = await startTask(admin, accountId, { request: body.request, context: body.context, steps: body.steps, api_key_id: body.api_key_id, max_steps: body.max_steps });
      if (!started.ok) return json({ error: started.code, message: started.message }, started.code === "internal_error" ? 500 : 400);
      inBackground(Promise.all(started.running.map((id) => driveSession(admin, id))));
      return json({ ok: true, task_id: started.workflowId });
    }

    // ---- start_report: several tools give their opinion in turn (each answer checked), then one report is written ------
    // ---- route_task: NazAI's reading of a request (free; nothing is started) ---------------------------------------------
    if (action === "route_task") {
      const request = String(body.request ?? "").trim();
      if (!request || request.length > 4000) return json({ error: "invalid_request", message: "Describe the task (4000 characters or fewer)." }, 400);
      // Reading uses NazAI's AI, which costs NazAI money: at most ROUTE_DAILY_CAP readings a day per account. Past that the free
      // keyword reading is used, so the box keeps working; the page also remembers what it has already read.
      const cap = await checkRateLimit(admin, accountId, "outer_control_route_task", ROUTE_DAILY_CAP, 86_400);
      const route = await routeRequest(request, cap.allowed && pickAiGateway() !== null ? gatewayAi : null);
      return json({ ok: true, ...route, capped: !cap.allowed });
    }

    if (action === "start_report") {
      const kind = (REPORT_KINDS as string[]).includes(String(body.task ?? "opinions")) ? String(body.task ?? "opinions") as ReportKind : null;
      if (!kind) return json({ error: "invalid_task", message: `task must be one of: ${REPORT_KINDS.join(", ")}.` }, 400);
      const lim = TASK_LIMITS[kind];
      // A question keeps to one line; a text to check, rewrite, explain or adapt keeps its own lines.
      const content = !ROUTING_TEXT.includes(kind);
      const topic = content ? String(body.topic ?? "").trim() : String(body.topic ?? "").replace(/\s+/g, " ").trim();
      if (topic.length < 5 || topic.length > lim.maxText) return json({ error: "invalid_topic", message: `Give the text for ${ACTION_INFO[kind].title} (5 to ${lim.maxText} characters).` }, 400);
      // "context" is what the page sent before the box read the background itself.
      const background = typeof body.background === "string" ? body.background.trim() : typeof body.context === "string" ? body.context.trim() : "";
      if (background.length > MAX_BACKGROUND) return json({ error: "invalid_background", message: `The background is limited to ${MAX_BACKGROUND} characters.` }, 400);
      const styles = lim.labels ? cleanStyles(body.styles) : [];
      if (lim.labels && styles.length === 0) return json({ error: "invalid_styles", message: `Choose at least one ${lim.labels === "styles" ? "style" : lim.labels === "roles" ? "role" : "audience or platform"}.` }, 400);
      const count = kind === "alternatives" ? cleanCount(body.count) : 0;
      const ids = Array.isArray(body.tool_ids) ? [...new Set((body.tool_ids as unknown[]).map(String))] : [];
      if (ids.length < lim.minTools || ids.length > lim.maxTools) return json({ error: "invalid_tools", message: `Choose ${lim.minTools === lim.maxTools ? lim.minTools : `${lim.minTools} to ${lim.maxTools}`} tool${lim.maxTools === 1 ? "" : "s"} for ${ACTION_INFO[kind].title}.` }, 400);
      const { data: chosen } = await admin.from("external_tools").select("id, name, enabled, endpoint_url").eq("user_id", accountId).is("removed_at", null).in("id", ids);
      const rows = (chosen ?? []) as { id: string; name: string; enabled: boolean; endpoint_url: string }[];
      if (rows.length !== ids.length || rows.some((r) => !r.enabled || r.endpoint_url.startsWith(REPORT_TOOL_URL))) return json({ error: "tool_unavailable", message: "One of the chosen tools was not found or is disabled." }, 404);
      // A question or request may name the tools to ask; a claim or a text to rewrite, explain or adapt is content, so names in it are not a choice of tool.
      if (!content) {
        const namedR = await namedToolGuard(admin, accountId, topic, ids, body.confirm_override);
        if (namedR) return namedR;
      }
      // An imported project the Task works with: its text, checked against the account's and the project's rules, goes to every tool.
      let project: { id: string; text: string } | null = null;
      if (body.project_id) {
        // The Task's context holds at most 8000 characters; the project gets what the background leaves.
        const pc = await projectContextFor(admin, accountId, String(body.project_id), await projectsKey, 8000 - (background ? background.length + 2 : 0));
        if (!pc.ok) return json({ error: "project_unavailable", message: pc.message }, 409);
        project = { id: String(body.project_id), text: pc.text };
      }
      // The actions collected word for word need no AI; the others need NazAI's AI to plan or write the result.
      if (NEEDS_AI.includes(kind) && pickAiGateway() === null) return json({ error: "ai_unavailable", message: "The AI that writes the result is not configured, so this action can not run right now." }, 503);
      // Multi-step and delegation are planned before anything is charged or started.
      let plan: { title: string; instruction: string }[] | null = null;
      if (kind === "multistep" || kind === "delegate") {
        const raw = await gatewayAi(buildPlanPrompt(kind, topic, ids.length, background));
        plan = raw === null ? null : parsePlan(raw, kind, ids.length);
        if (!plan) return json({ error: "plan_failed", message: `NazAI could not ${kind === "multistep" ? "break the goal into steps" : "split the task into parts"} right now. Nothing was charged. Try again or describe it differently.` }, 503);
      }
      // NazAI's starter AI answers a new account's first Tasks; a Task asked only of it is free.
      const starterChosen = rows.filter((r) => isStarterUrl(r.endpoint_url)).length;
      if (starterChosen && await starterTasksUsed(admin, accountId) >= STARTER_TASKS) return json({ error: "starter_used_up", message: STARTER_USED_UP }, 409);
      const writer = await ensureReportTool(admin, accountId);
      if (!writer.ok) return json({ error: "internal_error", message: writer.message }, 500);
      const cost = starterChosen === rows.length ? 0 : TASK_CREDITS[kind];
      for (let c = 0; c < cost; c++) {
        const credit = await consumeGenerationCredit(accountId);
        if (!credit.ok) {
          for (let r = 0; r < c; r++) await admin.rpc("refund_generation_credit", { p_user_id: accountId });
          return json({ error: "no_credits", message: NO_CREDITS_MESSAGE }, 402);
        }
      }
      type Step = { tool_id: string; instruction: string; handoff: "none" | "pass" };
      let toolSteps: Step[];
      if (kind === "draft") {
        // One tool drafts; the second (or the same one again) improves the checked draft, which it receives as context.
        toolSteps = [{ tool_id: ids[0], instruction: stepInstructionFor("draft", topic), handoff: "none" }, { tool_id: ids[1] ?? ids[0], instruction: improveInstruction(topic), handoff: "pass" }];
      } else if (kind === "multistep") {
        // Steps in order, the tools taking turns; each step receives the previous step's checked result.
        toolSteps = plan!.map((p, i) => ({ tool_id: ids[i % ids.length], instruction: multistepInstruction(i + 1, plan!.length, p.title, p.instruction, topic), handoff: i === 0 ? "none" : "pass" }));
      } else if (kind === "delegate") {
        // One part per tool, each done on its own.
        toolSteps = plan!.map((p, i) => ({ tool_id: ids[i], instruction: delegateInstruction(i + 1, plan!.length, p.title, p.instruction, topic), handoff: "none" }));
      } else {
        toolSteps = ids.map((id) => ({ tool_id: id, instruction: stepInstructionFor(kind, topic, styles, count), handoff: "none" }));
      }
      const steps = [...toolSteps, { tool_id: writer.tool.id, instruction: writerInstructionFor(kind, topic), handoff: "none" }];
      // Draft and multi-step build on the previous step, so they go one after another. Everything else asks its tools at the same
      // time, and the result is written from the tools that answered (a tool that fails is named in the result).
      const parallel = kind !== "draft" && kind !== "multistep";
      // The project's text was fitted into what the background leaves of the Task's 8000 characters (its end marker included).
      const projectText = project ? project.text : "";
      const taskContext = [projectText, background].filter(Boolean).join("\n\n") || null;
      const started = await startTask(admin, accountId, { request: taskTitle(kind, topic, styles, count), context: taskContext, steps, max_steps: 3, parallel });
      if (!started.ok) {
        // The credits were taken before the Task could start: give them back.
        for (let r = 0; r < cost; r++) await admin.rpc("refund_generation_credit", { p_user_id: accountId });
        return json({ error: started.code, message: started.message }, started.code === "internal_error" ? 500 : 400);
      }
      // Marks the Task as paid for, so that if it ends without a result the credit goes back (once).
      // (A free starter Task was not charged, so nothing is given back for it.)
      await admin.from("outer_control_workflows").update({ credit_charged: cost > 0, ...(project ? { project_id: project.id } : {}) }).eq("id", started.workflowId);
      inBackground(Promise.all(started.running.map((id) => driveSession(admin, id))));
      return json({ ok: true, task_id: started.workflowId, steps: steps.length });
    }

    // ---- start_goal: a Task from a goal and done criteria; it goes on, round by round, until they are met or it is blocked ----
    if (action === "start_goal") {
      const goalIds = Array.isArray(body.tool_ids) ? (body.tool_ids as unknown[]).map(String) : [];
      const namedG = await namedToolGuard(admin, accountId, String(body.goal ?? ""), goalIds, body.confirm_override);
      if (namedG) return namedG;
      const credit = await consumeGenerationCredit(accountId);
      if (!credit.ok) return json({ error: "no_credits", message: NO_CREDITS_MESSAGE }, 402);
      const started = await startGoal(admin, accountId, body, { aiAvailable: pickAiGateway() !== null });
      if (!started.ok) {
        // The credit was taken before the Task could start: give it back.
        await admin.rpc("refund_generation_credit", { p_user_id: accountId });
        return json({ error: started.code, message: started.message }, started.code === "internal_error" ? 500 : started.code === "ai_unavailable" ? 503 : 400);
      }
      // Marks the Task as paid for, so that if it ends without a result the credit goes back (once).
      await admin.from("outer_control_workflows").update({ credit_charged: true }).eq("id", started.workflowId);
      inBackground(Promise.all(started.running.map((id) => driveSession(admin, id))));
      return json({ ok: true, task_id: started.workflowId });
    }

    // ---- task_decide: what to do with a blocked goal Task ----------------------------------------------------
    if (action === "task_decide") {
      const taskId = String(body.task_id ?? "");
      const decision = String(body.decision ?? "");
      if (decision !== "accept" && decision !== "more" && decision !== "stop") return json({ error: "invalid_decision", message: "decision must be accept, more or stop." }, 400);
      const { data: wf } = await admin.from("outer_control_workflows").select("id, status").eq("id", taskId).eq("user_id", accountId).maybeSingle();
      if (!wf) return json({ error: "not_found", message: "Task not found." }, 404);
      if (decision === "stop") {
        if (wf.status !== "running" && wf.status !== "awaiting_human") return json({ ok: true, already: wf.status });
        await cancelWorkflow(admin, wf.id, accountId);
        return json({ ok: true, status: "cancelled" });
      }
      if (decision === "accept") {
        const done = await acceptGoal(admin, wf.id, accountId);
        return done.ok ? json({ ok: true }) : json({ error: "not_blocked", message: done.message }, 409);
      }
      const more = await extendGoal(admin, wf.id, accountId, gatewayAi);
      if (!more.ok) return json({ error: "not_blocked", message: more.message }, 409);
      inBackground(Promise.all(more.started.map((id) => driveSession(admin, id))));
      return json({ ok: true });
    }

    // ---- starter_tools: "NazAI does it for me" (first-value onboarding). NazAI's own AI as three tools, free for the first Tasks ----
    if (action === "starter_tools") {
      if (pickAiGateway() === null) return json({ error: "ai_unavailable", message: "NazAI's AI is not available right now. Try again in a moment, or connect your own AI." }, 503);
      const used = await starterTasksUsed(admin, accountId);
      if (used >= STARTER_TASKS) return json({ error: "starter_used_up", message: STARTER_USED_UP }, 409);
      const made = await ensureStarterTools(admin, accountId, MAX_TOOLS_PER_ACCOUNT);
      return made.ok ? json({ ok: true, tools: made.tools, used, free: STARTER_TASKS }) : json({ error: made.code, message: made.message }, made.status);
    }

    // ---- create_agent_tool: one of the account's own NazAI agents as a step -------------------------
    if (action === "create_agent_tool") {
      const made = await createAgentTool(admin, accountId, body.agent_id, MAX_TOOLS_PER_ACCOUNT);
      return made.ok ? json({ ok: true, tool: made.tool, created: made.created }) : json({ error: made.code, message: made.message }, made.status);
    }

    // ---- answer / cancel -------------------------------------------------------------
    if (action === "answer" || action === "cancel") {
      const { data: session } = await admin.from("outer_control_sessions").select("id, status, pending_kind, workflow_id").eq("id", String(body.session_id ?? "")).eq("user_id", accountId).maybeSingle();
      if (!session) return json({ error: "not_found", message: "Session not found." }, 404);
      if (action === "cancel") {
        if (session.status !== "running" && session.status !== "awaiting_human") return json({ ok: true, already: session.status });
        await admin.from("outer_control_sessions").update({
          status: "cancelled", stop_reason: "Cancelled by the owner.", finished_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          pending_kind: null, pending_approval_id: null, lease_until: null, handoff: null,
        }).eq("id", session.id);
        if (session.workflow_id) inBackground(progressWorkflow(admin, session.workflow_id).then((ids) => Promise.all(ids.map((id) => driveSession(admin, id)))));
        return json({ ok: true, status: "cancelled" });
      }
      const answer = String(body.answer ?? "").trim();
      if (!answer || answer.length > 2000) return json({ error: "invalid_answer", message: "Type an answer (2000 characters or fewer)." }, 400);
      if (session.status !== "awaiting_human" || session.pending_kind !== "question") return json({ error: "not_waiting", message: "This session is not waiting for an answer." }, 409);
      await admin.from("outer_control_sessions").update({ pending_answer: answer, updated_at: new Date().toISOString() }).eq("id", session.id);
      inBackground(resumeAndDrive(admin, session.id));
      return json({ ok: true, status: "running" });
    }

    // ---- decide (a hand-off) --------------------------------------------------------
    if (action === "decide") {
      const { data: session } = await admin.from("outer_control_sessions").select("id, status, pending_kind, handoff").eq("id", String(body.session_id ?? "")).eq("user_id", accountId).maybeSingle();
      if (!session) return json({ error: "not_found", message: "Session not found." }, 404);
      if (session.status !== "awaiting_human" || session.pending_kind !== "handoff") return json({ error: "not_waiting", message: "This session is not waiting for a decision." }, 409);
      const option = findOption(session.handoff as Handoff | null, body.option);
      if (!option) return json({ error: "invalid_option", message: "That is not one of the options offered." }, 400);
      if (option.id === "edit") {
        const edited = await applyEditedReply(admin, session.id, typeof body.text === "string" ? body.text : "");
        if (!edited.ok) return json({ error: "edit_refused", message: edited.message }, 422);
        inBackground(continueSession(admin, session.id));
        return json({ ok: true, status: edited.status });
      }
      const note = typeof body.note === "string" ? body.note.trim() : "";
      if (note.length > 1000) return json({ error: "invalid_note", message: "The note is limited to 1000 characters." }, 400);
      await admin.from("outer_control_sessions").update({ pending_answer: encodeChoice(option.id, note || null), updated_at: new Date().toISOString() }).eq("id", session.id);
      inBackground(resumeAndDrive(admin, session.id));
      return json({ ok: true, status: option.id === "stop" ? "stopped" : "running" });
    }

    // ---- start_workflow / cancel_workflow --------------------------------------------
    if (action === "start_workflow") {
      const started = await startWorkflow(admin, accountId, body);
      if (!started.ok) return json({ error: started.code, message: started.message }, started.code === "internal_error" ? 500 : 400);
      inBackground(Promise.all(started.running.map((id) => driveSession(admin, id))));
      return json({ ok: true, workflow_id: started.workflowId });
    }
    if (action === "cancel_workflow") {
      const { data: wf } = await admin.from("outer_control_workflows").select("id").eq("id", String(body.workflow_id ?? "")).eq("user_id", accountId).maybeSingle();
      if (!wf) return json({ error: "not_found", message: "Workflow not found." }, 404);
      await cancelWorkflow(admin, wf.id, accountId);
      return json({ ok: true, status: "cancelled" });
    }

    return json({ error: "unknown_action", message: "action must be create_tool, create_agent_tool, update_key, remove_tool, test_tool, start_session, start_task, start_goal, task_decide, answer, decide, cancel, start_workflow or cancel_workflow." }, 400);
  } catch (e) {
    return json({ error: "internal_error", message: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
