import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ─── Model Registry ────────────────────────────────────────────────────────────
// Add new models here. Each entry maps a model_choice key to its OpenRouter
// model ID. API keys are read from Supabase environment variables so nothing
// is hard-coded.
const MODEL_REGISTRY: Record<string, string> = {
  "gemini-2.0-flash":   "google/gemini-2.0-flash-exp:free",
  "gemini-2.5-flash":   "google/gemini-2.5-flash-preview",
  "claude-3.5-sonnet":  "anthropic/claude-3.5-sonnet",
  "claude-3-haiku":     "anthropic/claude-3-haiku",
  "gpt-4o":             "openai/gpt-4o",
  "gpt-4o-mini":        "openai/gpt-4o-mini",
  "mistral-7b":         "mistralai/mistral-7b-instruct:free",
  "llama-3.1-70b":      "meta-llama/llama-3.1-70b-instruct:free",
};

const DEFAULT_MODEL = "gemini-2.0-flash";

const SYSTEM_PROMPT = `You are a world-class web developer and UI/UX designer.
Generate a complete, self-contained HTML page with inline Tailwind CSS (via CDN) and
vanilla JavaScript based on the user's prompt.
Requirements:
- Start with <!DOCTYPE html>
- Include <script src="https://cdn.tailwindcss.com"></script> in <head>
- Dark, modern, polished aesthetic by default
- Fully responsive layout
- Return ONLY raw HTML — no markdown fences, no explanation, no code blocks.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
    } = await supabase.auth.getUser(token);

    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Credits check ─────────────────────────────────────────────────────────
    const { data: profile } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", user.id)
      .single();

    if (!profile || profile.credits <= 0) {
      return new Response(
        JSON.stringify({
          error: "No credits remaining. Earn more by referring a friend!",
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Parse request ─────────────────────────────────────────────────────────
    const body = await req.json();
    const prompt: string = body.prompt ?? "";
    const modelChoice: string = body.model_choice ?? DEFAULT_MODEL;

    if (!prompt.trim()) {
      return new Response(JSON.stringify({ error: "prompt is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Resolve model via registry ────────────────────────────────────────────
    const openRouterModel =
      MODEL_REGISTRY[modelChoice] ?? MODEL_REGISTRY[DEFAULT_MODEL];

    const openRouterKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!openRouterKey) {
      throw new Error(
        "OPENROUTER_API_KEY is not set in Supabase environment variables."
      );
    }

    // ── Call OpenRouter ───────────────────────────────────────────────────────
    const aiResponse = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openRouterKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://nazai.net",
          "X-Title": "NazAI Neural Router",
        },
        body: JSON.stringify({
          model: openRouterModel,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          temperature: 0.7,
          max_tokens: 8192,
        }),
      }
    );

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("[NazAI Router] OpenRouter error:", aiResponse.status, errText);
      return new Response(
        JSON.stringify({ error: "AI generation failed. Please try again." }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const aiData = await aiResponse.json();
    const content: string =
      aiData.choices?.[0]?.message?.content ?? "";

    if (!content) {
      throw new Error("AI returned empty content.");
    }

    // ── Deduct credit only on success ─────────────────────────────────────────
    await supabase
      .from("profiles")
      .update({ credits: profile.credits - 1 })
      .eq("id", user.id);

    return new Response(
      JSON.stringify({
        content,
        model_used: openRouterModel,
        credits_remaining: profile.credits - 1,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[NazAI Router] Fatal error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
