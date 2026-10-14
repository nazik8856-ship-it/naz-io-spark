// Outer Control (active): the owner-facing entry point for driving external tools.
//
//   POST { action: "create_tool", name, endpoint_url, request_format, model?, auth_header?, auth_scheme?, token? }
//   POST { action: "test_tool", tool_id }
//   POST { action: "start_session", tool_id, objective, context?, api_key_id?, max_steps? }
//   POST { action: "answer", session_id, answer }
//   POST { action: "cancel", session_id }
//
// verify_jwt = true. Credentials go into the vault (create_integration_secret) and are
// never returned. Sessions run in the background (EdgeRuntime.waitUntil); the dashboard
// polls, and outer-control-session-sweep picks up anything that was left mid-way.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAccountScope } from "../_shared/account-scope.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { validateOutboundUrl } from "../_shared/url-safety.ts";
import { checkKillSwitches } from "../_shared/control-gate.ts";
import { buildToolRequest, parseToolReply, type ToolFormat } from "../_shared/outer-control-tool-request.ts";
import { extractExternalText } from "../_shared/outer-control-intake.ts";
import { advanceSession, contactRuleStopping, readGenericPayload, resumeSession } from "../_shared/outer-control-session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const RATE_LIMIT_PER_MINUTE = 30;
const MAX_TOOLS_PER_ACCOUNT = 20;
const FORMATS = new Set(["openai_chat", "anthropic_messages", "generic_json"]);
const HEADER_NAME = /^[A-Za-z0-9-]{1,40}$/;

