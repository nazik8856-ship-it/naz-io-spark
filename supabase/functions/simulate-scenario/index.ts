import "../_shared/redact-console.ts"; // first: secrets never reach the function logs
import "../_shared/outbound-guard.ts"; // second: no request carries a NazAI credential to a host it does not belong to
import { parseModelJson } from "../_shared/model-output.ts";
import { guardOutputText } from "../_shared/output-guard.ts";
import { array, object, oneOf, text, withDefault } from "../_shared/schema.ts";
import { readJson } from "../_shared/input.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "../_shared/encrypted-client.ts"; // what-if questions and answers are stored encrypted (data at rest)
import { pickAiGateway, callAiGateway } from "../_shared/ai-gateway.ts";
import { requireCaller } from "../_shared/caller.ts";
import { openBusinessContext } from "../_shared/business-context.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ScenarioResponse = {
  analysis: string;
  key_factors_considered: string[];
  confidence: "high" | "medium" | "low";
  caveats: string[];
};

const scenarioReply = object({
  analysis: withDefault(text({ max: 6000, clip: true }), ""),
  key_factors_considered: withDefault(array(text({ min: 1, max: 400, clip: true }), { max: 12, clip: true, dropInvalid: true }), [] as string[]),
  confidence: withDefault(oneOf(["high", "medium", "low"] as const), "low" as const),
  caveats: withDefault(array(text({ min: 1, max: 400, clip: true }), { max: 8, clip: true, dropInvalid: true }), [] as string[]),
});

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
    const gw = pickAiGateway();
    if (!gw) {
      return new Response(JSON.stringify({ error: "no AI key" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const authed = await requireCaller(req, (h) => createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: h } } }));
    if (!authed.ok) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = authed.caller.userId;

    const inputRead = await readJson(req, { headers: corsHeaders });
    if (!inputRead.ok) return inputRead.response;
    const { question } = inputRead.value;
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
    const contextJson = JSON.stringify(await openBusinessContext(ctx)).slice(0, 24000); // clients, insights and reports are stored encrypted

    const resp = await callAiGateway({
        model: gw.model,
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
    }, gw);

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      const status = resp.status === 429 || resp.status === 402 ? resp.status : 500;
      return new Response(JSON.stringify({ error: "ai_failed", status: resp.status, details: t }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await resp.json();
    // checked against the shape the screen shows: text cut, lists capped, a wrong confidence becomes "low", HTML and unsafe links removed
    const checked = parseModelJson(String(data?.choices?.[0]?.message?.content ?? ""), scenarioReply);
    const parsed = checked.ok ? checked.value : null;
    const safe = (t: string) => guardOutputText(t).text;
    const response: ScenarioResponse = {
      analysis: parsed?.analysis ? safe(parsed.analysis) : "No analysis returned.",
      key_factors_considered: (parsed?.key_factors_considered ?? []).map(safe),
      confidence: parsed?.confidence ?? "low",
      caveats: (parsed?.caveats ?? []).map(safe),
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
