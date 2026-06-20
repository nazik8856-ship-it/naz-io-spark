// Generic autonomous agent runtime. Executes one run of an agent.
// Input: { agentId: string, trigger?: "manual"|"cron"|"webhook", userInstruction?: string }
// Streams agent_events to the DB; returns { runId, summary, eventsCount }.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";
const MAX_STEPS = 12;

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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "Not authenticated" }, 401);

    const { data: agent, error: agentErr } = await supabase
      .from("agents").select("*").eq("id", agentId).eq("user_id", user.id).single();
    if (agentErr || !agent) return json({ error: "Agent not found" }, 404);

    const manifest = agent.manifest as Manifest;

    const { data: run, error: runErr } = await supabase
      .from("agent_runs")
      .insert({ agent_id: agentId, user_id: user.id, trigger, status: "running" })
      .select("id").single();
    if (runErr || !run) return json({ error: "Could not start run" }, 500);
    const runId = run.id as string;

    const logEvent = (kind: string, payload: Record<string, unknown>) =>
      supabase.from("agent_events").insert({
        run_id: runId, agent_id: agentId, user_id: user.id, kind, payload,
      });

    await logEvent("run_started", { trigger, goal: manifest.goal });
    await logEvent("reason", { thought: `Agent booted. Planning first action toward goal: ${manifest.goal}` });

    // Build tool list & detect missing secrets
    const missingSecrets: string[] = [];
    for (const t of manifest.tools) {
      if (t.kind === "custom") {
        const need = String(t.config?.needsSecret || "");
        if (need && !Deno.env.get(need)) missingSecrets.push(need);
      }
    }
    if (missingSecrets.length) {
      await logEvent("guardrail_block", {
        reason: "Missing secrets",
        secrets: missingSecrets,
        message: `Tools requiring these secrets are inert until configured: ${missingSecrets.join(", ")}`,
      });
    }

    const toolDescriptions = manifest.tools.map((t) => {
      let usage = "";
      if (t.kind === "web_search") usage = `web_search(query: string)`;
      else if (t.kind === "http_get") usage = `http_get(url: string)`;
      else if (t.kind === "calc") usage = `calc(expression: string)  // arithmetic only`;
      else if (t.kind === "notify") usage = `notify(message: string, severity?: "info"|"warn"|"alert")`;
      else usage = `${t.name}(...)  // CUSTOM — currently inert`;
      return `- ${t.name} (${t.kind}): ${t.description}\n  Usage: ${usage}`;
    }).join("\n");

    const systemPrompt = `${manifest.systemPrompt}

# Your operating contract
- Goal: ${manifest.goal}
- Decision policy: ${manifest.decisionPolicy}
- Guardrails: ${manifest.guardrails.map((g) => `${g.rule}${g.requiresApproval ? " [REQUIRES APPROVAL]" : ""}`).join("; ")}
- KPIs you optimize for: ${manifest.kpis.map((k) => `${k.name}=${k.target}`).join(", ")}

# Tools available (call by emitting a single fenced JSON block)
${toolDescriptions}

# Loop protocol — MUST follow strictly
On each turn output EXACTLY ONE fenced JSON block of one of these shapes:

\`\`\`json
{"action": "think", "thought": "<short reasoning>"}
\`\`\`

\`\`\`json
{"action": "tool", "tool": "<tool_name>", "input": { ... }}
\`\`\`

\`\`\`json
{"action": "decide", "decision": "<the autonomous decision you made>", "rationale": "<short why>"}
\`\`\`

\`\`\`json
{"action": "finish", "summary": "<1-2 sentence summary of what you accomplished this run>"}
\`\`\`

Rules:
- Take at most ${MAX_STEPS} turns total.
- Call at least one real tool before finishing unless the goal genuinely needs no external data.
- Honor guardrails — if a step requires approval, emit a "decide" action recommending it instead of acting.
- Never break character. Never explain you are an LLM.
- Output ONLY the fenced JSON block. No preamble.`;

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: userInstruction
          ? `Trigger: ${trigger}. User instruction: ${userInstruction}\nBegin the autonomous loop now.`
          : `Trigger: ${trigger}. Pursue your goal autonomously. Begin the loop now.`,
      },
    ];

    let finalSummary = "Run ended without explicit summary.";
    let steps = 0;
    let finished = false;

    while (steps < MAX_STEPS && !finished) {
      steps++;
      const resp = await fetch(LOVABLE_URL, {
        method: "POST",
        headers: { "Lovable-API-Key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, messages, temperature: 0.4 }),
      });
      if (resp.status === 429) { await logEvent("error", { message: "Rate limit hit" }); break; }
      if (resp.status === 402) { await logEvent("error", { message: "AI credits exhausted" }); break; }
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        await logEvent("error", { message: `Gateway ${resp.status}`, detail: t.slice(0, 300) });
        break;
      }
      const data = await resp.json();
      const raw: string = data?.choices?.[0]?.message?.content ?? "";
      messages.push({ role: "assistant", content: raw });

      const parsed = extractAction(raw);
      if (!parsed) {
        await logEvent("error", { message: "Could not parse action", raw: raw.slice(0, 400) });
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
        finished = true;
        break;
      } else if (parsed.action === "tool") {
        const toolName = String(parsed.tool || "");
        const tool = manifest.tools.find((t) => t.name === toolName);
        if (!tool) {
          await logEvent("tool_error", { tool: toolName, message: "Unknown tool" });
          messages.push({ role: "user", content: `Unknown tool "${toolName}". Available: ${manifest.tools.map((t) => t.name).join(", ")}` });
          continue;
        }
        const input = (parsed.input && typeof parsed.input === "object") ? parsed.input as Record<string, unknown> : {};
        await logEvent("tool_call", { tool: tool.name, kind: tool.kind, input });
        const result = await executeTool(tool, input, supabase, agentId, runId, user.id, logEvent);
        await logEvent("tool_result", { tool: tool.name, ok: !result.error, summary: result.summary });
        messages.push({
          role: "user",
          content: `Tool "${tool.name}" returned:\n${result.summary}\n\nContinue the loop.`,
        });
      }
    }

    if (!finished) {
      await logEvent("finished", { summary: `Reached step limit (${MAX_STEPS}).`, partial: true });
      finalSummary = `Stopped after ${steps} steps without explicit finish.`;
    }

    await supabase.from("agent_runs").update({
      status: "completed",
      finished_at: new Date().toISOString(),
      summary: finalSummary,
    }).eq("id", runId);

    return json({ runId, summary: finalSummary, steps });
  } catch (e) {
    console.error("agent-runtime error", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractAction(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : raw;
  const obj = body.match(/\{[\s\S]*\}/);
  if (!obj) return null;
  try { return JSON.parse(obj[0]); } catch { return null; }
}

async function executeTool(
  tool: Tool,
  input: Record<string, unknown>,
  _supabase: SupabaseClient,
  _agentId: string,
  _runId: string,
  _userId: string,
  logEvent: (kind: string, payload: Record<string, unknown>) => Promise<unknown>,
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
            { role: "system", content: "You are a precise web research assistant. Summarize current public information in 4-6 bullet points with concrete numbers/dates when possible." },
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
      const body = ct.includes("application/json")
        ? text.slice(0, 1200)
        : stripHtml(text).slice(0, 1200);
      return { summary: `HTTP ${resp.status} (${ct.split(";")[0] || "text"})\n${body}` };
    }
    if (tool.kind === "calc") {
      const expr = String(input.expression || "").replace(/[^0-9+\-*/().\s]/g, "");
      if (!expr) return { summary: "No expression.", error: true };
      // safe arithmetic evaluator
      try {
        const value = Function(`"use strict"; return (${expr});`)();
        return { summary: `Result: ${value}` };
      } catch (e) {
        return { summary: `Calc error: ${e instanceof Error ? e.message : "unknown"}`, error: true };
      }
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
        return { summary: `Tool "${tool.name}" needs secret "${need}" — request user to add it. Pausing this branch.`, error: true };
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
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ").trim();
}
