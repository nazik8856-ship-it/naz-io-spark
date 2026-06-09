import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Generate one complete autonomous AI agent based on user request.

Output ONLY this structure with no extra text(for the generated plan):

1. **Agent Name**: 
2. **Description**: 
3. **Primary Goal**: 
4. **Autonomous Capabilities**: (bullets)
5. **Step-by-Step Workflow**: (numbered)
6. **Guardrails & Safety**: 
7. **Deployment Options**: 
8. **Expected Impact**:

Strict rules:
- No preamble, status labels, comments, markdown fences, or meta text.
- Never use words like "forging", "detected", "brand-new", "draft", or "offline fallback".
- Make the agent practical for 2026 economic conditions.
- Never ask clarifying questions. Infer missing context and include assumptions only inside Description.`;

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

    const composedUserPrompt = `User's request: ${rawPrompt}\n${industryLine}\n${challengesLine}\n\nGenerate one complete autonomous AI agent based on this request. Output ONLY the 8 numbered sections exactly as requested, with clean business-ready content and no extra text.`;

    const finalMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: composedUserPrompt },
    ];


    const useOpenAI = Boolean(OPENAI_API_KEY);
    const aiUrl = useOpenAI
      ? "https://api.openai.com/v1/chat/completions"
      : "https://ai.gateway.lovable.dev/v1/chat/completions";
    const aiKey = OPENAI_API_KEY || LOVABLE_API_KEY;
    const aiModel = useOpenAI ? "gpt-4o-mini" : "google/gemini-3-flash-preview";

    const response = await fetch(aiUrl, {
      method: "POST",
      headers: {
        ...(useOpenAI ? { Authorization: `Bearer ${aiKey}` } : { "Lovable-API-Key": aiKey }),
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
