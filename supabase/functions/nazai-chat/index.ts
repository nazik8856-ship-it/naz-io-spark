import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Mode = "plan" | "build" | "ask";

const SYSTEM_PROMPTS: Record<Mode, string> = {
  plan: `You are NazAI in PLAN mode. Carefully read the user's request and produce a clear, structured plan.
- Restate the user's intent in one sentence so they know you understood.
- Break the work into 3-7 concrete, ordered steps.
- Call out key decisions, data models, integrations and risks.
- Keep tone direct, expert, NazAI-branded. Use short markdown sections and bullet lists. No fluff.`,
  build: `You are NazAI in BUILD mode. The user wants you to actually generate the thing they describe.
- First, in one short sentence, confirm what you understood they want to build.
- Then deliver the build: page structure / component outline, copywriting, and code where useful (TypeScript + React + Tailwind, dark NazAI theme).
- Use fenced code blocks for any code. Use clear markdown headings for each section.
- Be specific to the user's prompt — never give generic boilerplate. If the prompt is vague, make smart product decisions and state them.`,
  ask: `You are NazAI in ASK mode. The user wants to chat, brainstorm or get answers.
- Answer the user's question precisely and confidently.
- Restate their question in one short line if it's ambiguous, then proceed.
- Use markdown, bullet lists and small examples. Be concise.`,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, mode } = await req.json();
    const chatMode: Mode = (mode as Mode) ?? "build";

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: SYSTEM_PROMPTS[chatMode] },
            ...messages,
          ],
          stream: true,
        }),
      },
    );

    if (!response.ok) {
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
      const t = await response.text();
      console.error("AI gateway error", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("nazai-chat error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
