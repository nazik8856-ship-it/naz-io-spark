// Compile a website prompt into a structured manifest and persist to websites + website_pages.
// Input: { prompt: string, save?: boolean }
// Output: { manifest, website_id?, pages? }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

const SECTION_TYPES = ["hero", "about", "services", "testimonials", "gallery", "contact", "pricing", "faq"] as const;
type SectionType = typeof SECTION_TYPES[number];

type Section = { type: SectionType; content: Record<string, unknown> };
type Page = { slug: string; title: string; seo_description?: string; sections: Section[] };
type Theme = {
  palette: { bg: string; surface: string; text: string; accent: string; accentSecondary?: string };
  font: { heading: string; body: string };
  vibe: string;
};
type Manifest = {
  name: string;
  tagline: string;
  theme: Theme;
  pages: Page[];
};

const SCHEMA_DOC = `Return STRICT JSON only — no markdown fences, no commentary.

Shape: {
  "name": string,                 // brand / site name
  "tagline": string,              // one strong sentence, under 90 chars
  "theme": {
    "palette": { "bg": "#hex", "surface": "#hex", "text": "#hex", "accent": "#hex", "accentSecondary": "#hex" },
    "font": { "heading": string, "body": string },   // Google Fonts family names
    "vibe": string                                    // 3-6 words describing look
  },
  "pages": [
    {
      "slug": string,             // kebab-case, "home" for landing
      "title": string,            // page title
      "seo_description": string,  // 140-160 chars
      "sections": [
        { "type": "hero"|"about"|"services"|"testimonials"|"gallery"|"contact"|"pricing"|"faq",
          "content": object }
      ]
    }
  ]
}

Section content shapes (fill with REAL, specific copy — never lorem ipsum, never placeholder like "Feature 1"):
- hero:         { "headline": string, "subheadline": string, "cta_primary": string, "cta_secondary"?: string, "image_prompt": string }
- about:        { "heading": string, "body": string, "bullets": string[] }        // 3-5 bullets
- services:     { "heading": string, "items": [ { "title": string, "description": string, "icon"?: string } ] }   // 3-6 items
- testimonials: { "heading": string, "items": [ { "quote": string, "author": string, "role"?: string } ] }        // 2-4
- gallery:      { "heading": string, "items": [ { "caption": string, "image_prompt": string } ] }                 // 4-8
- contact:      { "heading": string, "body": string, "email"?: string, "phone"?: string, "address"?: string, "form_fields": string[] }
- pricing:      { "heading": string, "tiers": [ { "name": string, "price": string, "period"?: string, "features": string[], "cta": string, "featured"?: boolean } ] } // 2-4 tiers
- faq:          { "heading": string, "items": [ { "q": string, "a": string } ] }                                  // 4-8 items

Rules:
- 3-6 pages total. First page slug MUST be "home" and MUST start with a "hero" section.
- Every website should include hero + at least one of (about|services) + a contact section somewhere.
- Copy must be specific to the described business — mention what it actually does, for whom, with real language.
- No lorem ipsum, no "Coming soon", no "Lorem", no generic filler.
- Palette must be readable (contrast between bg and text).`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

function stripFences(s: string) {
  return s.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "page";
}

