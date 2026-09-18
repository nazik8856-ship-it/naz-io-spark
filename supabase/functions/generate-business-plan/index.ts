import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pickAiGateway, callAiGateway, type GatewayConfig } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// The client passes a loose model hint ("openai"/"gpt" for a stronger request,
// anything else for the default). Map that onto our two-tier gateway config
// rather than a Lovable-namespaced alias.
const resolveModel = (gw: GatewayConfig, hint?: string | null) =>
  hint && /openai|gpt/i.test(hint) ? gw.deepModel : gw.model;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await supabaseClient.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { prompt, model, style, systemPrompt } = await req.json();
    const gw = pickAiGateway();
    if (!gw) throw new Error("Missing OPENAI_API_KEY (or LOVABLE_API_KEY)");

    const isLiveEdit = String(prompt ?? "").includes("[ITERATION_DIRECTIVE: LIVE_EDIT]");
    const system = isLiveEdit
      ? "You are a precise website code editor. You are given the complete latest source code of the live preview. Use it precisely to make edits. Never guess or regenerate from scratch unless asked. Return only one complete standalone HTML document with inline CSS and JS."
      : `${systemPrompt || "You are NazAI, a premium AI Business OS."}\nFor website requests, return one complete standalone HTML document with inline CSS/JS that renders in iframe srcDoc. Make it bespoke to the user's prompt, not a generic template. Style preference: ${style || "Technical"}.`;

    const response = await callAiGateway({
      model: resolveModel(gw, model),
      messages: [
        { role: "system", content: system },
        { role: "user", content: String(prompt ?? "") },
      ],
    }, gw);

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("No response from AI");

    await supabaseClient.rpc("deduct_credit", { user_id: user.id });

    return new Response(JSON.stringify({ plan: content, content, text: content }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
