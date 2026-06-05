import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are NazAI's Agent Forge. Your job: design a BRAND NEW, original AI agent based on the user's request. Never reuse prior templates — every agent must feel custom-built for this specific prompt.

Always return your response as clean markdown with these sections, in order:

# {Agent Name}
A short, memorable name (2-4 words). No quotes.

## Mission
One sentence describing what this agent does and who it serves.

## Persona & Voice
2-3 sentences: tone, personality, communication style.

## Core Capabilities
A bullet list of 4-7 concrete things this agent can do. Specific, not generic.

## System Prompt
A fenced code block (\`\`\`text ... \`\`\`) containing the full production-ready system prompt you would give the underlying LLM to run this agent. Make it detailed, opinionated, and tailored.

## Tools & Integrations
Bullet list of APIs, data sources, or tools this agent needs (e.g. web search, calendar API, vector DB).

## Sample Interaction
A short user→agent exchange showing the agent in action. Use \`**User:**\` and \`**Agent:**\` labels.

## Deployment Notes
2-3 bullet points: where to run it, key guardrails, suggested model.

Rules:
- Be specific to the user's exact request.
- Make tasteful product decisions if the prompt is vague — state them.
- Never output placeholder text like "TBD" or "Lorem ipsum".
- Keep it tight and high-signal. No fluff, no preamble.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { prompt, messages } = await req.json();
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

    const userPrompt: string =
      (typeof prompt === "string" && prompt.trim()) ||
      (Array.isArray(messages) && messages.length > 0
        ? messages[messages.length - 1]?.content
        : "") ||
      "";

    if (!userPrompt) {
      return new Response(JSON.stringify({ error: "prompt required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Force novelty: inject a unique nonce so OpenAI never serves a cached completion
    const nonce = crypto.randomUUID();
    const noveltyTag = `\n\n[forge-nonce:${nonce} | timestamp:${Date.now()}] — design a brand-new agent unique to this request. Do not reuse prior designs.`;

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
      { role: "user", content: userPrompt + noveltyTag },
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
