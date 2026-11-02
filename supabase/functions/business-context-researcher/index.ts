// Auto-research a business from a short user prompt and optional URL.
// Produces a Business Profile and persists it to public.business_profiles.
// Input:  { prompt: string, url?: string, reuseLatest?: boolean }
// Output: { profile: BusinessProfile, profileId: string, isNew: boolean }
import "../_shared/redact-console.ts"; // first: secrets never reach the function logs
import { askForJson } from "../_shared/model-output.ts";
import { safeFetchText } from "../_shared/safe-fetch.ts";
import { cleanText } from "../_shared/clean-text.ts";
import { array, object, optional, text, url, withDefault } from "../_shared/schema.ts";
import { readJson } from "../_shared/input.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pickAiGateway, callAiGateway } from "../_shared/ai-gateway.ts";
import { requireCaller } from "../_shared/caller.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// The business profile as stored: short text fields, small lists, an address that is a real https address. Anything else is dropped.
const short = (max: number) => withDefault(text({ max, clip: true, multiline: false }), "");
const profileShape = object({
  company_name: short(120), one_liner: short(240), industry: short(80), tone: short(80), audience: short(200),
  offers: withDefault(array(text({ min: 1, max: 160, clip: true, multiline: false }), { max: 8, clip: true, dropInvalid: true }), [] as string[]),
  channels: withDefault(object({
    email: optional(withDefault(text({ max: 200, clip: true, multiline: false }), "")),
    support_inbox: optional(withDefault(text({ max: 200, clip: true, multiline: false }), "")),
    social: optional(withDefault(array(text({ min: 1, max: 200, clip: true, multiline: false }), { max: 6, clip: true, dropInvalid: true }), [] as string[])),
    website: optional(withDefault(url({ max: 300 }), "")),
  }), {}),
  inferred_kpis: withDefault(array(object({ name: short(80), target: short(80) }), { max: 6, clip: true, dropInvalid: true }), [] as { name: string; target: string }[]),
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const gw = pickAiGateway();
    if (!gw) return json({ error: "Missing OPENAI_API_KEY (or LOVABLE_API_KEY)" }, 500);

    const inputRead = await readJson(req, { headers: corsHeaders });
    if (!inputRead.ok) return inputRead.response;
    const { prompt = "", url: urlIn, reuseLatest = false } = inputRead.value;
    const authed = await requireCaller(req, (h) => createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: h } } },
    ));
    if (!authed.ok) return json({ error: "Not authenticated" }, 401);
    const supabase = authed.caller.userClient;
    const user = { id: authed.caller.userId };

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
        // https only, every redirect re-checked (never plain http, never an internal address).
        // at most 1 MB, 10 seconds, pages and text only (no downloads, images or archives)
        const page = await safeFetchText(url, { headers: { "User-Agent": "NazAI-Researcher/1.0" }, types: ["html", "text"], maxBytes: 1024 * 1024, onTooLarge: "truncate" });
        if (!page.ok) throw new Error(page.message);
        const html = page.text;
        scrapedTitle = cleanText(html.match(/<title>([^<]+)<\/title>/i)?.[1] || "", { max: 200, multiline: false });
        scraped = stripHtml(html).slice(0, 6000);
      } catch (e) {
        console.warn("scrape failed", e);
      }
    }

    const researchMessages: { role: string; content: string }[] = [
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
    ];
    // The reply must fit the profile shape; if it does not the model is told what was wrong and asked once more.
    let gatewayProblem: Response | null = null;
    const answer = await askForJson({
      schema: profileShape,
      call: async (correction) => {
        const aiResp = await callAiGateway({
          model: gw.model,
          messages: correction ? [...researchMessages, { role: "user", content: correction }] : researchMessages,
          temperature: 0.3,
        }, gw);
        if (aiResp.status === 429) { gatewayProblem = json({ error: "Rate limit" }, 429); return null; }
        if (aiResp.status === 402) { gatewayProblem = json({ error: "AI credits exhausted" }, 402); return null; }
        if (!aiResp.ok) { gatewayProblem = json({ error: `AI gateway ${aiResp.status}` }, 500); return null; }
        const aiData = await aiResp.json();
        return aiData?.choices?.[0]?.message?.content ?? "";
      },
    });
    if (gatewayProblem) return gatewayProblem;
    // (the model's own text is never echoed back to the caller when it could not be used)
    if (!answer.ok) return json({ error: "Could not parse research" }, 422);
    const parsed = answer.value;

    const row = {
      user_id: user.id,
      source_url: url || null,
      company_name: parsed.company_name || "Your Business",
      one_liner: parsed.one_liner,
      industry: parsed.industry,
      tone: parsed.tone || "professional",
      audience: parsed.audience,
      offers: parsed.offers,
      channels: parsed.channels,
      inferred_kpis: parsed.inferred_kpis,
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
