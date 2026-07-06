// Autonomous agent runtime — one run of an agent.
// Business-aware: loads business profile + memory; supports remember/ask_user/request_approval tools.
// Input: { agentId: string, trigger?: "manual"|"cron"|"webhook", userInstruction?: string }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-scheduler-user-id",
};

const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";
const DEEP_MODEL = "google/gemini-3.1-pro-preview"; // stronger reasoning for deep analysis / audits / plans
const MAX_STEPS = 24;


type Tool = { name: string; description: string; kind: string; config: Record<string, unknown> };
type Manifest = {
  name: string; goal: string; systemPrompt: string; decisionPolicy: string;
  tools: Tool[]; triggers: { kind: string; spec: string }[];
  guardrails: { rule: string; requiresApproval: boolean }[];
  kpis: { name: string; target: string }[];
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) return json({ error: "Missing LOVABLE_API_KEY" }, 500);

    const { agentId, trigger = "manual", userInstruction } = await req.json();
    if (!agentId) return json({ error: "agentId required" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const schedulerUserId = req.headers.get("x-scheduler-user-id") ?? "";
    const userScopedClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve user: either authed via JWT, or scheduler-impersonated
    let userId = "";
    if (schedulerUserId) {
      userId = schedulerUserId;
    } else {
      const { data: userData } = await userScopedClient.auth.getUser();
      userId = userData?.user?.id ?? "";
    }
    if (!userId) return json({ error: "Not authenticated" }, 401);

    const supabase = adminClient; // we'll always read/write scoped by user_id ourselves

    const { data: agent, error: agentErr } = await supabase
      .from("agents").select("*").eq("id", agentId).eq("user_id", userId).single();
    if (agentErr || !agent) return json({ error: "Agent not found" }, 404);

    const manifest = agent.manifest as Manifest;

    // Load business profile and memory
    let profile: Record<string, unknown> | null = null;
    if (agent.business_profile_id) {
      const { data } = await supabase.from("business_profiles").select("*")
        .eq("id", agent.business_profile_id).eq("user_id", userId).maybeSingle();
      profile = data ?? null;
    }
    const { data: memory } = await supabase.from("agent_memory")
      .select("key, value, source").eq("agent_id", agentId).eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(40);

    // Load connected integrations + their most recent synced snapshot so the
    // agent grounds its reasoning in real business data instead of guessing.
    const { data: integrations } = await supabase.from("agent_integrations")
      .select("provider, status, metadata, last_verified_at, last_error")
      .eq("user_id", userId)
      .or(agent.id ? `agent_id.eq.${agent.id},agent_id.is.null` : `agent_id.is.null`);
    const connectedIntegrations = (integrations || []).filter((i) => i.status === "connected");
    const { data: snapshots } = await supabase.from("integration_snapshots")
      .select("provider, kind, data, error, fetched_at")
      .eq("user_id", userId)
      .order("fetched_at", { ascending: false })
      .limit(200);
    const latestByProvider = new Map<string, { kind: string; data: Record<string, unknown>; error: string | null; fetched_at: string }>();
    for (const s of snapshots || []) {
      if (!latestByProvider.has(s.provider as string)) {
        latestByProvider.set(s.provider as string, {
          kind: s.kind as string,
          data: (s.data as Record<string, unknown>) || {},
          error: (s.error as string | null) ?? null,
          fetched_at: s.fetched_at as string,
        });
      }
    }

    // Trigger a fresh sync in the background if the newest snapshot is stale
    // (> 30 min) or missing entirely for any connected integration. This keeps
    // agent reasoning current without blocking the run.
    const staleMs = 30 * 60 * 1000;
    const needsSync = connectedIntegrations.some((i) => {
      const snap = latestByProvider.get(i.provider as string);
      if (!snap) return true;
      return Date.now() - new Date(snap.fetched_at).getTime() > staleMs;
    });
    if (needsSync) {
      const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/integration-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${svc}` },
        body: JSON.stringify({ cron: false, userId, agentId }),
      }).catch(() => {});
    }

    // Pause if there's an unresolved clarification waiting
    const { data: lastClarify } = await supabase.from("agent_events")
      .select("id, kind, payload, created_at")
      .eq("agent_id", agentId).eq("user_id", userId)
      .in("kind", ["clarification_request", "clarification_answer"])
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (lastClarify && lastClarify.kind === "clarification_request") {
      return json({ skipped: true, reason: "awaiting clarification" });
    }

    const { data: run, error: runErr } = await supabase
      .from("agent_runs")
      .insert({ agent_id: agentId, user_id: userId, trigger, status: "running" })
      .select("id").single();
    if (runErr || !run) return json({ error: "Could not start run" }, 500);
    const runId = run.id as string;

    const logEvent = (kind: string, payload: Record<string, unknown>) =>
      supabase.from("agent_events").insert({ run_id: runId, agent_id: agentId, user_id: userId, kind, payload });

    await logEvent("run_started", { trigger, goal: manifest.goal });
    await logEvent("reason", { thought: `Agent activated (${trigger}). Reviewing business context and memory before acting.` });

    // Build system prompt with business + memory context
    const profileBlock = profile
      ? `\n# Business you work for\n- Company: ${profile.company_name}\n- One-liner: ${profile.one_liner}\n- Industry: ${profile.industry}\n- Tone: ${profile.tone}\n- Audience: ${profile.audience}\n- Offers: ${JSON.stringify(profile.offers)}\n- Channels: ${JSON.stringify(profile.channels)}`
      : "";
    const memoryBlock = (memory && memory.length)
      ? `\n# What you remember about this business (recent facts)\n${memory.map((m) => `- [${m.source}] ${m.key} = ${m.value}`).join("\n")}`
      : "";

    const integrationsBlock = connectedIntegrations.length
      ? `\n# Connected business tools (${connectedIntegrations.length}) — you must cite them by name in your reasoning\n${connectedIntegrations.map((i) => {
          const snap = latestByProvider.get(i.provider as string);
          const meta = (i.metadata as Record<string, unknown>) || {};
          const account = meta.handle || meta.account_name || meta.account_email || "connected account";
          if (!snap) return `- ${i.provider} (account: ${account}) — no live snapshot yet, call sync_now to pull data.`;
          const age = Math.round((Date.now() - new Date(snap.fetched_at).getTime()) / 60000);
          if (snap.error) return `- ${i.provider} (account: ${account}) — LAST SYNC FAILED ${age}m ago: ${snap.error}`;
          return `- ${i.provider} (account: ${account}) — live ${snap.kind} data (synced ${age}m ago):\n    ${JSON.stringify(snap.data)}`;
        }).join("\n")}`
      : "";

    // Inject built-in integration tools so EVERY agent (old or new) can
    // refresh and query live data from connected accounts without needing
    // them to be listed in the manifest.
    const builtInTools: Tool[] = [
      { name: "sync_now", kind: "sync_integrations", description: "Pull the freshest live data from every connected business tool. Call this when your snapshots look stale or missing.", config: {} },
      { name: "read_data", kind: "integration_query", description: "Look up the most recent synced snapshot for one connected tool. Use before making claims about numbers.", config: {} },
      { name: "deep_analyze", kind: "deep_analyze", description: "Run deep multi-step reasoning on a subject using a stronger model. Returns a structured diagnosis: findings, root causes, risks, concrete fixes with priority. Use for audits, debugging, competitive analysis, or any problem needing serious thinking.", config: {} },
      { name: "audit_url", kind: "audit_url", description: "Fetch a webpage/document URL and produce a concrete audit: what's wrong, what's missing, prioritized fixes with rationale. Use for website reviews, landing-page audits, doc reviews, competitor teardowns.", config: {} },
      { name: "make_plan", kind: "make_plan", description: "Produce a concrete, numbered execution plan for a stated objective. Each step includes owner, tool/action to take, success criteria. Use before large multi-step work.", config: {} },
    ];
    const effectiveTools: Tool[] = [
      ...manifest.tools,
      ...builtInTools.filter((b) => !manifest.tools.some((t) => t.name === b.name || t.kind === b.kind)),
    ];

    const toolDescriptions = effectiveTools.map((t) => {
      let usage = "";
      switch (t.kind) {
        case "web_search": usage = `web_search(query: string)`; break;
        case "http_get": usage = `http_get(url: string)`; break;
        case "calc": usage = `calc(expression: string)`; break;
        case "notify": usage = `notify(message: string, severity?: "info"|"warn"|"alert")`; break;
        case "remember": usage = `remember(key: string, value: string)  // persist a fact for future runs`; break;
        case "ask_user": usage = `ask_user(question: string, options?: string[])  // pauses the agent until the operator answers`; break;
        case "request_approval": usage = `request_approval(action: string, payload: object, risk?: "low"|"med"|"high")  // queue an external action`; break;
        case "sync_integrations": usage = `sync_now(provider?: string)  // refreshes live data from connected tools`; break;
        case "integration_query": usage = `read_data(provider: string)  // returns the latest synced snapshot for a connected tool`; break;
        case "deep_analyze": usage = `deep_analyze(subject: string, context?: string, focus?: string)  // deep structured diagnosis using a stronger reasoning model`; break;
        case "audit_url": usage = `audit_url(url: string, focus?: string)  // fetches the page and returns a concrete prioritized audit`; break;
        case "make_plan": usage = `make_plan(objective: string, constraints?: string)  // returns a numbered execution plan with success criteria`; break;
        default: usage = `${t.name}(...)  // CUSTOM — currently inert`;
      }
      return `- ${t.name} (${t.kind}): ${t.description}\n  Usage: ${usage}`;
    }).join("\n");


    const systemPrompt = `${manifest.systemPrompt}

# Operating contract
- Goal: ${manifest.goal}
- Decision policy: ${manifest.decisionPolicy}
- Guardrails: ${manifest.guardrails.map((g) => `${g.rule}${g.requiresApproval ? " [REQUIRES APPROVAL]" : ""}`).join("; ")}
- KPIs: ${manifest.kpis.map((k) => `${k.name}=${k.target}`).join(", ")}
${profileBlock}
${integrationsBlock}
${memoryBlock}

# Live-data contract
- Whenever you cite a number, name the connected tool it came from (e.g. "Shopify: 47 orders in the last 24h").
- If a connected tool has no fresh snapshot, call sync_now BEFORE reasoning about it.
- If any snapshot shows an error, mention the failing tool by name and either call sync_now once to retry or ask_user for updated credentials.

# Autonomy rules — you are a real digital employee who COMPLETES work end-to-end
- You are hired to FINISH the task, not narrate it. Every run must produce concrete delivered output (a sent message, an updated record, a published report, an adjusted price, a dispatched reminder) — not just observations, plans, or "I would…" statements.
- Internal + routine automated work (research, drafting, computing, reasoning, logging, sending scheduled reminders, replying to DMs within tone, generating reports, updating dashboards, adjusting prices within configured bounds, reconciling records) → EXECUTE it via the appropriate tool. Do not ask permission for work the operator already delegated to you.
- Reserve request_approval ONLY for irreversible, high-blast-radius actions: charging money above a threshold, mass public posts, legal/tax filings, deleting data, or anything a guardrail explicitly marks [REQUIRES APPROVAL].
- If you literally cannot proceed without info the business hasn't given you, call ask_user with at most one focused question. After ask_user, finish the run; you'll resume when the operator answers.
- Persist anything durable about the business with remember(key, value) so future runs are smarter.
- Your finish summary MUST list the concrete artifacts produced this run in the form "Delivered: <thing> → <where/ID>". If you delivered nothing, that is a failed run.
- Never break character. Never explain you are an LLM.


# Tools
${toolDescriptions}

# Loop protocol — output EXACTLY ONE fenced JSON block per turn:
\`\`\`json
{"action":"think","thought":"..."}
\`\`\`
\`\`\`json
{"action":"tool","tool":"<name>","input":{...}}
\`\`\`
\`\`\`json
{"action":"decide","decision":"...","rationale":"..."}
\`\`\`
\`\`\`json
{"action":"finish","summary":"..."}
\`\`\`

Rules:
- Max ${MAX_STEPS} turns.
- Use at least one real tool unless the goal genuinely needs none.
- Output ONLY the fenced JSON block. No preamble.`;

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userInstruction
        ? `Trigger: ${trigger}. Operator instruction: ${userInstruction}\nBegin.`
        : `Trigger: ${trigger}. Pursue your goal autonomously for the business above. Begin.` },
    ];

    let finalSummary = "Run ended without explicit summary.";
    let steps = 0, finished = false, paused = false;

    while (steps < MAX_STEPS && !finished && !paused) {
      steps++;
      const resp = await fetch(LOVABLE_URL, {
        method: "POST",
        headers: { "Lovable-API-Key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, messages, temperature: 0.4 }),
      });
      if (resp.status === 429) { await logEvent("error", { phase: "ai_loop", message: "Rate limit" }); break; }
      if (resp.status === 402) { await logEvent("error", { phase: "ai_loop", message: "AI credits exhausted" }); break; }
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        await logEvent("error", { phase: "ai_loop", message: `Gateway ${resp.status}`, detail: t.slice(0, 300) });
        break;
      }
      const data = await resp.json();
      const raw: string = data?.choices?.[0]?.message?.content ?? "";
      messages.push({ role: "assistant", content: raw });

      const parsed = extractAction(raw);
      if (!parsed) {
        await logEvent("error", { phase: "parse", message: "No valid action block", raw: raw.slice(0, 300) });
        messages.push({ role: "user", content: `Your last message did not contain a valid fenced JSON action block. Emit exactly one now.` });
        continue;
      }

      if (parsed.action === "think") {
        await logEvent("reason", { thought: String(parsed.thought || "").slice(0, 600) });
      } else if (parsed.action === "decide") {
        await logEvent("decision", {
          decision: String(parsed.decision || "").slice(0, 400),
          rationale: String(parsed.rationale || "").slice(0, 400),
        });
      } else if (parsed.action === "finish") {
        finalSummary = String(parsed.summary || finalSummary).slice(0, 600);
        await logEvent("finished", { summary: finalSummary });
        finished = true; break;
      } else if (parsed.action === "tool") {
        const toolName = String(parsed.tool || "");
        const tool = effectiveTools.find((t) => t.name === toolName) || effectiveTools.find((t) => t.kind === toolName);
        if (!tool) {
          await logEvent("tool_error", { tool: toolName, message: "Unknown tool" });
          messages.push({ role: "user", content: `Unknown tool "${toolName}". Available: ${effectiveTools.map((t) => t.name).join(", ")}` });
          continue;
        }
        const input = (parsed.input && typeof parsed.input === "object") ? parsed.input as Record<string, unknown> : {};
        await logEvent("tool_call", { tool: tool.name, kind: tool.kind, input });

        // Built-in interactive tools pause the run
        if (tool.kind === "ask_user") {
          const question = String(input.question || "").slice(0, 400);
          const options = Array.isArray(input.options) ? (input.options as string[]).slice(0, 4) : undefined;
          await logEvent("clarification_request", { question, options });
          paused = true;
          finalSummary = "Paused: waiting on operator clarification.";
          break;
        }
        if (tool.kind === "request_approval") {
          await logEvent("pending_approval", {
            action: String(input.action || "external action").slice(0, 200),
            payload: input.payload ?? input,
            risk: String(input.risk || "med"),
          });
          messages.push({ role: "user", content: `Approval queued. Continue with other work or finish.` });
          continue;
        }
        if (tool.kind === "remember") {
          const k = String(input.key || "").slice(0, 120);
          const v = String(input.value || "").slice(0, 600);
          if (k && v) {
            await supabase.from("agent_memory").insert({ agent_id: agentId, user_id: userId, key: k, value: v, source: "agent" });
            await logEvent("memory_write", { key: k, value: v });
            messages.push({ role: "user", content: `Memory saved: ${k}. Continue.` });
          } else {
            messages.push({ role: "user", content: `remember requires non-empty key and value.` });
          }
          continue;
        }

        if (tool.kind === "sync_integrations") {
          const providerFilter = String(input.provider || "").trim() || null;
          try {
            const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
            const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/integration-sync`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${svc}` },
              body: JSON.stringify({ cron: true }),
            });
            const body = await r.json().catch(() => ({}));
            // Re-read the latest snapshots for THIS user so the agent has fresh numbers.
            const { data: fresh } = await supabase.from("integration_snapshots")
              .select("provider, kind, data, error, fetched_at")
              .eq("user_id", userId)
              .order("fetched_at", { ascending: false }).limit(50);
            const seen = new Set<string>();
            const summary = (fresh || [])
              .filter((s) => {
                if (seen.has(s.provider as string)) return false;
                if (providerFilter && s.provider !== providerFilter) return false;
                seen.add(s.provider as string); return true;
              })
              .map((s) => `${s.provider} [${s.kind}] ${s.error ? `ERROR: ${s.error}` : JSON.stringify(s.data)}`)
              .join("\n");
            await logEvent("action", { type: "sync_integrations", ok: r.ok, providers: seen.size, cron_result: body });
            await logEvent("tool_result", { tool: tool.name, ok: r.ok, summary: summary || "No connected tools to sync." });
            messages.push({ role: "user", content: `Live data refreshed:\n${summary || "(none)"}\n\nContinue.` });
          } catch (e) {
            const msg = e instanceof Error ? e.message : "sync failed";
            await logEvent("tool_result", { tool: tool.name, ok: false, summary: msg });
            messages.push({ role: "user", content: `sync_now failed: ${msg}. Continue with what you have.` });
          }
          continue;
        }
        if (tool.kind === "integration_query") {
          const providerFilter = String(input.provider || "").trim();
          if (!providerFilter) {
            messages.push({ role: "user", content: `read_data requires a "provider" string.` });
            continue;
          }
          const { data: rows } = await supabase.from("integration_snapshots")
            .select("kind, data, error, fetched_at")
            .eq("user_id", userId).eq("provider", providerFilter)
            .order("fetched_at", { ascending: false }).limit(1);
          const snap = rows?.[0];
          const summary = snap
            ? `${providerFilter} [${snap.kind}] fetched ${snap.fetched_at}: ${snap.error ? `ERROR ${snap.error}` : JSON.stringify(snap.data)}`
            : `No snapshot yet for ${providerFilter}. Call sync_now first.`;
          await logEvent("tool_result", { tool: tool.name, ok: !!snap && !snap.error, summary });
          messages.push({ role: "user", content: `${summary}\n\nContinue.` });
          continue;
        }

        const result = await executeTool(tool, input, supabase, agentId, runId, userId, logEvent);
        await logEvent("tool_result", { tool: tool.name, ok: !result.error, summary: result.summary });
        messages.push({ role: "user", content: `Tool "${tool.name}" returned:\n${result.summary}\n\nContinue.` });
      }
    }

    if (!finished && !paused) {
      await logEvent("finished", { summary: `Reached step limit (${MAX_STEPS}).`, partial: true });
      finalSummary = `Stopped after ${steps} steps without explicit finish.`;
    }

    await supabase.from("agent_runs").update({
      status: paused ? "paused" : "completed",
      finished_at: new Date().toISOString(),
      summary: finalSummary,
    }).eq("id", runId);

    return json({ runId, summary: finalSummary, steps, paused });
  } catch (e) {
    console.error("agent-runtime error", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

function extractAction(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : raw;
  const obj = body.match(/\{[\s\S]*\}/);
  if (!obj) return null;
  try { return JSON.parse(obj[0]); } catch { return null; }
}

async function executeTool(
  tool: Tool, input: Record<string, unknown>, _supabase: SupabaseClient,
  _agentId: string, _runId: string, _userId: string,
  logEvent: (k: string, p: Record<string, unknown>) => Promise<unknown>,
): Promise<{ summary: string; error?: boolean }> {
  try {
    if (tool.kind === "web_search") {
      const query = String(input.query || tool.config?.query || "").slice(0, 200);
      if (!query) return { summary: "No query provided.", error: true };
      const key = Deno.env.get("LOVABLE_API_KEY")!;
      const resp = await fetch(LOVABLE_URL, {
        method: "POST",
        headers: { "Lovable-API-Key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: "You are a precise web research assistant. Summarize current public information in 4-6 bullets with concrete numbers/dates when possible." },
            { role: "user", content: `Research the latest on: ${query}` },
          ],
          temperature: 0.3,
        }),
      });
      if (!resp.ok) return { summary: `Search gateway ${resp.status}`, error: true };
      const data = await resp.json();
      return { summary: (data?.choices?.[0]?.message?.content ?? "(empty)").slice(0, 1200) };
    }
    if (tool.kind === "http_get") {
      const url = String(input.url || tool.config?.url || "");
      if (!/^https?:\/\//.test(url)) return { summary: "Invalid URL.", error: true };
      const resp = await fetch(url, { headers: { "User-Agent": "NazAI-Agent/1.0" } });
      const ct = resp.headers.get("content-type") || "";
      const text = await resp.text();
      const body = ct.includes("application/json") ? text.slice(0, 1200) : stripHtml(text).slice(0, 1200);
      return { summary: `HTTP ${resp.status} (${ct.split(";")[0] || "text"})\n${body}` };
    }
    if (tool.kind === "calc") {
      const expr = String(input.expression || "").replace(/[^0-9+\-*/().\s]/g, "");
      if (!expr) return { summary: "No expression.", error: true };
      try { return { summary: `Result: ${Function(`"use strict"; return (${expr});`)()}` }; }
      catch (e) { return { summary: `Calc error: ${e instanceof Error ? e.message : "unknown"}`, error: true }; }
    }
    if (tool.kind === "notify") {
      const message = String(input.message || "").slice(0, 600);
      const severity = String(input.severity || "info");
      await logEvent("action", { type: "notify", channel: tool.config?.channel || "log", severity, message });
      return { summary: `Notification logged (${severity}).` };
    }
    if (tool.kind === "custom") {
      const need = String(tool.config?.needsSecret || "");
      if (need && !Deno.env.get(need)) {
        return { summary: `Tool "${tool.name}" needs secret "${need}" — operator must add a connector. Inert for now.`, error: true };
      }
      return { summary: `Custom tool "${tool.name}" stub — no executor wired. Treat as inert and continue.`, error: true };
    }
    if (tool.kind === "deep_analyze") {
      const subject = String(input.subject || "").slice(0, 800);
      const ctx = String(input.context || "").slice(0, 4000);
      const focus = String(input.focus || "").slice(0, 300);
      if (!subject) return { summary: "deep_analyze requires a 'subject'.", error: true };
      const key = Deno.env.get("LOVABLE_API_KEY")!;
      const resp = await fetch(LOVABLE_URL, {
        method: "POST",
        headers: { "Lovable-API-Key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: DEEP_MODEL,
          messages: [
            { role: "system", content: "You are a senior operator (strategy + engineering + ops). Produce a rigorous structured diagnosis. Sections: 1) Findings (bullet list, evidence-based), 2) Root causes, 3) Risks / blast radius, 4) Prioritized fixes (P0/P1/P2 with owner + expected impact + effort), 5) Success metrics. Be concrete, name numbers/URLs when given, never vague." },
            { role: "user", content: `Subject: ${subject}\nFocus: ${focus || "(none — decide what matters)"}\nContext:\n${ctx || "(none provided)"}` },
          ],
          temperature: 0.3,
        }),
      });
      if (!resp.ok) return { summary: `deep_analyze gateway ${resp.status}`, error: true };
      const data = await resp.json();
      return { summary: (data?.choices?.[0]?.message?.content ?? "(empty)").slice(0, 3500) };
    }
    if (tool.kind === "audit_url") {
      const url = String(input.url || "");
      const focus = String(input.focus || "").slice(0, 300);
      if (!/^https?:\/\//.test(url)) return { summary: "audit_url requires a valid http(s) URL.", error: true };
      let pageText = "";
      try {
        const r = await fetch(url, { headers: { "User-Agent": "NazAI-Agent/1.0" } });
        const t = await r.text();
        pageText = stripHtml(t).slice(0, 8000);
      } catch (e) {
        return { summary: `Fetch failed: ${e instanceof Error ? e.message : "unknown"}`, error: true };
      }
      const key = Deno.env.get("LOVABLE_API_KEY")!;
      const resp = await fetch(LOVABLE_URL, {
        method: "POST",
        headers: { "Lovable-API-Key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: DEEP_MODEL,
          messages: [
            { role: "system", content: "You audit web pages / documents. Produce: 1) What the page is trying to do (1 line), 2) What's WRONG (specific — copy, structure, clarity, CTA, credibility, SEO, technical), 3) What's MISSING, 4) Prioritized fixes (P0/P1/P2, each with exact suggested change), 5) One-paragraph rewrite of the hero if applicable. Cite quoted text from the page as evidence. Be blunt and useful." },
            { role: "user", content: `URL: ${url}\nFocus: ${focus || "(none — full audit)"}\n\nPAGE CONTENT (stripped):\n${pageText}` },
          ],
          temperature: 0.3,
        }),
      });
      if (!resp.ok) return { summary: `audit_url gateway ${resp.status}`, error: true };
      const data = await resp.json();
      return { summary: (data?.choices?.[0]?.message?.content ?? "(empty)").slice(0, 3500) };
    }
    if (tool.kind === "make_plan") {
      const objective = String(input.objective || "").slice(0, 600);
      const constraints = String(input.constraints || "").slice(0, 800);
      if (!objective) return { summary: "make_plan requires an 'objective'.", error: true };
      const key = Deno.env.get("LOVABLE_API_KEY")!;
      const resp = await fetch(LOVABLE_URL, {
        method: "POST",
        headers: { "Lovable-API-Key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: DEEP_MODEL,
          messages: [
            { role: "system", content: "You produce concrete execution plans. Output a numbered list. Each step: [Owner] Action → Tool/how → Success criterion. End with a Kickoff step the agent will execute right now. No fluff, no restating the objective." },
            { role: "user", content: `Objective: ${objective}\nConstraints: ${constraints || "(none)"}` },
          ],
          temperature: 0.3,
        }),
      });
      if (!resp.ok) return { summary: `make_plan gateway ${resp.status}`, error: true };
      const data = await resp.json();
      return { summary: (data?.choices?.[0]?.message?.content ?? "(empty)").slice(0, 3000) };
    }
    return { summary: `Unknown tool kind ${tool.kind}.`, error: true };
  } catch (e) {
    return { summary: `Tool exception: ${e instanceof Error ? e.message : "unknown"}`, error: true };
  }
}


function stripHtml(s: string): string {
  return s.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
