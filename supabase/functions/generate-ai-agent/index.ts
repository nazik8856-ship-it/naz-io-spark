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
8. **Expected Impact**: <measurable outcomes for the scenario>

Use these exact headings verbatim, including the ** markers and the trailing colon. Do not renumber, rename, or merge sections.`;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";
const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const LOVABLE_MODEL = "google/gemini-3-flash-preview";

type Provider = "openai" | "lovable";
type AgentSections = {
  name: string;
  description: string;
  goal: string;
  capabilities: string;
  workflow: string;
  guardrails: string;
  deployment: string;
  impact: string;
};

function cleanModelText(text: string): string {
  return String(text || "")
    .replace(/```(?:markdown|md|text)?/gi, "")
    .replace(/```/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\bbrand[-\s]?new\b/gi, "complete")
    .replace(/\bforging\b/gi, "building")
    .replace(/\bdetected\b/gi, "identified")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function titleCase(input: string): string {
  return input
    .replace(/[^a-z0-9\s&-]/gi, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function inferSubject(prompt: string, industry?: string): string {
  const raw = (industry || prompt || "AI Agent").trim();
  const lower = raw.toLowerCase();
  if (/retail|cash flow|cashflow|anomal/.test(lower)) return "Retail Cash Flow";
  if (/fitness|gym|workout|trainer|wellness/.test(lower)) return "Fitness Growth";
  if (/real estate|property|listing/.test(lower)) return "Real Estate";
  if (/restaurant|food|menu|booking/.test(lower)) return "Restaurant Operations";
  if (/sales|lead|crm/.test(lower)) return "Sales Pipeline";
  if (/support|ticket|customer/.test(lower)) return "Customer Support";
  return titleCase(raw) || "Autonomous Operations";
}

function fallbackSections(rawPrompt: string, industry?: string, challenges?: string): AgentSections {
  const subject = inferSubject(rawPrompt, industry);
  const promptWords = rawPrompt.trim().split(/\s+/).filter(Boolean).length;
  const assumed = promptWords <= 5 || rawPrompt.trim().length < 35;
  const assumption = assumed
    ? `Assumed: ${subject.toLowerCase()} operator audience, dashboard-first workflow, English-language users.`
    : "";
  const challengeText = challenges ? ` Key challenge: ${challenges}.` : "";

  return {
    name: `${subject} Sentinel`.slice(0, 70),
    description: `${assumption ? `${assumption} ` : ""}This agent turns “${rawPrompt.trim()}” into a practical autonomous workflow for monitoring, deciding, and producing useful next actions.${challengeText} It keeps the user in control while handling routine analysis and follow-up work automatically.`,
    goal: `Continuously improve ${subject.toLowerCase()} outcomes by turning live signals into clear decisions, alerts, and ready-to-use actions.`,
    capabilities: [
      `Collects and normalizes ${subject.toLowerCase()} inputs from user-provided systems, files, dashboards, or chat updates.`,
      `Identifies patterns, risks, bottlenecks, and high-priority opportunities tied to the original request.`,
      `Creates concise summaries, recommended actions, and next-step task lists without asking for extra setup first.`,
      `Flags unusual changes, missing data, or contradictory signals for human review.`,
      `Drafts messages, reports, checklists, and operational playbooks the user can edit in chat.`,
      `Learns preferences from follow-up chat edits and adapts future outputs to the user’s workflow.`,
    ].map((x) => `- ${x}`).join("\n"),
    workflow: [
      `Accept the user’s initial ${subject.toLowerCase()} prompt and infer the missing audience, data sources, and success criteria.`,
      `Build a lightweight operating model with key inputs, rules, risks, and expected outputs.`,
      `Scan available data or user updates for urgent signals and meaningful trends.`,
      `Prioritize what matters now using impact, confidence, urgency, and safety constraints.`,
      `Generate the recommended action package: summary, decisions, draft tasks, and follow-up questions only when necessary.`,
      `Wait for user approval before sensitive, financial, customer-facing, or irreversible actions.`,
      `Store refinements from chat so the next version is sharper and more specific.`,
    ].map((x, i) => `${i + 1}. ${x}`).join("\n"),
    guardrails: [
      `Never execute financial, legal, medical, payroll, customer-facing, or destructive actions without explicit approval.`,
      `Never invent private data; clearly mark assumptions when source data is missing.`,
      `Protect sensitive business and customer information and minimize unnecessary data exposure.`,
      `Escalate low-confidence, high-risk, or policy-sensitive decisions to the user.`,
    ].map((x) => `- ${x}`).join("\n"),
    deployment: [
      `Runs inside NazAI as a chat-driven autonomous agent with a structured Preview card.`,
      `Can connect later to spreadsheets, CRMs, accounting tools, analytics dashboards, email, or internal databases.`,
      `Can operate on scheduled reviews, user-triggered checks, and alert-based workflows.`,
    ].map((x) => `- ${x}`).join("\n"),
    impact: `A usable first-version ${subject.toLowerCase()} agent that reduces manual analysis time, gives clearer priorities, and creates a foundation the user can refine through chat instead of starting over.`,
  };
}

function parseSections(text: string): Partial<AgentSections> {
  const clean = cleanModelText(text);
  const get = (re: RegExp) => (clean.match(re)?.[1] || "").trim().replace(/\*\*/g, "");
  return {
    name: get(/1\.\s*(?:\*\*)?Agent Name(?:\*\*)?\s*:\s*([^\n]+)/i),
    description: get(/2\.\s*(?:\*\*)?Description(?:\*\*)?\s*:\s*([\s\S]*?)(?=\n\s*3\.|$)/i),
    goal: get(/3\.\s*(?:\*\*)?Primary Goal(?:\*\*)?\s*:\s*([\s\S]*?)(?=\n\s*4\.|$)/i),
    capabilities: get(/4\.\s*(?:\*\*)?Autonomous Capabilities(?:\*\*)?\s*:\s*([\s\S]*?)(?=\n\s*5\.|$)/i),
    workflow: get(/5\.\s*(?:\*\*)?Step-by-Step Workflow(?:\*\*)?\s*:\s*([\s\S]*?)(?=\n\s*6\.|$)/i),
    guardrails: get(/6\.\s*(?:\*\*)?Guardrails(?:\s*&\s*Safety)?(?:\*\*)?\s*:\s*([\s\S]*?)(?=\n\s*7\.|$)/i),
    deployment: get(/7\.\s*(?:\*\*)?Deployment Options(?:\*\*)?\s*:\s*([\s\S]*?)(?=\n\s*8\.|$)/i),
    impact: get(/8\.\s*(?:\*\*)?Expected Impact(?:\*\*)?\s*:\s*([\s\S]*?)$/i),
  };
}

function toCompleteSpec(aiText: string, rawPrompt: string, industry?: string, challenges?: string): string {
  const fallback = fallbackSections(rawPrompt, industry, challenges);
  const parsed = parseSections(aiText);
  const merged: AgentSections = {
    name: parsed.name || fallback.name,
    description: parsed.description || fallback.description,
    goal: parsed.goal || fallback.goal,
    capabilities: parsed.capabilities || fallback.capabilities,
    workflow: parsed.workflow || fallback.workflow,
    guardrails: parsed.guardrails || fallback.guardrails,
    deployment: parsed.deployment || fallback.deployment,
    impact: parsed.impact || fallback.impact,
  };

  const sparsePrompt = rawPrompt.trim().split(/\s+/).filter(Boolean).length <= 5 || rawPrompt.trim().length < 35;
  if (sparsePrompt && !/^Assumed:/i.test(merged.description)) {
    const assumption = fallback.description.match(/^Assumed:[^.]+\./)?.[0];
    if (assumption) merged.description = `${assumption} ${merged.description}`;
  }

  return `1. **Agent Name**: ${merged.name}
2. **Description**: ${merged.description}
3. **Primary Goal**: ${merged.goal}
4. **Autonomous Capabilities**:
${merged.capabilities}
5. **Step-by-Step Workflow**:
${merged.workflow}
6. **Guardrails & Safety**:
${merged.guardrails}
7. **Deployment Options**:
${merged.deployment}
8. **Expected Impact**: ${merged.impact}`.trim();
}

function sseFromText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = text.match(/[\s\S]{1,80}/g) || [text];
  return new ReadableStream({
    start(controller) {
      for (const content of chunks) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`),
        );
      }
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { prompt, messages, industry, challenges, previousSpec } = await req.json();

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

    const isRefinement = typeof previousSpec === "string" && previousSpec.trim().length > 50;

    const industryLine = industry ? `Industry: ${industry}` : "Industry: (infer from request)";
    const challengesLine = challenges ? `Challenges: ${challenges}` : "Challenges: (infer reasonable challenges)";

    const composedUserPrompt = isRefinement
      ? `EXISTING AGENT SPECIFICATION (verbatim — this is the agent you must update):
"""
${String(previousSpec).trim()}
"""

USER'S REQUESTED CHANGE (apply this to the existing spec):
"""
${rawPrompt}
"""

Return the SAME 8-section specification with the user's requested change applied. Keep every unchanged section the same. Do NOT start over, do NOT change the Agent Name unless the user explicitly asked. Use the exact 8 numbered headings verbatim (with \`**\` and trailing colons). Return ONLY the 8 sections.`
      : `USER REQUEST (verbatim, treat as source of truth):
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
      kind: Provider,
    ): Promise<{ ok: true; text: string } | { ok: false; status: number; detail: string }> {
      const isOpenAI = kind === "openai";
      const url = isOpenAI ? OPENAI_URL : LOVABLE_URL;
      const model = isOpenAI ? OPENAI_MODEL : LOVABLE_MODEL;
      const key = isOpenAI ? OPENAI_API_KEY : LOVABLE_API_KEY;
      if (!key) return { ok: false, status: 0, detail: `${kind} key missing` };

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 18_000);
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
            stream: false,
            temperature: 0.5,
            max_tokens: 2200,
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!resp.ok) {
          const detail = await resp.text().catch(() => "");
          console.error(`[generate-ai-agent] ${kind} error`, resp.status, detail.slice(0, 300));
          return { ok: false, status: resp.status, detail };
        }
        const data = await resp.json().catch(() => null);
        const text = data?.choices?.[0]?.message?.content || "";
        if (!String(text).trim()) return { ok: false, status: 502, detail: `${kind} returned empty content` };
        return { ok: true, text: String(text) };
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

    const finalSpec = toCompleteSpec(result.text, rawPrompt, industry, challenges);

    return new Response(sseFromText(finalSpec), {
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
