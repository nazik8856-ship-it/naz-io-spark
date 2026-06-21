// Compile an approved AI Agent plan into a strict, executable manifest.
// Input: { plan: string }
// Output: { manifest: AgentManifest }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

const MANIFEST_SCHEMA_DOC = `Return STRICT JSON only — no markdown fences, no commentary.

Shape:
{
  "name": string,
  "goal": string,
  "systemPrompt": string,        // <= 1200 chars, written in second person, makes it act in-character as the autonomous agent
  "decisionPolicy": string,      // short rule for when to act vs. ask the user
  "tools": [
    {
      "name": string,            // snake_case
      "description": string,
      "kind": "web_search" | "http_get" | "calc" | "notify" | "custom",
      "config": {                // shape depends on kind
        "url"?: string,          // for http_get
        "query"?: string,        // for web_search default
        "channel"?: string,      // for notify: "log" | "email" | "webhook"
        "needsSecret"?: string   // env var name required for custom tools
      }
    }
  ],
  "triggers": [
    { "kind": "manual" | "cron" | "webhook", "spec": string }   // spec is cron expression, webhook event name, or "on-demand"
  ],
  "guardrails": [
    { "rule": string, "requiresApproval": boolean }
  ],
  "kpis": [
    { "name": string, "target": string }
  ],
  "ui": {
    "theme": "obsidian" | "cyber" | "terminal" | "market" | "command" | "lab",
    "accent": string,           // hex color tuned to the agent's domain (e.g. "#f59e0b" for finance, "#22d3ee" for ops)
    "accentSecondary": string,  // complementary hex
    "hero": { "title": string, "tagline": string, "icon": string },  // icon = one of: brain, activity, wallet, gauge, signal, radar, terminal, rocket, eye, crosshair, shield, flame, sparkles, cpu, globe, line, bars, trending, zap, alert, check, wrench
    "layout": "command-deck" | "market-board" | "lab-console" | "stacked" | "two-col",
    "widgets": [
      // 6-10 widgets that together form a domain-specific dashboard for THIS agent.
      // Choose, order, and title them so the screen feels purpose-built (e.g. a crypto agent gets metric tiles + decision log + tool-call stream + guardrails; a research agent gets thought stream + decision log + KPI radar).
      // Allowed widget kinds:
      //   { "kind": "hero_metric", "title": string, "valueFrom": "events_count"|"decisions_count"|"actions_count"|"tool_calls_count"|"thoughts_count"|"errors_count", "subtitle"?: string, "span"?: 1|2|3 }
      //   { "kind": "live_thoughts", "title": string, "limit"?: number, "span"?: 2|3|4 }
      //   { "kind": "decision_log", "title": string, "limit"?: number, "span"?: 2|3|4 }
      //   { "kind": "action_timeline", "title": string, "limit"?: number, "span"?: 2|3|4 }
      //   { "kind": "tool_call_stream", "title": string, "limit"?: number, "span"?: 2|3|4 }
      //   { "kind": "alert_feed", "title": string, "severity"?: "warn"|"alert"|"info"|"all", "span"?: 2|3|4 }
      //   { "kind": "tool_grid", "title": string, "span"?: 2|3 }
      //   { "kind": "kpi_radar", "title": string, "span"?: 2|3 }
      //   { "kind": "guardrail_panel", "title": string, "span"?: 2|3 }
      //   { "kind": "status_grid", "title": string, "items": [{ "label": string, "valueFrom": "events_count"|"decisions_count"|"actions_count"|"tool_calls_count"|"thoughts_count"|"errors_count" }], "span"?: 2|3 }
    ]
  }
}

Rules:
- 3-6 tools maximum. Prefer "web_search", "http_get", "calc", "notify" over "custom".
- If the plan mentions an external SaaS (Stripe, Slack, Shopify, etc.) and a built-in kind doesn't cover it, use "custom" with config.needsSecret = the env var name (e.g. "STRIPE_API_KEY").
- At least one trigger. Prefer "manual" if the plan doesn't specify a schedule.
- 2-4 guardrails. Mark requiresApproval=true for anything that spends money, sends external messages, or mutates external systems.
- 2-4 KPIs with concrete numeric targets.
- ui MUST feel domain-specific: titles, theme/accent, widget choice and order should evoke the agent's actual job (crypto, ops, research, sales, support, security, growth, etc.). Don't return a generic dashboard.
- Title widgets with verbs/domain language ("Market scans", "Approvals queued", "Alpha leads found", "Anomalies caught"), not "Activity feed".
- systemPrompt must make the model behave AS the agent — "You are <name>. You autonomously …". Never reveal it is an LLM.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) return json({ error: "Missing LOVABLE_API_KEY" }, 500);

    const { plan, save = true } = await req.json();
    if (!plan || typeof plan !== "string") return json({ error: "plan required" }, 400);

    const resp = await fetch(LOVABLE_URL, {
      method: "POST",
      headers: { "Lovable-API-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content: `You are NazAI Agent Compiler. You convert an approved AI agent plan into a strict, executable Agent Manifest.\n\n${MANIFEST_SCHEMA_DOC}`,
          },
          {
            role: "user",
            content: `Compile this plan into the Agent Manifest JSON. Return only the JSON object.\n\nPLAN:\n${plan}`,
          },
        ],
        temperature: 0.2,
      }),
    });

    if (resp.status === 429) return json({ error: "Rate limit hit. Try again shortly." }, 429);
    if (resp.status === 402) return json({ error: "AI credits exhausted." }, 402);
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      console.error("compile gateway error", resp.status, t);
      return json({ error: "AI error" }, 500);
    }

    const data = await resp.json();
    const raw: string = data?.choices?.[0]?.message?.content ?? "";
    const manifest = extractJson(raw);
    if (!manifest || typeof manifest !== "object") {
      return json({ error: "Manifest did not parse", raw }, 422);
    }

    const normalized = normalizeManifest(manifest);
    if (!normalized.name || !normalized.tools.length) {
      return json({ error: "Manifest missing required fields", manifest: normalized }, 422);
    }

    let agentId: string | null = null;
    let persistError: string | null = null;
    if (save) {
      const authHeader = req.headers.get("Authorization") ?? "";
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) {
        console.error("compile: no user from Authorization header", userErr?.message);
        return json({
          error: "Not authenticated — sign in to deploy a real autonomous agent.",
          manifest: normalized,
          agentId: null,
        }, 401);
      }
      const slug = slugify(normalized.name);
      const { data: inserted, error: insErr } = await supabase
        .from("agents")
        .insert({
          user_id: user.id,
          name: normalized.name,
          slug,
          goal: normalized.goal,
          manifest: normalized,
          source_plan: plan.slice(0, 8000),
          status: "active",
        })
        .select("id")
        .single();
      if (insErr) {
        console.error("agent insert error", insErr);
        persistError = insErr.message;
      } else {
        agentId = inserted?.id ?? null;
      }
    }

    if (save && !agentId) {
      return json({
        error: persistError || "Could not persist agent.",
        manifest: normalized,
        agentId: null,
      }, 500);
    }

    return json({ manifest: normalized, agentId });
  } catch (e) {
    console.error("compile-agent-manifest error", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  const cleaned = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* fallthrough */ }
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

type Tool = { name: string; description: string; kind: string; config: Record<string, unknown> };
type Trigger = { kind: string; spec: string };
type Guardrail = { rule: string; requiresApproval: boolean };
type Kpi = { name: string; target: string };
type Manifest = {
  name: string;
  goal: string;
  systemPrompt: string;
  decisionPolicy: string;
  tools: Tool[];
  triggers: Trigger[];
  guardrails: Guardrail[];
  kpis: Kpi[];
};

function normalizeManifest(m: Record<string, unknown>): Manifest {
  const tools = Array.isArray(m.tools) ? (m.tools as Record<string, unknown>[]) : [];
  const triggers = Array.isArray(m.triggers) ? (m.triggers as Record<string, unknown>[]) : [];
  const guardrails = Array.isArray(m.guardrails) ? (m.guardrails as Record<string, unknown>[]) : [];
  const kpis = Array.isArray(m.kpis) ? (m.kpis as Record<string, unknown>[]) : [];
  return {
    name: String(m.name || "Autonomous Agent").slice(0, 80),
    goal: String(m.goal || "").slice(0, 400),
    systemPrompt: String(m.systemPrompt || "").slice(0, 2000),
    decisionPolicy: String(m.decisionPolicy || "Act when confident; otherwise log and pause for review.").slice(0, 400),
    tools: tools.slice(0, 8).map((t) => ({
      name: String(t.name || "tool").slice(0, 60),
      description: String(t.description || "").slice(0, 300),
      kind: ["web_search", "http_get", "calc", "notify", "custom"].includes(String(t.kind)) ? String(t.kind) : "custom",
      config: (t.config && typeof t.config === "object") ? (t.config as Record<string, unknown>) : {},
    })),
    triggers: (triggers.length ? triggers : [{ kind: "manual", spec: "on-demand" }]).slice(0, 4).map((t) => ({
      kind: ["manual", "cron", "webhook"].includes(String(t.kind)) ? String(t.kind) : "manual",
      spec: String(t.spec || "on-demand").slice(0, 120),
    })),
    guardrails: guardrails.slice(0, 6).map((g) => ({
      rule: String(g.rule || "").slice(0, 300),
      requiresApproval: !!g.requiresApproval,
    })),
    kpis: kpis.slice(0, 6).map((k) => ({
      name: String(k.name || "").slice(0, 80),
      target: String(k.target || "").slice(0, 120),
    })),
  };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "agent";
}
