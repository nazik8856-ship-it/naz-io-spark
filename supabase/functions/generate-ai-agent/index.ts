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
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

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

    // Force novelty: inject a unique nonce so OpenAI never serves a cached completion
    const nonce = crypto.randomUUID();
    const noveltyTag = `\n\n[forge-nonce:${nonce} | timestamp:${Date.now()}] — design a brand-new agent unique to this request. Do not reuse prior designs.`;

    const industryLine = industry ? `Industry: ${industry}` : "Industry: (not specified — infer from request)";
    const challengesLine = challenges ? `Challenges: ${challenges}` : "Challenges: (not specified — infer reasonable challenges)";

    const composedUserPrompt = `User's request: ${rawPrompt}\n${industryLine}\n${challengesLine}\n\nCreate a high-quality autonomous AI agent based on the user's input. If the prompt is unclear, still generate accurately based on what was provided.${noveltyTag}`;

    const priorTurns = Array.isArray(messages)
      ? messages
          .filter((m: any) => m && typeof m.content === "string" && m.role !== "system")
          .slice(-8)
          .map((m: any) => ({
            role: m.role === "user" ? "user" : "assistant",
            content: m.content,
          }))
      : [];

    const finalMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...priorTurns,
      { role: "user", content: composedUserPrompt },
    ];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: finalMessages,
        stream: true,
        temperature: 0.95,
        top_p: 0.95,
        presence_penalty: 0.6,
        frequency_penalty: 0.3,
      }),
    });

    if (!response.ok) {
      const t = await response.text();
      console.error("OpenAI error", response.status, t);
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "OpenAI rate limit. Try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (response.status === 401) {
        return new Response(
          JSON.stringify({ error: "OpenAI key invalid." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "OpenAI error", detail: t }), {
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