// deno-lint-ignore no-explicit-any
const inBackground = (p: Promise<unknown>) => {
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  const guarded = p.catch((e) => console.error("outer-control-drive background run failed:", e instanceof Error ? e.message : e));
  if (rt?.waitUntil) rt.waitUntil(guarded);
};

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
      if (!FORMATS.has(format)) return json({ error: "invalid_format", message: "request_format must be openai_chat, anthropic_messages or generic_json." }, 400);
      const authName = String(body.auth_header ?? "Authorization").trim() || "Authorization";
      const scheme = typeof body.auth_scheme === "string" ? body.auth_scheme : "Bearer ";
      if (!HEADER_NAME.test(authName) || scheme.length > 20 || /[\r\n]/.test(scheme)) return json({ error: "invalid_auth", message: "That authentication header is not valid." }, 400);
      const url = await validateOutboundUrl(endpoint);
      if (!url.ok) return json({ error: "address_not_allowed", message: `That address can't be used: ${url.reason}.` }, 400);
      const { count } = await admin.from("external_tools").select("id", { count: "exact", head: true }).eq("user_id", accountId);
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

    // ---- test_tool ---------------------------------------------------------------
    if (action === "test_tool") {
      const { data: tool } = await admin.from("external_tools").select("*").eq("id", String(body.tool_id ?? "")).eq("user_id", accountId).maybeSingle();
      if (!tool) return json({ error: "not_found", message: "Tool not found." }, 404);
      const kill = await checkKillSwitches(admin, accountId, null);
      if (kill.killed) return json({ error: "kill_switch", message: kill.reason }, 409);
      const record = async (ok: boolean, error: string | null) => {
        await admin.from("external_tools").update({ last_checked_at: new Date().toISOString(), last_ok_at: ok ? new Date().toISOString() : tool.last_ok_at, last_error: error }).eq("id", tool.id);
        return json({ ok, error });
      };
      const stopped = await contactRuleStopping(admin, accountId, tool.name);
      if (stopped) return record(false, stopped);
      const check = await validateOutboundUrl(tool.endpoint_url);
      if (!check.ok) return record(false, `The address is not allowed: ${check.reason}.`);
      let token = "";
      if (tool.credentials_secret_id) {
        const { data: secret } = await admin.rpc("read_integration_secret", { sid: tool.credentials_secret_id });
        token = String((secret as { token?: string } | null)?.token ?? "");
      }
      const ping = buildToolRequest({
        format: tool.request_format as ToolFormat, model: tool.model, objective: 'Connection test. Reply with status "done" and the answer "ok".',
        rules: [], history: [], sessionId: "connection-test", step: 0,
      });
      const headers: Record<string, string> = { "Content-Type": "application/json", ...ping.headers };
      if (token) headers[tool.auth_header] = `${tool.auth_scheme}${token}`;
      if (tool.request_format === "anthropic_messages") headers["anthropic-version"] = "2023-06-01";
      try {
        const res = await fetch(tool.endpoint_url, { method: "POST", headers, body: JSON.stringify(ping.body), signal: AbortSignal.timeout(20_000) });
        const text = await res.text();
        if (!res.ok) return record(false, `The tool answered HTTP ${res.status}.`);
        let payload: unknown = text;
        try { payload = JSON.parse(text); } catch { /* plain text */ }
        const generic = readGenericPayload(payload);
        const intake = generic !== null ? { ok: true as const, text: generic } : extractExternalText(payload);
        if (!intake.ok) return record(false, `The tool answered, but the reply could not be read (${intake.code}).`);
        void parseToolReply(intake.text);
        return record(true, null);
      } catch (e) {
        return record(false, e instanceof Error && e.name === "TimeoutError" ? "The tool did not answer in time." : "The tool could not be reached.");
      }
    }

    // ---- start_session -------------------------------------------------------------
    if (action === "start_session") {
      const objective = String(body.objective ?? "").trim();
      const context = typeof body.context === "string" && body.context.trim() ? body.context.trim() : null;
      if (!objective || objective.length > 2000) return json({ error: "invalid_objective", message: "Describe the objective (2000 characters or fewer)." }, 400);
      if (context && context.length > 8000) return json({ error: "invalid_context", message: "The context is limited to 8000 characters." }, 400);
      const { data: tool } = await admin.from("external_tools").select("id, enabled").eq("id", String(body.tool_id ?? "")).eq("user_id", accountId).maybeSingle();
      if (!tool || !tool.enabled) return json({ error: "not_found", message: "Tool not found or disabled." }, 404);
      let apiKeyId: string | null = null;
      if (body.api_key_id) {
        const { data: key } = await admin.from("api_keys").select("id, revoked_at").eq("id", String(body.api_key_id)).eq("user_id", accountId).maybeSingle();
        if (!key || key.revoked_at) return json({ error: "invalid_key", message: "That API key is not available." }, 400);
        apiKeyId = key.id;
      }
      const maxSteps = Math.max(1, Math.min(20, Number.isFinite(Number(body.max_steps)) ? Math.trunc(Number(body.max_steps)) : 5));
      const { data: session, error } = await admin.from("outer_control_sessions").insert({
        user_id: accountId, tool_id: tool.id, api_key_id: apiKeyId, objective, context, max_steps: maxSteps,
      }).select("id").maybeSingle();
      if (error || !session) return json({ error: "internal_error", message: "Could not start the session." }, 500);
      inBackground(advanceSession(admin, session.id));
      return json({ ok: true, session_id: session.id, status: "running" });
    }

    // ---- answer / cancel -------------------------------------------------------------
    if (action === "answer" || action === "cancel") {
      const { data: session } = await admin.from("outer_control_sessions").select("id, status, pending_kind").eq("id", String(body.session_id ?? "")).eq("user_id", accountId).maybeSingle();
      if (!session) return json({ error: "not_found", message: "Session not found." }, 404);
      if (action === "cancel") {
        if (session.status !== "running" && session.status !== "awaiting_human") return json({ ok: true, already: session.status });
        await admin.from("outer_control_sessions").update({
          status: "cancelled", stop_reason: "Cancelled by the owner.", finished_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          pending_kind: null, pending_approval_id: null, lease_until: null,
        }).eq("id", session.id);
        return json({ ok: true, status: "cancelled" });
      }
      const answer = String(body.answer ?? "").trim();
      if (!answer || answer.length > 2000) return json({ error: "invalid_answer", message: "Type an answer (2000 characters or fewer)." }, 400);
      if (session.status !== "awaiting_human" || session.pending_kind !== "question") return json({ error: "not_waiting", message: "This session is not waiting for an answer." }, 409);
      await admin.from("outer_control_sessions").update({ pending_answer: answer, updated_at: new Date().toISOString() }).eq("id", session.id);
      inBackground((async () => {
        const r = await resumeSession(admin, session.id);
        if (r.status === "running") await advanceSession(admin, session.id);
      })());
      return json({ ok: true, status: "running" });
    }

    return json({ error: "unknown_action", message: "action must be create_tool, test_tool, start_session, answer or cancel." }, 400);
  } catch (e) {
    return json({ error: "internal_error", message: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
