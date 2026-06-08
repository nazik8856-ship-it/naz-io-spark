import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are a professional AI Agent Architect. Your only job is to output clean, ready-to-use agent specifications.

Generate one high-quality autonomous AI agent.

OUTPUT RULES: Produce ONLY the agent specification below. Do not write any other text, explanations, introductions, forging messages, or comments.

1. Agent Name: A short, catchy, professional name

2. Description: 2-3 clear sentences about what the agent does and why it is valuable for businesses facing uncertainty

3. Primary Goal: One specific measurable goal

4. Autonomous Capabilities:
• Point 1
• Point 2
• Point 3
• Point 4
• Point 5
• Point 6

5. Step-by-Step Workflow:
1. First step
2. Second step
3. Third step
4. Fourth step
5. Fifth step
6. Sixth step

6. Guardrails & Safety: List the main safety rules and when the agent must ask for human approval

7. Deployment Options: 3-4 practical ways to use this agent

8. Expected Impact: 2-3 realistic business benefits

Make the agent practical for 2026 economic conditions. Never ask clarifying questions — always produce a complete, deployable agent on the first try. If the user's prompt is short or vague, intelligently infer the use case and briefly state the inferred assumptions inside the Description.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { prompt, messages, industry, challenges } = await req.json();
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!OPENAI_API_KEY && !LOVABLE_API_KEY) {
      throw new Error("AI generation key not configured");
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

    const composedUserPrompt = `User's request: ${rawPrompt}\n${industryLine}\n${challengesLine}\n\nCreate a high-quality, brand-new autonomous AI agent tailored to this exact request. Output ONLY the 8 numbered sections, no preamble.`;

    const finalMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: composedUserPrompt },
    ];


    // Prefer Lovable AI Gateway (always provisioned, reliable). Fall back to OpenAI if explicitly available and gateway missing.
    const aiUrl = LOVABLE_API_KEY
      ? "https://ai.gateway.lovable.dev/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions";
    const aiKey = LOVABLE_API_KEY || OPENAI_API_KEY;
    const aiModel = LOVABLE_API_KEY ? "google/gemini-3-flash-preview" : "gpt-4o-mini";

    const response = await fetch(aiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: aiModel,
        messages: finalMessages,
        stream: true,
        temperature: 0.7,
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
