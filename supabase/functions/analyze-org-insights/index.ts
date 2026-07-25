import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const LOVABLE_MODEL = "google/gemini-3-flash-preview";

type Insight = { insight: string; kind: string; confidence: string; source_agent_ids?: string[] };

function similar(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter((w) => w.length > 3);
  const A = new Set(norm(a));
  const B = new Set(norm(b));
  if (A.size === 0 || B.size === 0) return false;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const jac = inter / (A.size + B.size - inter);
  return jac >= 0.55;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) return new Response(JSON.stringify({ error: "no AI key" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: authData } = await userClient.auth.getUser();
    const userId = authData?.user?.id;
    if (!userId) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(supabaseUrl, serviceKey);

    // Pull aggregated business context (Phase 3 unified layer).
    const { data: ctx, error: ctxErr } = await admin.rpc("get_business_context", { _user_id: userId });
    if (ctxErr) {
      return new Response(JSON.stringify({ error: "context_failed", details: ctxErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const context = (ctx || {}) as Record<string, unknown>;
    const recentReports = (context.recent_reports as Array<Record<string, unknown>>) || [];
    const clients = (context.clients as Array<Record<string, unknown>>) || [];
    const artifacts = (context.recent_artifacts as Array<Record<string, unknown>>) || [];

    // Actions + runs still need direct queries — not part of the aggregate stats block.
    const [{ data: actions }, { data: runs }] = await Promise.all([
      admin.from("agent_events")
        .select("agent_id, payload, created_at")
        .eq("user_id", userId)
        .eq("kind", "action")
        .contains("payload", { ok: true })
        .order("created_at", { ascending: false })
        .limit(120),
      admin.from("agent_runs")
        .select("agent_id, status, summary, outcome, finished_at")
        .eq("user_id", userId)
        .order("finished_at", { ascending: false })
        .limit(60),
    ]);

    const totalSignals = (actions?.length || 0) + (runs?.length || 0) + clients.length + recentReports.length + artifacts.length;
    if (totalSignals < 3) {
      return new Response(JSON.stringify({ ok: true, inserted: 0, updated: 0, reason: "not_enough_signal" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const actionsBlob = (actions || []).map((a) => {
      const p = a.payload as Record<string, unknown>;
      return `- [${a.created_at}] agent:${a.agent_id} ${p.type ?? "action"} → ${String(p.summary ?? p.target ?? "").slice(0, 160)}`;
    }).join("\n").slice(0, 6000);
    const runsBlob = (runs || []).map((r) =>
      `- [${r.finished_at}] agent:${r.agent_id} ${r.status}/${r.outcome ?? ""} → ${String(r.summary ?? "").slice(0, 200)}`
    ).join("\n").slice(0, 4000);
    const notesBlob = clients.slice(0, 60).map((n) =>
      `- agent:${n.agent_id} client:${n.name || n.company || "?"} → ${String(n.notes ?? "").slice(0, 200)}`
    ).join("\n").slice(0, 3000);

    const resp = await fetch(LOVABLE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": lovableKey },
      body: JSON.stringify({
        model: LOVABLE_MODEL,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: `You extract GENUINE, specific business patterns from an operator's real agent activity. Output ONLY JSON: {"insights":[{"insight":"...","kind":"pattern|correlation|lesson","confidence":"high|medium|low"}]}. Rules:
- Each insight must reference concrete evidence in the data (specific tool, action type, client segment, outcome).
- REJECT vague generalities ("emails are important", "customers matter"). If you can't find something specific, return fewer insights.
- Prefer CORRELATION statements ("X co-occurs with Y") and LESSONS ("action A repeatedly fails when B"). Max 6 insights. Each under 160 chars.`,
          },
          {
            role: "user",
            content: `Recent successful actions:\n${actionsBlob || "(none)"}\n\nRecent runs:\n${runsBlob || "(none)"}\n\nRecent client notes:\n${notesBlob || "(none)"}\n\nExtract genuine patterns.`,
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      return new Response(JSON.stringify({ error: "ai_failed", status: resp.status, details: t }), { status: resp.status === 429 || resp.status === 402 ? resp.status : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = await resp.json();
    let parsed: { insights?: Insight[] } = {};
    try { parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? "{}"); } catch { /* noop */ }
    const insights = (parsed.insights || []).filter((i) => i && typeof i.insight === "string" && i.insight.trim().length > 12).slice(0, 6);

    if (insights.length === 0) {
      return new Response(JSON.stringify({ ok: true, inserted: 0, updated: 0, reason: "no_insights_extracted" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const sourceAgentIds = Array.from(new Set([
      ...(actions || []).map((a) => a.agent_id).filter(Boolean),
      ...(runs || []).map((r) => r.agent_id).filter(Boolean),
    ])) as string[];

    const { data: existing } = await admin.from("org_insights")
      .select("id, insight, evidence_count, source_agent_ids")
      .eq("user_id", userId);

    let inserted = 0;
    let updated = 0;
    for (const i of insights) {
      const insightText = i.insight.trim().slice(0, 500);
      const kind = ["pattern", "correlation", "lesson"].includes(i.kind) ? i.kind : "pattern";
      const confidence = ["high", "medium", "low"].includes(i.confidence) ? i.confidence : "medium";
      const match = (existing || []).find((e) => similar(e.insight as string, insightText));
      if (match) {
        const mergedAgents = Array.from(new Set([...(match.source_agent_ids as string[] || []), ...sourceAgentIds])).slice(0, 20);
        await admin.from("org_insights")
          .update({
            evidence_count: (match.evidence_count as number || 1) + 1,
            last_confirmed_at: new Date().toISOString(),
            confidence,
            source_agent_ids: mergedAgents,
          })
          .eq("id", match.id);
        updated++;
      } else {
        await admin.from("org_insights").insert({
          user_id: userId,
          insight: insightText,
          kind,
          confidence,
          source_agent_ids: sourceAgentIds.slice(0, 20),
        });
        inserted++;
      }
    }

    return new Response(JSON.stringify({ ok: true, inserted, updated, considered: insights.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
