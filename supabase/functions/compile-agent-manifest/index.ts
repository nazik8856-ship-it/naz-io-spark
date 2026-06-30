// Compile an approved AI Agent plan into a strict, executable manifest.
// Now business-aware: pulls/creates a Business Profile, picks a role blueprint,
// assigns a default schedule, and persists the agent with all of it.
// Input: { plan: string, businessProfileId?: string, userPrompt?: string,
//          intakeAnswers?: Record<string,string>, role?: string }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

type Automation = {
  name: string;
  trigger: string;     // e.g. "Every 15 min" / "On Stripe webhook" / "Daily 07:00"
  source: string;      // integration/data source it monitors
  condition: string;   // the rule
  action: string;      // what it executes
  integrations: string[]; // tools touched
  requiresApproval?: boolean;
};

const ROLE_LIBRARY: Record<string, {
  goal: string;
  decisionPolicy: string;
  schedule_cron: string;
  schedule_label: string;
  kpis: { name: string; target: string }[];
  guardrails: { rule: string; requiresApproval: boolean }[];
  tools: string[]; // hint
  workflowSummary: string;
  automations: Automation[];
}> = {
  sales_ops: {
    goal: "Find qualified prospects, draft personalized outreach, follow up on cadence, and keep a clean pipeline log.",
    decisionPolicy: "Draft and queue all outbound for approval; only research and log autonomously.",
    schedule_cron: "0 9 * * *", schedule_label: "Daily at 09:00 UTC",
    kpis: [
      { name: "Qualified prospects/day", target: "10" },
      { name: "Reply rate", target: ">= 8%" },
      { name: "Pipeline updates/week", target: ">= 20" },
    ],
    guardrails: [
      { rule: "Never send outbound emails without explicit approval.", requiresApproval: true },
      { rule: "Never promise discounts above policy.", requiresApproval: true },
    ],
    tools: ["web_search", "http_get", "notify", "remember", "request_approval", "ask_user"],
    workflowSummary:
      "Every morning the agent pulls fresh prospect signals, scores them, drafts personalized outreach, and queues it for one-click approval. Throughout the day it watches replies and pipeline events, advances stages in your CRM, and nudges stalled deals — so the rep only handles humans, not data entry.",
    automations: [
      { name: "Daily prospect refresh", trigger: "Daily 09:00", source: "HubSpot / Apollo", condition: "New companies match ICP filters", action: "Enrich, score, and add 10 to today's outreach queue", integrations: ["HubSpot", "Apollo"] },
      { name: "Reply-triggered stage move", trigger: "On Gmail webhook", source: "Gmail / Outlook", condition: "Positive intent reply detected", action: "Move deal to 'Engaged', notify owner in Slack", integrations: ["Gmail", "HubSpot", "Slack"] },
      { name: "Stalled deal nudge", trigger: "Every 4h", source: "HubSpot deals", condition: "Deal idle > 7 days in stage", action: "Draft follow-up email for approval", integrations: ["HubSpot", "Gmail"], requiresApproval: true },
      { name: "Pipeline hygiene", trigger: "Daily 18:00", source: "HubSpot", condition: "Missing close date or amount", action: "Patch fields from email thread + flag exceptions", integrations: ["HubSpot"] },
    ],
  },
  support: {
    goal: "Triage inbound issues, classify urgency, draft brand-tone replies, escalate when needed.",
    decisionPolicy: "Draft replies autonomously; require approval before any external send.",
    schedule_cron: "*/10 * * * *", schedule_label: "Every 10 minutes",
    kpis: [
      { name: "First-touch latency", target: "< 5 min (draft)" },
      { name: "Escalation precision", target: ">= 90%" },
      { name: "Backlog", target: "< 10 open" },
    ],
    guardrails: [
      { rule: "Do not send replies externally without approval.", requiresApproval: true },
      { rule: "Escalate anything mentioning refunds, legal, or churn.", requiresApproval: true },
    ],
    tools: ["web_search", "notify", "remember", "request_approval", "ask_user"],
    workflowSummary:
      "The agent watches your inbox and helpdesk in real time. Every new ticket gets classified, tagged, and a brand-tone draft reply within minutes. Refund, legal, and churn signals jump straight to a human; everything else moves through one-click approval — keeping first-response times under 5 minutes around the clock.",
    automations: [
      { name: "Inbox triage", trigger: "Every 10 min", source: "Gmail / Zendesk / Intercom", condition: "New unread customer message", action: "Classify intent + urgency, draft reply, attach to ticket", integrations: ["Gmail", "Zendesk", "Intercom"] },
      { name: "Refund risk escalation", trigger: "On new ticket", source: "Helpdesk", condition: "Keywords: refund, chargeback, lawyer, cancel", action: "Flag P1, notify on-call in Slack, draft empathetic hold reply", integrations: ["Slack", "Zendesk"], requiresApproval: true },
      { name: "SLA breach watch", trigger: "Every 15 min", source: "Helpdesk", condition: "Ticket open > SLA target", action: "Re-prioritize queue and ping owner", integrations: ["Slack", "Zendesk"] },
      { name: "Macro tuning", trigger: "Weekly Mon 08:00", source: "Resolved tickets", condition: "Repeated question (≥3 last week)", action: "Propose new macro/help-doc for approval", integrations: ["Notion", "Zendesk"], requiresApproval: true },
    ],
  },
  marketing: {
    goal: "Maintain a content calendar, draft posts in brand tone, monitor mentions and SEO, and publish a weekly brief.",
    decisionPolicy: "Generate drafts and weekly briefs autonomously; require approval before posting publicly.",
    schedule_cron: "0 8 * * 1", schedule_label: "Mondays at 08:00 UTC",
    kpis: [
      { name: "Drafts/week", target: ">= 5" },
      { name: "Mentions tracked", target: ">= 20/week" },
      { name: "Weekly brief", target: "delivered every Mon" },
    ],
    guardrails: [
      { rule: "Never publish to social/blog without approval.", requiresApproval: true },
      { rule: "Stay within stated brand tone and forbidden-topics list.", requiresApproval: false },
    ],
    tools: ["web_search", "http_get", "notify", "remember", "request_approval", "ask_user"],
    workflowSummary:
      "The agent runs your content engine on autopilot: it watches mentions and SEO movement daily, drafts 5+ posts per week in your brand tone, monitors ad performance, and pauses underperformers. Every Monday it ships a one-page brief with what shipped, what worked, and what's queued for approval.",
    automations: [
      { name: "Underperforming ad pause", trigger: "Every 1h", source: "Meta Ads / Google Ads", condition: "ROAS < target for 24h", action: "Pause adset, notify with diagnosis", integrations: ["Meta Ads", "Google Ads", "Slack"], requiresApproval: true },
      { name: "Mention sweep", trigger: "Every 2h", source: "Web + X/Twitter", condition: "Brand mentioned", action: "Log sentiment, draft response for review", integrations: ["X", "Slack"] },
      { name: "Content drafts", trigger: "Daily 07:00", source: "Calendar + trend feed", condition: "Empty slot in next 7 days", action: "Generate post draft in brand tone", integrations: ["Notion", "Buffer"], requiresApproval: true },
      { name: "Weekly performance brief", trigger: "Mon 08:00", source: "GA4 + Ads + Social", condition: "Always", action: "Ship 1-page brief to founder", integrations: ["GA4", "Meta Ads", "Email"] },
    ],
  },
  ops_finance: {
    goal: "Compute daily KPI digest, surface anomalies, send invoice/renewal reminders to the user.",
    decisionPolicy: "Compute and report autonomously; require approval before any external billing action.",
    schedule_cron: "0 7 * * *", schedule_label: "Daily at 07:00 UTC",
    kpis: [
      { name: "Daily digest", target: "delivered every day" },
      { name: "Anomaly precision", target: ">= 85%" },
      { name: "Invoices nudged", target: "all overdue" },
    ],
    guardrails: [
      { rule: "Never charge customers or move funds without approval.", requiresApproval: true },
      { rule: "Flag any KPI change > 25% as an anomaly.", requiresApproval: false },
    ],
    tools: ["calc", "http_get", "notify", "remember", "request_approval", "ask_user"],
    workflowSummary:
      "Every morning the agent reconciles yesterday's sales, payouts, refunds, and inventory across Stripe, Shopify, and QuickBooks. It catches anomalies (>25% swings, low cash runway, overdue invoices, low stock) and either fixes them inside policy or drafts the action for one-click approval — closing the loop on daily ops without you opening a spreadsheet.",
    automations: [
      { name: "Daily cash & sales reconcile", trigger: "Daily 07:00", source: "Stripe + Shopify + QuickBooks", condition: "Always", action: "Post digest with revenue, refunds, top SKUs, anomalies", integrations: ["Stripe", "Shopify", "QuickBooks", "Slack"] },
      { name: "Low stock reorder", trigger: "Every 30 min", source: "Shopify inventory", condition: "SKU < reorder point", action: "Draft PO in QuickBooks, ping ops", integrations: ["Shopify", "QuickBooks"], requiresApproval: true },
      { name: "Overdue invoice nudge", trigger: "Daily 10:00", source: "QuickBooks / Xero", condition: "Invoice 7+ days overdue", action: "Draft polite reminder email", integrations: ["QuickBooks", "Gmail"], requiresApproval: true },
      { name: "Cash-runway guardrail", trigger: "Daily 08:00", source: "Bank + Stripe", condition: "Runway < 60 days", action: "Pause discretionary ad spend, alert founder", integrations: ["Meta Ads", "Slack"], requiresApproval: true },
      { name: "Price-elasticity nudge", trigger: "Weekly Sun 22:00", source: "Shopify + GA4", condition: "Conversion ↓ & margin headroom", action: "Propose ±5% price test for approval", integrations: ["Shopify", "GA4"], requiresApproval: true },
    ],
  },
  custom: {
    goal: "Execute the operator's stated objective autonomously, asking the user only when essential.",
    decisionPolicy: "Act on internal/read-only tasks autonomously; queue external actions for approval.",
    schedule_cron: "0 */6 * * *", schedule_label: "Every 6 hours",
    kpis: [{ name: "Goal progress", target: "measurable per run" }],
    guardrails: [
      { rule: "Never perform irreversible external actions without approval.", requiresApproval: true },
    ],
    tools: ["web_search", "http_get", "calc", "notify", "remember", "request_approval", "ask_user"],
    workflowSummary:
      "The agent runs on the schedule you set, monitors the data sources you connect, applies your rules, and either acts inside policy or queues the action for approval — turning manual checks into a hands-free loop.",
    automations: [
      { name: "Signal sweep", trigger: "Every 6h", source: "Connected tools", condition: "New events since last run", action: "Summarize, score, and route to the right next step", integrations: ["Slack", "Email"] },
      { name: "Threshold alert", trigger: "Every 1h", source: "Connected KPIs", condition: "Metric crosses user-set threshold", action: "Notify operator with context + recommended action", integrations: ["Slack"] },
      { name: "Weekly recap", trigger: "Mon 08:00", source: "Run history", condition: "Always", action: "Ship recap of decisions, actions, and wins", integrations: ["Email"] },
    ],
  },
};

