// Reads and analyzes user-attached inputs (files, URLs, imported data, integration
// snapshots) BEFORE generation. Returns a compact structured analysis + an enriched
// prompt block so downstream compilers (websites, agents, future kinds) work off
// real understanding of what the user provided — not just raw appended text.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

type InAtt = { id?: string; label?: string; contextText?: string; url?: string; kind?: string };

function stripFences(s: string) {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
}

async function fetchUrlText(url: string): Promise<string> {
  try {
    const r = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 NazAI-Analyzer/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return `(fetch failed ${r.status})`;
    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("text") && !ct.includes("json") && !ct.includes("xml")) {
      return `(non-text content: ${ct})`;
    }
    const raw = await r.text();
    // Strip scripts/styles then tags
    const cleaned = raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned.length > 8000 ? cleaned.slice(0, 8000) + " …(truncated)" : cleaned;
  } catch (e) {
    return `(fetch error: ${(e as Error).message})`;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) return json({ error: "Missing LOVABLE_API_KEY" }, 500);

    const body = await req.json().catch(() => ({}));
    const prompt: string = String(body?.prompt ?? "").trim();
    const tone: string | null = body?.tone ?? null;
    const kind: string = String(body?.kind ?? "generic");
    const attachments: InAtt[] = Array.isArray(body?.attachments) ? body.attachments : [];
    if (!prompt) return json({ error: "prompt required" }, 400);

    // Auth (optional) — enables per-user integration snapshot lookup
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;

    // 1) Resolve every attachment into readable text.
    const resolved: { label: string; source: string; text: string }[] = [];
    for (const a of attachments) {
      const label = a.label || a.id || "attachment";
      if (a.url) {
        const text = await fetchUrlText(a.url);
        resolved.push({ label, source: `url:${a.url}`, text });
      } else if (a.contextText) {
        resolved.push({ label, source: a.kind || "inline", text: a.contextText.slice(0, 12000) });
      }
    }

    // 2) Pull latest integration snapshots for the user (authoritative server-side pull).
    if (userId) {
      const { data: snaps } = await supabase
        .from("integration_snapshots")
        .select("provider, summary, data, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5);
      (snaps || []).forEach((s: any) => {
        const summary = typeof s.summary === "string" ? s.summary : "";
        const dataStr = s.data ? JSON.stringify(s.data).slice(0, 4000) : "";
        if (summary || dataStr) {
          resolved.push({
            label: `Integration · ${s.provider}`,
            source: `integration:${s.provider}`,
            text: [summary, dataStr].filter(Boolean).join("\n"),
          });
        }
      });
    }

    // 3) If nothing to analyze beyond the bare prompt, return early with a
    //    passthrough enriched prompt.
    if (resolved.length === 0) {
      const extras = tone ? `\n\n--- Additional context ---\nDesired tone/style: ${tone}.` : "";
      return json({
        analysis: null,
        enrichedPrompt: `${prompt}${extras}`,
      });
    }

    // 4) Run Lovable AI to extract a structured analysis.
    const inputsBlock = resolved
      .map((r, i) => `# Attachment ${i + 1} — ${r.label} [${r.source}]\n${r.text}`)
      .join("\n\n");

    const system = `You are an input analyst for NazAI. The user is about to generate a ${kind} (website, AI agent, or similar). Read their brief AND every attached input carefully, then extract a compact structured analysis they can rely on downstream.

Return ONLY valid JSON with this shape (omit fields you cannot infer):
{
  "intent": string,               // one sentence — what the user actually wants
  "entities": string[],           // names, brands, products, people, places mentioned
  "brand_voice": string,          // tone/personality inferred from inputs (empty if none)
  "palette_hints": string[],      // colors/moods explicitly present or strongly implied
  "layout_hints": string[],       // layout/style cues if present
  "data_summary": string,         // 1-3 sentences describing any imported data/tables/CSVs
  "key_facts": string[],          // concrete facts pulled from attachments (max 12)
  "requirements": string[],       // explicit must-haves the user stated
  "user_specified_style": boolean // true if user gave explicit style/color/vibe direction
}

Rules:
- Attribute facts to their source when useful.
- Never invent data that isn't in the brief or attachments.
- If attachments contradict the brief, prefer the brief and note the conflict in "requirements".`;

    const userMsg = `USER BRIEF:\n${prompt}\n\n${tone ? `USER TONE PREFERENCE: ${tone}\n\n` : ""}ATTACHED INPUTS (${resolved.length}):\n\n${inputsBlock}`;

    let analysis: Record<string, unknown> | null = null;
    try {
      const resp = await fetch(LOVABLE_URL, {
        method: "POST",
        headers: { "Lovable-API-Key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userMsg },
          ],
          temperature: 0.2,
          response_format: { type: "json_object" },
        }),
      });
      if (resp.status === 429) return json({ error: "Rate limited. Please retry in a moment." }, 429);
      if (resp.status === 402) return json({ error: "AI credits exhausted." }, 402);
      if (resp.ok) {
        const data = await resp.json();
        const raw = data?.choices?.[0]?.message?.content ?? "{}";
        analysis = JSON.parse(stripFences(typeof raw === "string" ? raw : JSON.stringify(raw)));
      }
    } catch (e) {
      console.error("analyze-inputs AI failure", e);
    }

    // 5) Build the enriched prompt block passed to downstream compilers.
    const lines: string[] = [prompt];
    lines.push("", "--- Analyzed context (AI-read from attachments) ---");
    if (tone) lines.push(`Desired tone/style: ${tone}.`);
    if (analysis) {
      if (analysis.intent) lines.push(`Intent: ${analysis.intent}`);
      const arr = (k: string) =>
        Array.isArray((analysis as any)[k]) ? ((analysis as any)[k] as string[]).filter(Boolean) : [];
      const entities = arr("entities");
      if (entities.length) lines.push(`Entities: ${entities.join(", ")}`);
      if (analysis.brand_voice) lines.push(`Brand voice: ${analysis.brand_voice}`);
      const palette = arr("palette_hints");
      if (palette.length) lines.push(`Palette hints: ${palette.join(", ")}`);
      const layout = arr("layout_hints");
      if (layout.length) lines.push(`Layout hints: ${layout.join(", ")}`);
      if (analysis.data_summary) lines.push(`Data summary: ${analysis.data_summary}`);
      const facts = arr("key_facts");
      if (facts.length) {
        lines.push("Key facts from attachments:");
        facts.slice(0, 12).forEach((f) => lines.push(`- ${f}`));
      }
      const reqs = arr("requirements");
      if (reqs.length) {
        lines.push("Explicit requirements:");
        reqs.forEach((r) => lines.push(`- ${r}`));
      }
      if (analysis.user_specified_style) {
        lines.push("NOTE: user gave explicit style direction — follow it strictly.");
      }
    } else {
      // Fallback if analyzer failed: attach cleaned raw text so nothing is lost.
      resolved.slice(0, 5).forEach((r) => {
        lines.push(`\n[${r.label}] ${r.text.slice(0, 2000)}`);
      });
    }

    return json({ analysis, enrichedPrompt: lines.join("\n") });
  } catch (e) {
    console.error("analyze-inputs error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
