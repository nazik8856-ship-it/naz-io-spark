// Auto-research a business from a short user prompt and optional URL.
// Produces a Business Profile and persists it to public.business_profiles.
// Input:  { prompt: string, url?: string, reuseLatest?: boolean }
// Output: { profile: BusinessProfile, profileId: string, isNew: boolean }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) return json({ error: "Missing LOVABLE_API_KEY" }, 500);

    const { prompt = "", url: urlIn, reuseLatest = false } = await req.json().catch(() => ({}));
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "Not authenticated" }, 401);

    if (reuseLatest) {
      const { data: existing } = await supabase
        .from("business_profiles").select("*")
        .eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (existing) return json({ profile: existing, profileId: existing.id, isNew: false });
    }

    const url = (urlIn || extractUrl(prompt) || "").trim();
    let scraped = "";
    let scrapedTitle = "";
    if (url) {
      try {
        const resp = await fetch(url.startsWith("http") ? url : `https://${url}`, {
          headers: { "User-Agent": "NazAI-Researcher/1.0" }, redirect: "follow",
        });
        const html = await resp.text();
        scrapedTitle = (html.match(/<title>([^<]+)<\/title>/i)?.[1] || "").trim();
        scraped = stripHtml(html).slice(0, 6000);
      } catch (e) {
        console.warn("scrape failed", e);
      }
    }

    const aiResp = await fetch(LOVABLE_URL, {
      method: "POST",
      headers: { "Lovable-API-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content: `You are a business analyst. Given a short user goal and (optionally) scraped homepage text, infer the operating profile of the business.

Return STRICT JSON (no fences) with shape:
{
  "company_name": string,
  "one_liner": string,        // <= 140 chars
  "industry": string,
  "tone": string,             // e.g. "warm + professional", "playful + bold"
  "audience": string,         // who they serve
  "offers": string[],         // 2-5 core products/services
  "channels": { "email"?: string, "support_inbox"?: string, "social"?: string[], "website"?: string },
  "inferred_kpis": [ { "name": string, "target": string } ],  // 2-4
  "confidence": "high" | "medium" | "low"
}

If you don't know a field, infer a sensible default for the industry. NEVER return null. Keep it concise.`,
          },
          {
            role: "user",
            content: `USER PROMPT:\n${prompt || "(none)"}\n\nURL: ${url || "(none)"}\nPAGE TITLE: ${scrapedTitle || "(none)"}\n\nSCRAPED HOMEPAGE TEXT (truncated):\n${scraped || "(none)"}`,
          },
        ],
        temperature: 0.3,
      }),
    });
    if (aiResp.status === 429) return json({ error: "Rate limit" }, 429);
    if (aiResp.status === 402) return json({ error: "AI credits exhausted" }, 402);
    if (!aiResp.ok) return json({ error: `AI gateway ${aiResp.status}` }, 500);
    const aiData = await aiResp.json();
    const raw = aiData?.choices?.[0]?.message?.content ?? "";
    const parsed = extractJson(raw);
    if (!parsed) return json({ error: "Could not parse research", raw }, 422);

    const row = {
      user_id: user.id,
      source_url: url || null,
      company_name: str(parsed.company_name, 120) || "Your Business",
      one_liner: str(parsed.one_liner, 240) || "",
      industry: str(parsed.industry, 80) || "",
      tone: str(parsed.tone, 80) || "professional",
      audience: str(parsed.audience, 200) || "",
      offers: Array.isArray(parsed.offers) ? parsed.offers.slice(0, 8) : [],
      channels: (parsed.channels && typeof parsed.channels === "object") ? parsed.channels : {},
      inferred_kpis: Array.isArray(parsed.inferred_kpis) ? parsed.inferred_kpis.slice(0, 6) : [],
      raw_research: { ai: parsed, scraped_chars: scraped.length, scraped_title: scrapedTitle },
    };
    const { data: inserted, error: insErr } = await supabase
      .from("business_profiles").insert(row).select("*").single();
    if (insErr) return json({ error: insErr.message }, 500);

    return json({ profile: inserted, profileId: inserted.id, isNew: true });
  } catch (e) {
    console.error("business-context-researcher error", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}
function extractUrl(t: string): string | null {
  if (!t) return null;
  const m = t.match(/\bhttps?:\/\/[^\s)]+/i) || t.match(/\b(?:[a-z0-9-]+\.)+(?:com|io|ai|co|app|dev|net|org|xyz|so|tech|store|shop|me|biz|cloud)\b[^\s)]*/i);
  return m ? m[0] : null;
}
function stripHtml(s: string): string {
  return s.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function extractJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  const cleaned = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* */ }
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
