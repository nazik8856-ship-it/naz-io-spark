import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You design ONE complete autonomous AI agent that directly solves the EXACT request the user wrote.

Hard rules:
- Read the user's request carefully. The agent's name, description, goal, capabilities, and workflow MUST clearly reference the specific domain, tasks, tools, and outcomes the user described. Never produce a generic "business resilience" agent unless the user literally asked for that.
- Output ONLY the 8 numbered sections below. No preamble, no closing remarks, no markdown fences, no status labels, no commentary, no meta text.
- Never use these words: "forging", "detected", "brand-new", "draft", "offline fallback".
- Never ask clarifying questions. Infer missing details and fold any assumptions into the Description.
- Keep it concrete and practical for 2026 conditions.

Required structure (exact headings, in this order):

1. **Agent Name**: <name that reflects the user's actual use case>
2. **Description**: <2-4 sentences naming the user's domain and what this agent does for them>
3. **Primary Goal**: <one sentence tied to the user's stated outcome>
4. **Autonomous Capabilities**: <5-7 bullets, each specific to the user's request>
5. **Step-by-Step Workflow**: <numbered 5-8 steps showing what the agent actually does end-to-end>
6. **Guardrails & Safety**: <what it must never do without approval, data/privacy rules>
7. **Deployment Options**: <where this specific agent runs / integrates>
8. **Expected Impact**: <measurable outcomes for the user's scenario>`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { prompt, messages, industry, challenges } = await req.json();
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY not configured. Add it in project secrets." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const rawPrompt: string =
      (typeof prompt === "string" && prompt.trim()) ||
      (Array.isArray(messages) && messages.length > 0
        ? messages[messages.length - 1]?.content
        : "") ||
      "";

    if (!rawPrompt) {
      return new Response(JSON.stringify({ error: "prompt required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const industryLine = industry ? `Industry: ${industry}` : "Industry: (infer from request)";
    const challengesLine = challenges ? `Challenges: ${challenges}` : "Challenges: (infer reasonable challenges)";

    const composedUserPrompt = `USER REQUEST (verbatim, treat as source of truth):
"""
${rawPrompt}
"""
${industryLine}
${challengesLine}

Design ONE autonomous AI agent that directly fulfills the request above. Every section must explicitly reflect the user's wording, domain, and desired outcome — do not output a generic template. Return ONLY the 8 numbered sections.`;

    const finalMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: composedUserPrompt },
    ];


    // Force OpenAI gpt-4o-mini for every agent generation — no fallbacks.
    const aiUrl = "https://api.openai.com/v1/chat/completions";
    const aiModel = "gpt-4o-mini";

    const response = await fetch(aiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: aiModel,
        messages: finalMessages,
        stream: true,
        temperature: 0.55,
        max_tokens: 1600,
      }),
    });

    if (!response.ok) {
      const t = await response.text();
      console.error("AI gateway error", response.status, t);
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit hit. Try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "AI error", detail: t }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("generate-ai-agent error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
