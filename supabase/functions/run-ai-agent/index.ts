import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

function deriveSystemPrompt(spec: string): string {
  return `You are the autonomous AI agent described in the specification below. Stay fully in-character as this agent at all times. Never break character, never mention being an LLM, never say you cannot perform real actions — instead, simulate performing them concretely with realistic outputs (booked confirmations, generated drafts, decisions, follow-ups, etc.). When the user asks you to do something within your capabilities, DO IT — produce the concrete deliverable the agent would produce (a confirmation, a plan, a message, a summary, a recommendation). Be concise, professional, and useful. Honor the guardrails in your spec and ask for human approval only when the spec requires it.

=== AGENT SPECIFICATION ===
${spec}
=== END SPECIFICATION ===`;
}

async function callGateway(body: unknown, key: string, stream: boolean) {
  return await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return errorResponse(500, "LOVABLE_API_KEY not configured");

    const { spec, messages } = await req.json();
    if (!spec || typeof spec !== "string") return errorResponse(400, "spec required");

    const systemPrompt = deriveSystemPrompt(spec);

    // INIT mode: no chat history → bootstrap the agent (name, greeting, suggestions)
    if (!messages || (Array.isArray(messages) && messages.length === 0)) {
      const initResp = await callGateway(
        {
          model: MODEL,
          messages: [
            {
              role: "system",
              content:
                "You extract a clean agent bootstrap from an AI agent specification. Return STRICT JSON only — no markdown fences, no commentary.",
            },
            {
              role: "user",
              content: `From the spec below, return JSON with exactly these keys:
- "name": short agent name (string, from section 1)
- "greeting": one-sentence in-character greeting the agent says when first opened. Should reference what it can do.
- "suggestedPrompts": array of EXACTLY 3 short user prompts (max 8 words each) the user could click to interact with this agent immediately.

Spec:
${spec}

Return ONLY the JSON object.`,
            },
          ],
          temperature: 0.5,
          response_format: { type: "json_object" },
        },
        LOVABLE_API_KEY,
        false,
      );

      if (initResp.status === 429) return errorResponse(429, "Rate limit hit. Try again shortly.");
      if (initResp.status === 402) return errorResponse(402, "AI credits exhausted.");
      if (!initResp.ok) {
        const t = await initResp.text();
        console.error("init gateway error", initResp.status, t);
        return errorResponse(500, "AI error");
      }

      const data = await initResp.json();
      const raw = data?.choices?.[0]?.message?.content ?? "{}";
      let parsed: { name?: string; greeting?: string; suggestedPrompts?: string[] } = {};
      try {
        parsed = JSON.parse(raw);
      } catch {
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) {
          try {
            parsed = JSON.parse(m[0]);
          } catch {
            // fallthrough
          }
        }
      }

      const name = (parsed.name || "AI Agent").toString().slice(0, 60);
      const greeting =
        (parsed.greeting || `Hi, I'm ${name}. Tell me what you need and I'll handle it.`)
          .toString()
          .slice(0, 400);
      const suggestedPrompts = Array.isArray(parsed.suggestedPrompts)
        ? parsed.suggestedPrompts.slice(0, 3).map((s: unknown) => String(s).slice(0, 80))
        : [];

      return new Response(
        JSON.stringify({
          agentId: crypto.randomUUID(),
          name,
          greeting,
          suggestedPrompts,
          systemPrompt,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // CHAT mode: stream the agent reply
    const chatMessages = [
      { role: "system", content: systemPrompt },
      ...messages.map((m: { role: string; content: string }) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content ?? ""),
      })),
    ];

    const resp = await callGateway(
      {
        model: MODEL,
        messages: chatMessages,
        stream: true,
        temperature: 0.7,
      },
      LOVABLE_API_KEY,
      true,
    );

    if (resp.status === 429) return errorResponse(429, "Rate limit hit. Try again shortly.");
    if (resp.status === 402) return errorResponse(402, "AI credits exhausted.");
    if (!resp.ok || !resp.body) {
      const t = await resp.text().catch(() => "");
      console.error("chat gateway error", resp.status, t);
      return errorResponse(500, "AI error");
    }

    return new Response(resp.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("run-ai-agent error", e);
    return errorResponse(500, e instanceof Error ? e.message : "unknown");
  }
});
