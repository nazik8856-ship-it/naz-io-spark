// agent-think-tank
// Streams a 4-agent "Think Tank" chain over a user directive via SSE:
//   [Architect + Pixel] (parallel) -> [Syntax] -> [Echo]
// Echo enforces "Authority Mode": if the directive is judged inefficient/trash,
// it intercepts and returns "You're completely wrong" + a perspective alternative.
//
// Each agent emits structured status frames the UI renders as a terminal log.
// Frame types: agent_start | agent_thought | agent_done | authority_intercept | final | error
//
// Note: This function is additive. It does NOT replace process-mission or
// generate-business-plan. It runs in parallel as an opt-in "think process".

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

type AgentId = "architect" | "pixel" | "syntax" | "echo";

const SYSTEM_PROMPTS: Record<AgentId, string> = {
  architect: `You are ARCHITECT — the lead strategist of the NazAI Think Tank.
Your job: judge technical feasibility, surface the highest-leverage approach, and own the vision.
Style: terse, decisive, no fluff. Short sentences.

Return ONLY a strict JSON object (no markdown, no fences):
{
  "verdict": "viable" | "weak" | "trash",
  "thesis": "one sentence — the core technical/strategic move",
  "stack": ["3-5 short tech or system choices"],
  "risks": ["1-3 short risks worth naming"],
  "next_actions": ["3-5 concrete steps, each <6 words"]
}`,

  pixel: `You are PIXEL — the design lead of the NazAI Think Tank.
Your job: define the UI/UX direction, visual hierarchy, motion language, and emotional tone.
Style: opinionated, references real design systems, avoids generic advice.

Return ONLY a strict JSON object (no markdown, no fences):
{
  "aesthetic": "1-3 word direction (e.g. 'Obsidian Glass', 'Clean Brutalist')",
  "palette": ["3-5 hex colors"],
  "typography": { "display": "font family", "body": "font family" },
  "motion": "one sentence describing motion language",
  "key_screens": ["3-4 screens that must exist"]
}`,

  syntax: `You are SYNTAX — the implementation engineer of the NazAI Think Tank.
You receive Architect's plan and Pixel's design direction and produce a build plan.
Style: pragmatic, modular, explicit about file boundaries.

Return ONLY a strict JSON object (no markdown, no fences):
{
  "modules": [
    { "name": "ModuleName", "purpose": "one short sentence", "files": ["src/path.tsx"] }
  ],
  "data_model": ["1-4 short table/entity descriptions, e.g. 'projects(id, owner, html, status)'"],
  "integrations": ["1-4 external services or APIs to wire (or empty array)"],
  "build_order": ["3-6 ordered steps to ship a functional v1"]
}`,

  echo: `You are ECHO — the QA, copywriter, and FINAL GATE of the NazAI Think Tank.
You receive the directive plus Architect / Pixel / Syntax outputs.

Authority Mode (CRITICAL):
- If the directive is genuinely inefficient, derivative, or strategically wrong (e.g. "build a Facebook clone", "another to-do app", "yet another generic AI chatbot wrapper"),
  you MUST intercept. Set "intercept": true. Open the message with the EXACT phrase: "You're completely wrong."
  Then deliver a sharp, perspective-shifting alternative that follows industry best practices.
- Otherwise, set "intercept": false and write polished launch copy.

Return ONLY a strict JSON object (no markdown, no fences):
{
  "intercept": true | false,
  "headline": "<=8 words — punchy product headline",
  "subhead": "<=20 words — what it does and who it's for",
  "cta": "2-4 words",
  "edge_cases": ["2-4 short edge cases or QA notes"],
  "authority_message": "<empty string OR if intercept=true: starts with 'You're completely wrong.' followed by 2-3 sentences of perspective>"
}`,
};

// Lovable-recommended check: does the directive smell trash?
// We pass this as a hint to Echo — Echo still makes the final call.
const detectTrashSignals = (directive: string): string[] => {
  const d = directive.toLowerCase();
  const flags: string[] = [];
  const cliches: { needle: RegExp; flag: string }[] = [
    { needle: /(facebook|instagram|tiktok|twitter|x)\s*clone/, flag: "social-clone" },
    { needle: /(uber|airbnb|doordash)\s*for\s*\w+/, flag: "x-for-y-cliche" },
    { needle: /\b(another|yet another)\s+(to[- ]?do|todo|note|chat\s*bot)/, flag: "saturated-vertical" },
    { needle: /\bnft\s*(marketplace|platform)/, flag: "speculative-fad" },
    { needle: /\bblockchain\s+based\s+(social|chat|note)/, flag: "blockchain-misuse" },
    { needle: /\bai\s+(wrapper|chatbot)\s+for\s+\w+/, flag: "thin-ai-wrapper" },
  ];
  for (const c of cliches) if (c.needle.test(d)) flags.push(c.flag);
  if (directive.trim().length < 12) flags.push("too-vague");
  return flags;
};

