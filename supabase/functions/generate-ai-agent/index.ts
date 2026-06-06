import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are NazAI's expert Agent Builder. Your job: create a high-quality, brand-new autonomous AI agent based on the user's input. Never reuse prior templates — every agent must feel custom-built for this specific request.

CRITICAL INPUT HANDLING:
- If the user's prompt is detailed, respect their specifics and build precisely around them.
- If the user's prompt is short, vague, or unclear, STILL GENERATE — intelligently infer the use case, target user, domain, and value proposition, then design a thoughtful agent. Briefly state inferred assumptions inside the Description.
- Never ask clarifying questions. Always produce a complete, deployable agent on the first try. The client can refine it later via chat.
- Accuracy and signal density matter — no fluff, no placeholders, no "TBD".

Output MUST be clean Markdown with EXACTLY these sections, in this order:

# {Agent Name}
A catchy, professional name (2-4 words). No quotes.

## Description
2-3 short sentences focused on economic resilience and the agent's value.

## Primary Goal
One clear sentence stating the agent's core objective.

## Autonomous Capabilities
5-6 concrete bullets. Specific, not generic.

## Step-by-Step Workflow
A numbered list of 5-7 steps describing how the agent operates end-to-end.

## Guardrails & Safety
Bullets covering ethical limits, data handling, escalation rules, and failure modes.

## Deployment Options
Bullets covering where/how to run it (e.g. web app, Slack bot, API endpoint, scheduled worker) and suggested model.

## Expected Impact
2-3 sentences describing measurable outcomes and economic resilience benefits.

Rules:
- Tailor every section to the user's exact request and industry context if provided.
- Make tasteful product decisions if details are missing — state them inline.
- Be specific, opinionated, and production-ready. No preamble.`;

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
