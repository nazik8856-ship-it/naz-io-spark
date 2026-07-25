import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const LOVABLE_MODEL = "google/gemini-3-flash-preview";

type ScenarioResponse = {
  analysis: string;
  key_factors_considered: string[];
  confidence: "high" | "medium" | "low";
  caveats: string[];
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) {
      return new Response(JSON.stringify({ error: "no AI key" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: authData } = await userClient.auth.getUser();
    const userId = authData?.user?.id;
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { question } = await req.json().catch(() => ({}));
    const q = typeof question === "string" ? question.trim() : "";
    if (q.length < 5 || q.length > 2000) {
      return new Response(JSON.stringify({ error: "question must be 5–2000 chars" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: ctx, error: ctxErr } = await admin.rpc("get_business_context", { _user_id: userId });
    if (ctxErr) {
      return new Response(JSON.stringify({ error: "context_failed", details: ctxErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Trim context to stay well under token limits while preserving signal.
    const contextJson = JSON.stringify(ctx).slice(0, 24000);

    const resp = await fetch(LOVABLE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": lovableKey },
      body: JSON.stringify({
        model: LOVABLE_MODEL,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: `You are a Digital Twin scenario simulator for a real operator's business. You have their ACTUAL data (agents, clients, learned insights, reports, verified outputs, action success stats).

Reason through the user's what-if question using the concrete numbers and history provided — NEVER generic advice. Reference specific counts, success rates, insights, clients, or reports when they support your reasoning.

Output ONLY JSON: {
  "analysis": "clear, specific reasoning grounded in the provided data (2-6 short paragraphs, plain text)",
  "key_factors_considered": ["specific data points you weighed, e.g. '42 active clients across 3 agents', 'success rate 87%', 'learned pattern: X correlates with Y'"],
  "confidence": "high|medium|low — high only when the data directly supports the conclusion",
  "caveats": ["what the data can't tell you, missing signals, assumptions made"]
}

Rules:
- If the data is too thin to answer meaningfully, say so plainly in analysis and set confidence low.
- Never invent numbers not present in the context.
- Never suggest taking real actions — this is analysis only.`,
          },
          {
            role: "user",
            content: `# Real business context (JSON)\n${contextJson}\n\n# What-if question\n${q}`,
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      const status = resp.status === 429 || resp.status === 402 ? resp.status : 500;
      return new Response(JSON.stringify({ error: "ai_failed", status: resp.status, details: t }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await resp.json();
    let parsed: Partial<ScenarioResponse> = {};
    try { parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? "{}"); } catch { /* noop */ }

    const response: ScenarioResponse = {
      analysis: typeof parsed.analysis === "string" ? parsed.analysis : "No analysis returned.",
      key_factors_considered: Array.isArray(parsed.key_factors_considered) ? parsed.key_factors_considered.filter((s) => typeof s === "string").slice(0, 12) : [],
      confidence: (["high", "medium", "low"].includes(parsed.confidence as string) ? parsed.confidence : "low") as ScenarioResponse["confidence"],
      caveats: Array.isArray(parsed.caveats) ? parsed.caveats.filter((s) => typeof s === "string").slice(0, 8) : [],
    };

    const { data: inserted, error: insErr } = await admin
      .from("scenario_simulations")
      .insert({ user_id: userId, question: q, response })
      .select("id, created_at")
      .single();
    if (insErr) {
      return new Response(JSON.stringify({ error: "store_failed", details: insErr.message, response }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true, id: inserted.id, created_at: inserted.created_at, question: q, response }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