const callAgent = async (
  agentId: AgentId,
  userPayload: string,
  apiKey: string,
): Promise<{ raw: string; parsed: any }> => {
  const resp = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPTS[agentId] },
        { role: "user", content: userPayload },
      ],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`agent ${agentId} gateway ${resp.status}: ${errText}`);
  }
  const data = await resp.json();
  const raw: string = data.choices?.[0]?.message?.content ?? "";
  let parsed: any = null;
  try {
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = { _unparsed: raw };
  }
  return { raw, parsed };
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth
  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await supabaseClient.auth.getUser(token);
  if (!user) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Body
  let directive = "";
  try {
    const body = await req.json();
    directive = String(body?.directive ?? "").slice(0, 4000);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!directive.trim()) {
    return new Response(JSON.stringify({ error: "directive is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const trashSignals = detectTrashSignals(directive);
  const startedAt = Date.now();

  // SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (frame: Record<string, any>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      };

      const safeAgent = async (
        id: AgentId,
        label: string,
        userPayload: string,
      ): Promise<any> => {
        const t = Date.now();
        send({ type: "agent_start", agent: id, label, ts: Date.now() - startedAt });
        try {
          const { parsed } = await callAgent(id, userPayload, LOVABLE_API_KEY);
          send({
            type: "agent_done",
            agent: id,
            label,
            output: parsed,
            duration_ms: Date.now() - t,
            ts: Date.now() - startedAt,
          });
          return parsed;
        } catch (err) {
          send({
            type: "agent_error",
            agent: id,
            label,
            message: (err as Error).message,
            ts: Date.now() - startedAt,
          });
          throw err;
        }
      };

      try {
        send({
          type: "init",
          directive,
          chain: ["architect+pixel", "syntax", "echo"],
          trash_signals: trashSignals,
          ts: 0,
        });

        // PHASE 1: Architect + Pixel in parallel
        send({ type: "phase", phase: "strategy", ts: Date.now() - startedAt });
        const [architect, pixel] = await Promise.all([
          safeAgent(
            "architect",
            "Architect (Lead)",
            `Directive from user:\n"""${directive}"""\n\nReturn your strict JSON verdict.`,
          ),
          safeAgent(
            "pixel",
            "Pixel (Designer)",
            `Directive from user:\n"""${directive}"""\n\nReturn your strict JSON design direction.`,
          ),
        ]);

        // PHASE 2: Syntax
        send({ type: "phase", phase: "build_plan", ts: Date.now() - startedAt });
        const syntax = await safeAgent(
          "syntax",
          "Syntax (Engineer)",
          `Directive: """${directive}"""

Architect output: ${JSON.stringify(architect)}
Pixel output: ${JSON.stringify(pixel)}

Produce the build plan.`,
        );

        // PHASE 3: Echo (final gate + Authority Mode)
        send({ type: "phase", phase: "qa_authority", ts: Date.now() - startedAt });
        const echoHint = trashSignals.length
          ? `Heuristic trash signals detected: ${trashSignals.join(", ")}. Weigh these but make your own call.`
          : `No automatic trash signals detected. Weigh the directive on merit.`;

        const echo = await safeAgent(
          "echo",
          "Echo (QA / Authority)",
          `Directive: """${directive}"""

${echoHint}

Architect verdict: ${architect?.verdict ?? "n/a"}
Architect thesis: ${architect?.thesis ?? "n/a"}
Pixel aesthetic: ${pixel?.aesthetic ?? "n/a"}
Syntax modules: ${JSON.stringify(syntax?.modules ?? [])}

Decide: intercept or polish? Return strict JSON.`,
        );

        // Authority intercept
        if (echo?.intercept) {
          send({
            type: "authority_intercept",
            agent: "echo",
            label: "Echo (Authority)",
            message: echo?.authority_message ?? "You're completely wrong.",
            alternative: {
              architect_thesis: architect?.thesis ?? null,
              suggested_stack: architect?.stack ?? [],
              suggested_actions: architect?.next_actions ?? [],
            },
            ts: Date.now() - startedAt,
          });
        }

        // FINAL combined output
        send({
          type: "final",
          intercept: !!echo?.intercept,
          architect,
          pixel,
          syntax,
          echo,
          total_ms: Date.now() - startedAt,
          ts: Date.now() - startedAt,
        });

        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
      } catch (err) {
        send({
          type: "error",
          message: (err as Error).message,
          ts: Date.now() - startedAt,
        });
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});