function pickRole(plan: string, hinted?: string): keyof typeof ROLE_LIBRARY {
  if (hinted && hinted in ROLE_LIBRARY) return hinted as keyof typeof ROLE_LIBRARY;
  const p = plan.toLowerCase();
  if (/\b(support|ticket|inbox|helpdesk|customer service|complaint)\b/.test(p)) return "support";
  if (/\b(sales|lead|prospect|outreach|sdr|crm|pipeline|cold email)\b/.test(p)) return "sales_ops";
  if (/\b(market|content|seo|social|blog|post|brand|campaign|mention)\b/.test(p)) return "marketing";
  if (/\b(finance|invoice|kpi|report|anomaly|revenue|metric|dashboard|ops|operations)\b/.test(p)) return "ops_finance";
  return "custom";
}

const MANIFEST_SCHEMA_DOC = `Return STRICT JSON only — no markdown fences, no commentary.

Shape: {
  "name": string, "goal": string,
  "systemPrompt": string,        // <= 1400 chars, in-character, references the business
  "decisionPolicy": string,
  "tools": [ { "name": string, "description": string, "kind": "web_search"|"http_get"|"calc"|"notify"|"remember"|"ask_user"|"request_approval"|"custom", "config": object } ],
  "triggers": [ { "kind": "manual"|"cron"|"webhook", "spec": string } ],
  "guardrails": [ { "rule": string, "requiresApproval": boolean } ],
  "kpis": [ { "name": string, "target": string } ],
  "ui": { "theme": "obsidian"|"cyber"|"terminal"|"market"|"command"|"lab", "accent": string, "accentSecondary": string,
    "hero": { "title": string, "tagline": string, "icon": string },
    "layout": "command-deck"|"market-board"|"lab-console"|"stacked"|"two-col",
    "widgets": [ /* 6-10 widgets, see allowed kinds */ ] }
}

Allowed widget kinds: hero_metric, live_thoughts, decision_log, action_timeline, tool_call_stream, alert_feed, tool_grid, kpi_radar, guardrail_panel, status_grid, automation_rules, workflow_summary.
Allowed icons: brain, activity, wallet, gauge, signal, radar, terminal, rocket, eye, crosshair, shield, flame, sparkles, cpu, globe, line, bars, trending, zap, alert, check, wrench.

Rules:
- The agent MUST behave like a real digital employee of the given business — reference its name, industry, tone, audience in systemPrompt.
- Include the role's required tools (remember, ask_user, request_approval) so the agent can persist learnings, ask the operator essentials, and queue approvals.
- 2-4 guardrails. Mark requiresApproval=true for anything external/spend/messages.
- 6-10 widgets tuned to the role's day-to-day surface (Sales: pipeline + approvals; Support: queue + drafts + escalations; etc.). ALWAYS include one automation_rules widget and one workflow_summary widget so the operator sees how their workflow is automated.
- workflowSummary: 2-4 sentences in plain English describing how the agent automates the operator's daily/weekly workflow end-to-end.
- automations: 3-6 entries. Each is a real "MONITORS source → IF condition → THEN action" rule with concrete integrations (Shopify, Stripe, QuickBooks, HubSpot, Gmail, Slack, GA4, Meta Ads, Xero, Klaviyo, WooCommerce, Notion, etc.). Mark requiresApproval=true for anything that sends/charges/posts externally.
- Never reveal it is an LLM. Always act in-character.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) return json({ error: "Missing LOVABLE_API_KEY" }, 500);

    const body = await req.json();
    const { plan, save = true, businessProfileId, userPrompt = "", intakeAnswers = {}, role: roleHint } = body || {};
    if (!plan || typeof plan !== "string") return json({ error: "plan required" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;

    // Resolve business profile (optional)
    let profile: Record<string, unknown> | null = null;
    if (businessProfileId && user) {
      const { data } = await supabase.from("business_profiles").select("*").eq("id", businessProfileId).eq("user_id", user.id).maybeSingle();
      profile = data ?? null;
    }

    const role = pickRole(plan + " " + userPrompt, roleHint);
    const blueprint = ROLE_LIBRARY[role];

    const intakeBlock = Object.keys(intakeAnswers).length
      ? `\n\nUSER ANSWERED INTAKE QUESTIONS:\n${Object.entries(intakeAnswers).map(([k, v]) => `- ${k}: ${v}`).join("\n")}`
      : "";

    const profileBlock = profile
      ? `\n\nBUSINESS PROFILE (use it!):\n${JSON.stringify({
          company_name: profile.company_name, one_liner: profile.one_liner, industry: profile.industry,
          tone: profile.tone, audience: profile.audience, offers: profile.offers,
          channels: profile.channels, inferred_kpis: profile.inferred_kpis,
        }).slice(0, 2500)}`
      : "";

    const blueprintBlock = `\n\nROLE BLUEPRINT (${role}) — use as a strong starting point, tailored to the business:
goal: ${blueprint.goal}
decisionPolicy: ${blueprint.decisionPolicy}
default KPIs: ${JSON.stringify(blueprint.kpis)}
default guardrails: ${JSON.stringify(blueprint.guardrails)}
required tools include: ${blueprint.tools.join(", ")}
default schedule: ${blueprint.schedule_label} (cron ${blueprint.schedule_cron})
workflow summary: ${blueprint.workflowSummary}
default automations (REUSE these patterns, adapted to the business): ${JSON.stringify(blueprint.automations)}`;

    // Try the AI compile; if anything goes wrong, fall back to a deterministic
    // manifest built from the role blueprint so the agent ALWAYS appears.
    let normalized: Manifest;
    let usedFallback = false;
    try {
      const resp = await fetch(LOVABLE_URL, {
        method: "POST",
        headers: { "Lovable-API-Key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: `You are NazAI Agent Compiler.\n\n${MANIFEST_SCHEMA_DOC}` },
            { role: "user", content: `Compile this plan into the Agent Manifest JSON. Return only the JSON object.${profileBlock}${blueprintBlock}${intakeBlock}\n\nPLAN:\n${plan}` },
          ],
          temperature: 0.2,
        }),
      });
      if (!resp.ok) throw new Error(`gateway ${resp.status}`);
      const data = await resp.json();
      const raw: string = data?.choices?.[0]?.message?.content ?? "";
      const manifest = extractJson(raw);
      if (!manifest) throw new Error("parse failed");
      normalized = normalizeManifest(manifest);
      if (!normalized.name || !normalized.tools.length) throw new Error("missing fields");
    } catch (aiErr) {
      console.warn("compile AI failed, using deterministic fallback:", aiErr);
      usedFallback = true;
      normalized = buildFallbackManifest(plan, userPrompt, role, blueprint, profile);
    }

    // Ensure required tools exist
    const needed = new Set(["remember", "ask_user", "request_approval"]);
    for (const t of normalized.tools) needed.delete(t.kind);
    for (const k of needed) {
      normalized.tools.push({
        name: k, kind: k,
        description: k === "remember"
          ? "Persist a fact about the business or its operations for future runs."
          : k === "ask_user"
          ? "Ask the operator a focused question when essential information is missing."
          : "Queue a drafted external action for the operator's approval.",
        config: {},
      });
    }
    if (!normalized.triggers.some((t) => t.kind === "cron")) {
      normalized.triggers.push({ kind: "cron", spec: blueprint.schedule_cron });
    }
    if (!normalized.kpis.length) normalized.kpis = blueprint.kpis;
    if (!normalized.guardrails.length) normalized.guardrails = blueprint.guardrails;

    let agentId: string | null = null;
    if (save) {
      if (!user) return json({ error: "Not authenticated — sign in to deploy.", manifest: normalized, agentId: null }, 401);
      const slug = slugify(normalized.name);
      const next_run_at = nextRunFromCron(blueprint.schedule_cron);
      const { data: inserted, error: insErr } = await supabase
        .from("agents")
        .insert({
          user_id: user.id, name: normalized.name, slug, goal: normalized.goal,
          manifest: normalized, source_plan: plan.slice(0, 8000),
          status: "active", role,
          schedule_cron: blueprint.schedule_cron, schedule_label: blueprint.schedule_label,
          next_run_at, business_profile_id: businessProfileId ?? null,
          autonomy: "guarded",
        })
        .select("id").single();
      if (insErr) return json({ error: insErr.message, manifest: normalized, agentId: null }, 500);
      agentId = inserted?.id ?? null;

      // Seed memory from intake answers + business essentials so the agent starts informed
      const memRows: Record<string, unknown>[] = [];
      for (const [k, v] of Object.entries(intakeAnswers || {})) {
        memRows.push({ agent_id: agentId, user_id: user.id, key: `intake.${k}`, value: String(v).slice(0, 600), source: "intake" });
      }
      if (profile) {
        if (profile.company_name) memRows.push({ agent_id: agentId, user_id: user.id, key: "business.name", value: String(profile.company_name), source: "research" });
        if (profile.tone) memRows.push({ agent_id: agentId, user_id: user.id, key: "business.tone", value: String(profile.tone), source: "research" });
        if (profile.audience) memRows.push({ agent_id: agentId, user_id: user.id, key: "business.audience", value: String(profile.audience), source: "research" });
      }
      if (memRows.length) await supabase.from("agent_memory").insert(memRows);
    }

    return json({ manifest: normalized, agentId, role, schedule_cron: blueprint.schedule_cron, schedule_label: blueprint.schedule_label, usedFallback });
  } catch (e) {
    console.error("compile-agent-manifest error", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function nextRunFromCron(cron: string): string {
  const now = new Date();
  let m = cron.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (m) { now.setMinutes(now.getMinutes() + parseInt(m[1], 10)); return now.toISOString(); }
  m = cron.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/);
  if (m) {
    const next = new Date(now);
    next.setUTCHours(parseInt(m[2], 10), parseInt(m[1], 10), 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString();
  }
  m = cron.match(/^(\d+)\s+\*\/(\d+)\s+\*\s+\*\s+\*$/);
  if (m) { now.setHours(now.getHours() + parseInt(m[2], 10)); return now.toISOString(); }
  now.setHours(now.getHours() + 1);
  return now.toISOString();
}

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function extractJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  const c = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(c); } catch { /* */ }
  const m = c.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

type Tool = { name: string; description: string; kind: string; config: Record<string, unknown> };
type Manifest = {
  name: string; goal: string; systemPrompt: string; decisionPolicy: string;
  tools: Tool[]; triggers: { kind: string; spec: string }[];
  guardrails: { rule: string; requiresApproval: boolean }[];
  kpis: { name: string; target: string }[]; ui?: Record<string, unknown>;
};

const ALLOWED_WIDGETS = new Set(["hero_metric","live_thoughts","decision_log","action_timeline","tool_call_stream","alert_feed","tool_grid","kpi_radar","guardrail_panel","status_grid"]);
const ALLOWED_VALUE_FROM = new Set(["events_count","decisions_count","actions_count","tool_calls_count","thoughts_count","errors_count"]);
const ALLOWED_ICONS = new Set(["brain","activity","wallet","gauge","signal","radar","terminal","rocket","eye","crosshair","shield","flame","sparkles","cpu","globe","line","bars","trending","zap","alert","check","wrench"]);
const ALLOWED_KINDS = ["web_search", "http_get", "calc", "notify", "remember", "ask_user", "request_approval", "custom"];

function normalizeUi(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const wIn = Array.isArray(u.widgets) ? (u.widgets as Record<string, unknown>[]) : [];
  const widgets = wIn.filter((w) => w && ALLOWED_WIDGETS.has(String(w.kind))).slice(0, 12).map((w) => {
    const out: Record<string, unknown> = { kind: String(w.kind), title: String(w.title || "Panel").slice(0, 60) };
    if (typeof w.span === "number") out.span = Math.max(1, Math.min(6, Math.round(w.span)));
    if (typeof w.limit === "number") out.limit = Math.max(1, Math.min(20, Math.round(w.limit)));
    if (typeof w.subtitle === "string") out.subtitle = w.subtitle.slice(0, 80);
    if (typeof w.severity === "string") out.severity = w.severity;
    if (typeof w.valueFrom === "string" && ALLOWED_VALUE_FROM.has(w.valueFrom)) out.valueFrom = w.valueFrom;
    if (Array.isArray(w.items)) {
      out.items = (w.items as Record<string, unknown>[]).slice(0, 6).map((it) => ({
        label: String(it.label || "").slice(0, 40),
        valueFrom: ALLOWED_VALUE_FROM.has(String(it.valueFrom)) ? String(it.valueFrom) : "events_count",
      }));
    }
    return out;
  });
  const hero = (u.hero && typeof u.hero === "object") ? (u.hero as Record<string, unknown>) : {};
  return {
    theme: typeof u.theme === "string" ? u.theme : "command",
    accent: typeof u.accent === "string" ? u.accent : "#34d399",
    accentSecondary: typeof u.accentSecondary === "string" ? u.accentSecondary : "#22d3ee",
    hero: {
      title: typeof hero.title === "string" ? hero.title.slice(0, 80) : undefined,
      tagline: typeof hero.tagline === "string" ? hero.tagline.slice(0, 160) : undefined,
      icon: typeof hero.icon === "string" && ALLOWED_ICONS.has((hero.icon as string).toLowerCase()) ? (hero.icon as string).toLowerCase() : "sparkles",
    },
    layout: typeof u.layout === "string" ? u.layout : "command-deck",
    widgets,
  };
}

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
    tools: tools.slice(0, 10).map((t) => ({
      name: String(t.name || "tool").slice(0, 60),
      description: String(t.description || "").slice(0, 300),
      kind: ALLOWED_KINDS.includes(String(t.kind)) ? String(t.kind) : "custom",
      config: (t.config && typeof t.config === "object") ? (t.config as Record<string, unknown>) : {},
    })),
    triggers: (triggers.length ? triggers : [{ kind: "manual", spec: "on-demand" }]).slice(0, 4).map((t) => ({
      kind: ["manual", "cron", "webhook"].includes(String(t.kind)) ? String(t.kind) : "manual",
      spec: String(t.spec || "on-demand").slice(0, 120),
    })),
    guardrails: guardrails.slice(0, 6).map((g) => ({ rule: String(g.rule || "").slice(0, 300), requiresApproval: !!g.requiresApproval })),
    kpis: kpis.slice(0, 6).map((k) => ({ name: String(k.name || "").slice(0, 80), target: String(k.target || "").slice(0, 120) })),
    ui: normalizeUi(m.ui),
  };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "agent";
}

// Deterministic fallback — guarantees an agent manifest exists even when the
// AI gateway is unavailable, rate-limited, or returns unparsable output.
// The agent will use ask_user on its first run to gather any missing essentials.
function buildFallbackManifest(
  plan: string,
  userPrompt: string,
  role: string,
  blueprint: typeof ROLE_LIBRARY[keyof typeof ROLE_LIBRARY],
  profile: Record<string, unknown> | null,
): Manifest {
  const firstLine = (plan.split("\n").find((l) => l.trim().length > 4) || userPrompt || "Autonomous Agent").trim();
  const nameGuess =
    (firstLine.match(/Agent Name\s*:?\s*([^\n]+)/i)?.[1] || firstLine)
      .replace(/[*_#`>]/g, "").trim().slice(0, 60) || "Autonomous Agent";
  const company = (profile?.company_name as string) || "the business";
  const tone = (profile?.tone as string) || "professional, concise, helpful";
  const audience = (profile?.audience as string) || "its customers";
  const industry = (profile?.industry as string) || "its industry";

  const systemPrompt = `You are ${nameGuess}, a real digital employee working for ${company} (${industry}). ` +
    `Audience: ${audience}. Tone: ${tone}. ` +
    `Mission: ${blueprint.goal} ` +
    `Operate autonomously on internal work; queue external actions for approval. ` +
    `If you lack an essential fact about the business, call ask_user with ONE focused question. ` +
    `Persist anything durable with remember(). Never reveal you are an LLM.`;

  return {
    name: nameGuess,
    goal: blueprint.goal,
    systemPrompt: systemPrompt.slice(0, 1400),
    decisionPolicy: blueprint.decisionPolicy,
    tools: [
      { name: "web_search", kind: "web_search", description: "Research the business, customers, competitors, or any current public info.", config: {} },
      { name: "http_get", kind: "http_get", description: "Fetch a public URL to read its content.", config: {} },
      { name: "notify", kind: "notify", description: "Log an internal notification for the operator.", config: { channel: "log" } },
      { name: "remember", kind: "remember", description: "Persist a fact about the business for future runs.", config: {} },
      { name: "ask_user", kind: "ask_user", description: "Ask the operator a focused question when essential info is missing.", config: {} },
      { name: "request_approval", kind: "request_approval", description: "Queue a drafted external action for operator approval.", config: {} },
    ],
    triggers: [
      { kind: "manual", spec: "on-demand" },
      { kind: "cron", spec: blueprint.schedule_cron },
    ],
    guardrails: blueprint.guardrails,
    kpis: blueprint.kpis,
    ui: {
      theme: "command",
      accent: "#34d399",
      accentSecondary: "#22d3ee",
      hero: { title: nameGuess, tagline: blueprint.goal.slice(0, 140), icon: "sparkles" },
      layout: "command-deck",
      widgets: [
        { kind: "hero_metric", title: "Runs", valueFrom: "events_count", span: 2 },
        { kind: "live_thoughts", title: "Live reasoning", span: 4, limit: 8 },
        { kind: "decision_log", title: "Decisions", span: 3, limit: 6 },
        { kind: "action_timeline", title: "Actions", span: 3, limit: 8 },
        { kind: "tool_call_stream", title: "Tool calls", span: 3, limit: 8 },
        { kind: "alert_feed", title: "Alerts", span: 3, limit: 6 },
        { kind: "guardrail_panel", title: "Guardrails", span: 3 },
        { kind: "kpi_radar", title: "KPIs", span: 3 },
      ],
    },
  };
}