function normalize(raw: unknown, prompt: string): Manifest {
  const r = (raw ?? {}) as Record<string, unknown>;
  const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : "Untitled Site";
  const tagline = typeof r.tagline === "string" && r.tagline.trim() ? r.tagline.trim() : prompt.slice(0, 80);
  const themeRaw = (r.theme ?? {}) as Record<string, unknown>;
  const paletteRaw = (themeRaw.palette ?? {}) as Record<string, string>;
  const fontRaw = (themeRaw.font ?? {}) as Record<string, string>;
  const theme: Theme = {
    palette: {
      bg: paletteRaw.bg || "#0B0B0F",
      surface: paletteRaw.surface || "#151520",
      text: paletteRaw.text || "#F4F4F5",
      accent: paletteRaw.accent || "#00A3FF",
      accentSecondary: paletteRaw.accentSecondary || "#7C3AED",
    },
    font: { heading: fontRaw.heading || "Inter", body: fontRaw.body || "Inter" },
    vibe: typeof themeRaw.vibe === "string" ? themeRaw.vibe : "modern, clean, confident",
  };
  const pagesIn = Array.isArray(r.pages) ? r.pages : [];
  const pages: Page[] = pagesIn.slice(0, 6).map((p, idx) => {
    const pp = (p ?? {}) as Record<string, unknown>;
    const sectionsIn = Array.isArray(pp.sections) ? pp.sections : [];
    const sections: Section[] = sectionsIn
      .map((s) => {
        const ss = (s ?? {}) as Record<string, unknown>;
        const t = String(ss.type ?? "").toLowerCase();
        if (!SECTION_TYPES.includes(t as SectionType)) return null;
        return { type: t as SectionType, content: (ss.content as Record<string, unknown>) ?? {} };
      })
      .filter((x): x is Section => !!x);
    const title = typeof pp.title === "string" && pp.title.trim() ? pp.title.trim() : (idx === 0 ? name : `Page ${idx + 1}`);
    const slug = idx === 0 ? "home" : slugify(String(pp.slug ?? title));
    return {
      slug,
      title,
      seo_description: typeof pp.seo_description === "string" ? pp.seo_description.slice(0, 200) : `${name} — ${tagline}`.slice(0, 160),
      sections,
    };
  });

  if (!pages.length) {
    pages.push({
      slug: "home",
      title: name,
      seo_description: `${name} — ${tagline}`.slice(0, 160),
      sections: [
        { type: "hero", content: { headline: name, subheadline: tagline, cta_primary: "Get started", image_prompt: prompt } },
      ],
    });
  } else {
    pages[0].slug = "home";
    if (pages[0].sections[0]?.type !== "hero") {
      pages[0].sections.unshift({ type: "hero", content: { headline: name, subheadline: tagline, cta_primary: "Get started", image_prompt: prompt } });
    }
  }

  return { name, tagline, theme, pages };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) return json({ error: "Missing LOVABLE_API_KEY" }, 500);

    const body = await req.json().catch(() => ({}));
    const { prompt, save = true } = body || {};
    if (!prompt || typeof prompt !== "string") return json({ error: "prompt required" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;

    let manifest: Manifest;
    try {
      const resp = await fetch(LOVABLE_URL, {
        method: "POST",
        headers: { "Lovable-API-Key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: `You are NazAI Website Compiler.\n\n${SCHEMA_DOC}` },
            { role: "user", content: `Compile this website brief into the JSON manifest. Return only the JSON object.\n\nBRIEF:\n${prompt}` },
          ],
          temperature: 0.4,
        }),
      });
      if (resp.status === 429) return json({ error: "Rate limited. Please retry in a moment." }, 429);
      if (resp.status === 402) return json({ error: "AI credits exhausted for this workspace." }, 402);
      if (!resp.ok) throw new Error(`gateway ${resp.status}`);
      const data = await resp.json();
      const raw = data?.choices?.[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(stripFences(typeof raw === "string" ? raw : JSON.stringify(raw)));
      manifest = normalize(parsed, prompt);
    } catch (err) {
      console.error("compile-website-manifest AI failure", err);
      manifest = normalize({}, prompt);
    }

    if (!save || !user) return json({ manifest });

    const { data: siteRow, error: siteErr } = await supabase
      .from("websites")
      .insert({
        user_id: user.id,
        name: manifest.name,
        title: manifest.name,
        tagline: manifest.tagline,
        theme: manifest.theme,
        prompt,
        html: "",
      })
      .select("id")
      .single();

    if (siteErr || !siteRow) {
      console.error("website insert failed", siteErr);
      return json({ manifest, error: siteErr?.message ?? "failed to save website" }, 500);
    }

    const pageRows = manifest.pages.map((p, i) => ({
      website_id: siteRow.id,
      slug: p.slug,
      title: p.title,
      seo_description: p.seo_description ?? null,
      sections: p.sections,
      order_index: i,
    }));

    const { data: pagesOut, error: pagesErr } = await supabase
      .from("website_pages")
      .insert(pageRows)
      .select("id, slug, title, order_index");

    if (pagesErr) {
      console.error("website_pages insert failed", pagesErr);
      return json({ manifest, website_id: siteRow.id, error: pagesErr.message }, 500);
    }

    return json({ manifest, website_id: siteRow.id, pages: pagesOut });
  } catch (e) {
    console.error("compile-website-manifest error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
