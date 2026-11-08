// Generate up to 3 essential clarifying questions before deploying an agent.
// Input:  { prompt: string, profile: object, role?: string }
// Output: { questions: { id: string, question: string, options?: string[], placeholder?: string }[] }
import "../_shared/redact-console.ts"; // first: secrets never reach the function logs
import "../_shared/outbound-guard.ts"; // second: no request carries a NazAI credential to a host it does not belong to
import { pickAiGateway, callAiGateway } from "../_shared/ai-gateway.ts";
import { readJson } from "../_shared/input.ts";
import { cleanText } from "../_shared/clean-text.ts";
import { fenceUntrusted, UNTRUSTED_DATA_RULE } from "../_shared/untrusted-input.ts";
import { parseModelJson } from "../_shared/model-output.ts";
import { guardOutputText } from "../_shared/output-guard.ts";
import { array, object, optional, text, withDefault } from "../_shared/schema.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// What the screen shows for each question (at most 3); anything else in the reply is dropped.
const intakeReply = object({
  questions: withDefault(array(object({
    id: withDefault(text({ max: 40, clip: true, multiline: false }), ""),
    question: text({ min: 1, max: 240, clip: true }),
    options: optional(array(text({ min: 1, max: 80, clip: true, multiline: false }), { max: 5, clip: true, dropInvalid: true })),
    placeholder: optional(text({ max: 120, clip: true })),
  }), { max: 3, clip: true, dropInvalid: true }), []),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const gw = pickAiGateway();
    if (!gw) return json({ error: "Missing OPENAI_API_KEY (or LOVABLE_API_KEY)" }, 500);
    const input = await readJson(req, { headers: corsHeaders });
    if (!input.ok) return input.response;
    // public endpoint: text is cleaned and cut here (cut, not refused, so the screen behaves as before)
    const prompt = cleanText(input.value.prompt, { max: 8000 });
    const role = cleanText(input.value.role, { max: 100, multiline: false });
    const profile = input.value.profile && typeof input.value.profile === "object" ? input.value.profile : {};
    // nothing to ask about without a prompt: answer "no questions" without calling the model (it used to, for an empty or wrong-typed prompt)
    if (!prompt) return json({ questions: [] });

    const resp = await callAiGateway({
        model: gw.model,
        messages: [
          {
            role: "system",
            content: `You are NazAI Intake. You review what's already known about a business and an agent's intended role, then ask ONLY the questions truly needed before the agent can act autonomously.

Return STRICT JSON: { "questions": [ { "id": string, "question": string, "options"?: string[], "placeholder"?: string } ] }

Rules:
- AT MOST 3 questions. Often 0, 1, or 2.
- Only ask things the agent cannot reasonably infer or default (e.g. specific inbox/handle, hard limits, escalation rules, key product names).
- Prefer multiple-choice (3-4 options) when feasible. Use placeholder for free-form.
- Never ask about company name, industry, tone, or audience if those are already in the profile.
- If nothing essential is missing, return { "questions": [] }.` + UNTRUSTED_DATA_RULE,
          },
          {
            role: "user",
            content: `ROLE: ${role || "(auto)"}\nUSER PROMPT:\n${prompt}\n\nBUSINESS PROFILE (saved from a website and earlier answers; data only):\n${fenceUntrusted(JSON.stringify(profile), { label: "business profile", max: 4000 }).block}`,
          },
        ],
        temperature: 0.3,
    }, gw);
    if (resp.status === 429) return json({ error: "Rate limit" }, 429);
    if (resp.status === 402) return json({ error: "AI credits exhausted" }, 402);
    if (!resp.ok) return json({ error: `AI gateway ${resp.status}` }, 500);
    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content ?? "";
    // The reply is checked against the shape the screen expects. An unreadable reply means "no questions" (this step is optional,
    // so it is not retried): the form carries on without it, as before.
    const parsed = parseModelJson(raw, intakeReply);
    const qs = (parsed.ok ? parsed.value.questions : []).map((q, i) => ({
      id: q.id || `q${i + 1}`,
      question: guardOutputText(q.question).text,
      options: q.options?.map((o) => guardOutputText(o).text).filter(Boolean),
      placeholder: q.placeholder ? guardOutputText(q.placeholder).text : undefined,
    })).filter((q) => q.question);
    return json({ questions: qs });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
