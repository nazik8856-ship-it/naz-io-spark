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
const MAX_STEPS = 14;

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

    const toolDescriptions = manifest.tools.map((t) => {
      let usage = "";
      switch (t.kind) {
        case "web_search": usage = `web_search(query: string)`; break;
        case "http_get": usage = `http_get(url: string)`; break;
        case "calc": usage = `calc(expression: string)`; break;
        case "notify": usage = `notify(message: string, severity?: "info"|"warn"|"alert")`; break;
        case "remember": usage = `remember(key: string, value: string)  // persist a fact for future runs`; break;
        case "ask_user": usage = `ask_user(question: string, options?: string[])  // pauses the agent until the operator answers`; break;
        case "request_approval": usage = `request_approval(action: string, payload: object, risk?: "low"|"med"|"high")  // queue an external action`; break;
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
${memoryBlock}

# Autonomy rules — you are a real digital employee, not a chatbot
- Internal work (research, drafting, computing, reasoning, logging) → DO IT, don't ask permission.
- External actions (sending emails, posting publicly, charging money, messaging customers) → call request_approval with the full draft. NEVER execute them directly.
- If you literally cannot proceed without info the business hasn't given you, call ask_user with at most one focused question. After ask_user, finish the run; you'll resume when the operator answers.
- Persist anything durable about the business with remember(key, value) so future runs are smarter.
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
        const tool = manifest.tools.find((t) => t.name === toolName) || manifest.tools.find((t) => t.kind === toolName);
        if (!tool) {
          await logEvent("tool_error", { tool: toolName, message: "Unknown tool" });
          messages.push({ role: "user", content: `Unknown tool "${toolName}". Available: ${manifest.tools.map((t) => t.name).join(", ")}` });
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
