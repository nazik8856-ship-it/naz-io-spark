// Generate up to 3 essential clarifying questions before deploying an agent.
// Input:  { prompt: string, profile: object, role?: string }
// Output: { questions: { id: string, question: string, options?: string[], placeholder?: string }[] }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { pickAiGateway, callAiGateway } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const gw = pickAiGateway();
    if (!gw) return json({ error: "Missing OPENAI_API_KEY (or LOVABLE_API_KEY)" }, 500);
    const { prompt = "", profile = {}, role = "" } = await req.json().catch(() => ({}));

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
- If nothing essential is missing, return { "questions": [] }.`,
          },
          {
            role: "user",
            content: `ROLE: ${role || "(auto)"}\nUSER PROMPT:\n${prompt}\n\nBUSINESS PROFILE:\n${JSON.stringify(profile).slice(0, 4000)}`,
          },
        ],
        temperature: 0.3,
    }, gw);
    if (resp.status === 429) return json({ error: "Rate limit" }, 429);
    if (resp.status === 402) return json({ error: "AI credits exhausted" }, 402);
    if (!resp.ok) return json({ error: `AI gateway ${resp.status}` }, 500);
    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content ?? "";
    const parsed = extractJson(raw) ?? { questions: [] };
    const qs = Array.isArray((parsed as { questions?: unknown[] }).questions)
      ? ((parsed as { questions: Record<string, unknown>[] }).questions).slice(0, 3).map((q, i) => ({
        id: typeof q.id === "string" ? q.id : `q${i + 1}`,
        question: String(q.question || "").slice(0, 240),
        options: Array.isArray(q.options) ? (q.options as string[]).slice(0, 5) : undefined,
        placeholder: typeof q.placeholder === "string" ? q.placeholder.slice(0, 120) : undefined,
      })).filter((q) => q.question)
      : [];
    return json({ questions: qs });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function extractJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  const c = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(c); } catch { /* */ }
  const m = c.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
