import "../_shared/redact-console.ts"; // first: secrets never reach the function logs
import "../_shared/outbound-guard.ts"; // second: no request carries a NazAI credential to a host it does not belong to
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";
import { checkIpRateLimit } from "../_shared/rate-limit.ts";
import { pickAiGateway, callAiGateway } from "../_shared/ai-gateway.ts";
import { readJson } from "../_shared/input.ts";
import { guardedDeltaStream, leakFragments } from "../_shared/output-guard.ts";
import { array, object, oneOf, text, withDefault } from "../_shared/schema.ts";

// This endpoint is intentionally reachable without a signed-in session --
// /generation-workspace is a public, unauthenticated try-before-signup
// flow. There's no user_id to rate-limit or bill against, so abuse
// protection is IP-keyed instead (same pattern control-api uses for its
// own pre-auth traffic).
const RATE_LIMIT_PER_WINDOW = 10;
const RATE_LIMIT_WINDOW_SECONDS = 600;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Mode = "plan" | "build" | "ask";

// What a visitor may send (this endpoint is public): only their own turns and the assistant's earlier ones -- a "system" message in
// the history is dropped, never passed on to the model -- the newest 40, each cut at 30,000 characters.
const chatBody = object({
  messages: array(object({ role: oneOf(["user", "assistant"] as const), content: text({ min: 1, max: 30000, clip: true }) }), { max: 40, clip: true, dropInvalid: true, keep: "last" }),
  mode: withDefault(oneOf(["plan", "build", "ask"] as const), "build"),
});

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("cf-connecting-ip")
      || "unknown";
    const ipRate = await checkIpRateLimit(admin, ip, "nazai-chat", RATE_LIMIT_PER_WINDOW, RATE_LIMIT_WINDOW_SECONDS);
    if (!ipRate.allowed) {
      return new Response(
        JSON.stringify({ error: "Too many requests from this address. Try again shortly." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const input = await readJson(req, { headers: corsHeaders });
    if (!input.ok) return input.response;
    const parsedChat = chatBody(input.value);
    const messages = parsedChat.ok ? parsedChat.value.messages : [];
    const chatMode: Mode = parsedChat.ok ? parsedChat.value.mode : "build";

    const gw = pickAiGateway();
    if (!gw) throw new Error("Missing OPENAI_API_KEY (or LOVABLE_API_KEY)");

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const response = await callAiGateway({
      model: gw.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPTS[chatMode] },
        ...messages,
      ],
      stream: true,
    }, gw);

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

    // The model's words are guarded line by line as they stream: raw HTML, unsafe links, pictures from outside hosts, template markers
    // and echoed system instructions are removed; code blocks pass untouched.
    const guarded = response.body
      ? guardedDeltaStream(response.body, { leakFragments: leakFragments(SYSTEM_PROMPTS[chatMode]) })
      : response.body;
    return new Response(guarded, {
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
