import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "X-Agent-Provider",
};

const SYSTEM_PROMPT = `You design ONE complete autonomous AI agent that directly solves the EXACT request the user wrote.

Hard rules:
- Read the user's request carefully. The agent's name, description, goal, capabilities, and workflow MUST clearly reference the specific domain, tasks, tools, and outcomes the user described. Never produce a generic "business resilience" agent unless the user literally asked for that.
- If the user prompt is short, vague, one word, or missing context, you MUST invent a reasonable domain, target audience, and feature set yourself. NEVER refuse, NEVER ask clarifying questions, NEVER return placeholder text, NEVER say "more info needed". Always output the full 8 sections with a real, opinionated agent design the user can refine later via chat.
- When you had to invent details because the prompt was sparse, begin the Description with one short sentence prefixed exactly with "Assumed:" listing the key assumptions (e.g. "Assumed: small fitness studio audience, mobile-first, English-only."). If the user gave full context, do NOT include an "Assumed:" line.
- Output ONLY the 8 numbered sections below. No preamble, no closing remarks, no markdown fences, no status labels, no commentary, no meta text.
- Never use these words: "forging", "detected", "brand-new", "draft", "offline fallback".
- Keep it concrete and practical for 2026 conditions.

Required structure (use these EXACT headings verbatim, including the \`**\` markers and the trailing colon — do not renumber, rename, merge, or add sections):

1. **Agent Name**: <name that reflects the actual use case>
2. **Description**: <2-4 sentences. If prompt was sparse, lead with one "Assumed: …" sentence, then describe what this agent does>
3. **Primary Goal**: <one sentence tied to the desired outcome>
4. **Autonomous Capabilities**: <5-7 bullets, each specific to the use case>
5. **Step-by-Step Workflow**: <numbered 5-8 steps showing what the agent actually does end-to-end>
6. **Guardrails & Safety**: <what it must never do without approval, data/privacy rules>
7. **Deployment Options**: <where this specific agent runs / integrates>
8. **Expected Impact**: <measurable outcomes for the scenario>`;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";
const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const LOVABLE_MODEL = "google/gemini-3-flash-preview";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { prompt, messages, industry, challenges } = await req.json();

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

Design ONE autonomous AI agent that directly fulfills the request above. Every section must explicitly reflect the user's wording, domain, and desired outcome — do not output a generic template. Use the exact 8 numbered headings verbatim (with \`**\` and trailing colons). Return ONLY the 8 sections.`;

    const finalMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: composedUserPrompt },
    ];

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    async function tryProvider(
      kind: "openai" | "lovable",
    ): Promise<{ ok: true; resp: Response } | { ok: false; status: number; detail: string }> {
      const isOpenAI = kind === "openai";
      const url = isOpenAI ? OPENAI_URL : LOVABLE_URL;
      const model = isOpenAI ? OPENAI_MODEL : LOVABLE_MODEL;
      const key = isOpenAI ? OPENAI_API_KEY : LOVABLE_API_KEY;
      if (!key) return { ok: false, status: 0, detail: `${kind} key missing` };

      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            ...(isOpenAI
              ? { Authorization: `Bearer ${key}` }
              : { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "edge-function" }),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: finalMessages,
            stream: true,
            temperature: 0.5,
            max_tokens: 1600,
          }),
        });
        if (!resp.ok) {
          const detail = await resp.text().catch(() => "");
          console.error(`[generate-ai-agent] ${kind} error`, resp.status, detail.slice(0, 300));
          return { ok: false, status: resp.status, detail };
        }
        return { ok: true, resp };
      } catch (err) {
        console.error(`[generate-ai-agent] ${kind} network error`, err);
        return { ok: false, status: 0, detail: String(err) };
      }
    }

    // Primary: OpenAI gpt-4o-mini. Fallback (on 401/429/5xx/network): Lovable AI Gemini.
    let providerUsed: "openai" | "lovable" = "openai";
    let result = await tryProvider("openai");

    const shouldFallback =
      !result.ok &&
      (result.status === 0 ||
        result.status === 401 ||
        result.status === 403 ||
        result.status === 429 ||
        result.status >= 500);

    if (shouldFallback && LOVABLE_API_KEY) {
      console.info("[generate-ai-agent] falling back to Lovable AI");
      providerUsed = "lovable";
      result = await tryProvider("lovable");
    }

    if (!result.ok) {
      if (result.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit hit. Try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (result.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ error: "AI error", detail: result.detail?.slice(0, 300) }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(result.resp.body, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "X-Agent-Provider": providerUsed,
      },
    });
  } catch (e) {
    console.error("generate-ai-agent error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
