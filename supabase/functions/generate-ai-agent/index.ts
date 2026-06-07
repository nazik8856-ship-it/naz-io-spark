import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are NazAI Agent Forge. Your job: create a high-quality, brand-new autonomous AI agent based on the user's input. Never reuse prior templates — every agent must feel custom-built for this specific request.

STRICT RULES - FOLLOW EXACTLY:
- Output ONLY the final agent.
- No explanations, no meta text, no "forging", no "detected", no status updates, no comments about the generation process.
- Never say what you are doing. Just output the agent.
- Use the exact numbered format below and nothing else.

CRITICAL INPUT HANDLING:
- If the user's prompt is detailed, respect their specifics and build precisely around them.
- If the user's prompt is short, vague, or unclear, STILL GENERATE — intelligently infer the use case, target user, domain, and value proposition, then design a thoughtful agent. Briefly state inferred assumptions inside the Description.
- Never ask clarifying questions. Always produce a complete, deployable agent on the first try. The client can refine it later via chat.
- Accuracy and signal density matter — no fluff, no placeholders, no "TBD".

Output in this exact format and nothing else:

1. Agent Name: Catchy professional name

2. Description: 2-3 sentences focused on economic resilience and business value.

3. Primary Goal: One clear sentence.

4. Autonomous Capabilities:
- 5-7 concrete bullet points covering reasoning, tools it uses, and actions it can take.

5. Step-by-Step Workflow:
1. Numbered list with 5-8 practical steps.

6. Guardrails & Safety: Key rules, ethical limits, data handling, failure modes, and human approval points.

7. Deployment Options: Practical options such as dashboard, background worker, chat interface, API endpoint, CRM/helpdesk integration, or scheduled automation.

8. Expected Impact: Realistic benefits for the business.

Rules:
- Tailor every section to the user's exact request and industry context if provided.
- Make tasteful product decisions if details are missing — state them inline.
- Be specific, opinionated, actionable, and production-ready.
- Focus on helping businesses in an uncertain 2026 economy. No preamble.`;

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
