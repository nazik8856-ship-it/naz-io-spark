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

const SECTION_TYPES = [
  "hero", "about", "services", "testimonials", "gallery", "contact",
  "pricing", "faq", "stats", "process", "cta", "logos", "feature-split", "custom",
] as const;
type SectionType = typeof SECTION_TYPES[number];

type Section = { type: SectionType; variant?: string; content: Record<string, unknown> };
type Page = { slug: string; title: string; seo_description?: string; sections: Section[] };
type Theme = {
  palette: {
    bg: string; surface: string; text: string; accent: string;
    accentSecondary?: string; muted?: string; border?: string;
  };
  font: { heading: string; body: string; mono?: string; display?: string };
  vibe: string;
  layout?: string;
  motion?: string;
  design_rationale?: string;
};
type Manifest = {
  name: string;
  tagline: string;
  theme: Theme;
  pages: Page[];
};

const SCHEMA_DOC = `You are a senior brand + web designer. Return STRICT JSON only — no markdown fences, no commentary.

CORE DIRECTIVE — READ FIRST:
1. If the user's brief specifies colors, fonts, style, vibe, imagery, features, references, or any concrete design direction — FOLLOW IT EXACTLY. Do not "improve" or reinterpret it.
2. Only invent when the brief is silent on that dimension. When you invent, invent something SPECIFIC to this business — not a generic default.
3. AVOID these overused AI-design clichés unless the user explicitly asks for them:
   - cream/beige background + serif headings + terracotta accent
   - pure black + single neon cyan/green accent
   - purple → pink gradients on white
   - Inter for both heading and body
   - centered hero with three feature icons in a row
   - the "startup landing" template look
   Pick a palette and font pair that actually fits THIS business's audience and category.

DESIGN HEURISTICS — apply these to every site you compile (they are how skilled human designers make sites feel genuinely modern and high-end, not templated):

A. LAYOUT — commit to one deliberate asymmetric move per page
- Default AWAY from "centered". Rotate hero variants across generations: split-image, editorial-lede, asymmetric-mark, full-bleed. Use "centered" only when the brand demands luxury/minimal formality.
- Every page must include at least one off-grid moment: an oversized headline pushed left of a narrow paragraph column, a services list that breaks into 2/3 + 1/3 split, a feature-split reversed, a gallery in "showcase" (one big + smaller supporting). Do not let a page be a stack of symmetric centered blocks.
- Choose layout to match the brand: "editorial" for publishing/luxury goods, "asymmetric" for creative studios, "magazine" for lifestyle, "brutalist" for cultural/independent, "minimal-luxury" for high-end services, "split" for product-led.

B. TYPOGRAPHY as design, not decoration
- Dramatic size contrast: hero headline is 5–8x the body copy in visual weight. Body paragraphs stay short (2–3 sentences, ~55–70ch line-length feel).
- HIGHLIGHT MARKER — for every hero headline AND every major section heading you write, wrap ONE key word or short phrase (2–4 words max) with tildes: e.g. "Coffee roasted for ~the obsessed~." or "We build ~unfair advantages~ for founders." This word will be rendered in the display font in italic accent color, creating typographic focus. Pick a word that carries the promise — a noun, a verb, or a defining adjective. Never highlight generic filler ("the", "and", "we").
- Prefer a distinct "display" font for expressive brands (fashion, editorial, creative, luxury). Real Google Fonts only. Suggested pairings: Fraunces + Inter, Instrument Serif + Manrope, Bricolage Grotesque + Inter, Syne + DM Sans, Unbounded + Space Grotesque, Cormorant + Work Sans, Archivo Black + IBM Plex Sans.
- Body font must genuinely differ from heading unless the brand demands strict monoline minimalism.

C. COLOR — pick a palette FAMILY that fits the brand, not a default
- Dark-first (bg near #08–#14, high-contrast text, one saturated accent) for: tech, SaaS, agencies, creators, gaming, crypto, music, nightlife, architecture, photography, film, premium tech.
- Dopamine (bright saturated accents, optional secondary for gradients) for: consumer apps, fitness, food, kids, fashion, entertainment, events.
- Earthy (clay, wood, stone, sage, muted warm neutrals) for: wellness, hospitality, artisan, sustainable, real estate, therapy, coffee, pottery.
- Editorial light (off-white bg + rich near-black text + one restrained accent) for: publishing, law, finance, professional services, non-profits.
- Ensure WCAG AA contrast bg↔text. accentSecondary must genuinely differ from accent so gradients read.

D. VISUAL SIGNATURE — prefer bespoke over stock
- The renderer generates a unique abstract SVG signature (gradient mesh + geometric marks seeded from the site) for every image_prompt whose media_style is "illustration", "gradient", or "pattern". This is what makes each site look bespoke.
- Set media_style to "illustration"/"gradient"/"pattern" by default — that gives you the bespoke visual signature per site.
- Use media_style: "photo" only when the brand genuinely requires photography (real estate listings, food menus, gallery of past work, portrait-led hospitality). Do NOT default to photo.
- Image prompts are still specific (subject + mood + palette hint) even for signature use — they seed the pattern generator so each section gets a distinct signature.

E. DENSITY CONTRAST
- Alternate dense and spacious sections. Put stats/logos (tight, data-dense) directly next to hero/about/feature-split (spacious, breathing). Do NOT space every section uniformly — that reads as templated. A "stats" section right after the hero, followed by a spacious "about", is a strong rhythm.

F. THEMATIC COHESION — every element reinforces the same subject
- The renderer auto-derives a subject motif icon from the name + tagline (coffee cup for cafés, leaf for botanical, wave for aquatic, dumbbell for fitness, camera for photography, code for tech, brush for creative, chart for finance, flame for food, plane for travel, home for real estate, gear for industrial, note for music, hotel for hospitality, paw for pets, scissors for salon, bike for cycling, diamond for luxury, bolt for energy, etc.). This motif is used automatically across: the tiled background pattern, section dividers, service card markers, stats markers, hero decoration, and footer.
- Because motif selection keys off keywords in the name and tagline, MAKE SURE the name/tagline contains an unambiguous subject word (e.g. "Ember & Oak Coffee Bar", not just "Ember & Oak"). This is how thematic decoration stays coherent.
- Include a stats section (with concrete numbers — years, clients, cups, sessions, projects) when it fits the brief — the motif markers plus dense typography make it a signature moment.
- Include process/services variants that reinforce the theme with numbered steps or zigzag imagery.

F. MOTION — the renderer provides scroll reveal, card 3D tilt, magnetic buttons, and section background shifts by default. Choose motion level:
- "subtle" for professional/luxury/finance/editorial.
- "expressive" for consumer, creative, fashion, agency.
- "kinetic" only if the brand is explicitly playful, gaming, or hype.
- "none" only if requested.

G. CONTENT — specific, scannable, opinionated
- Copy must be concrete: what the business does, for whom, with real industry language. Every headline is a promise or a stance, not a category label.
- No lorem ipsum, no "Coming soon", no "Feature 1 / Feature 2".

BEFORE FINALIZING — silently self-check:
1. Does every hero headline and each major section heading contain exactly one ~highlighted~ word/phrase? If not, add one.
2. Is the layout deliberately NOT centered-symmetric? If it defaulted to centered, revise.
3. Does at least one section pair dense-next-to-spacious? If not, reorder.
4. Could this palette/font pair belong to any generic startup? If yes, pick something more specific to THIS brand.


Shape: {
  "name": string,
  "tagline": string,               // one strong sentence, under 90 chars
  "theme": {
    "palette": {
      "bg": "#hex", "surface": "#hex", "text": "#hex",
      "accent": "#hex", "accentSecondary": "#hex",
      "muted": "#hex", "border": "#hex"
    },
    "font": {
      "heading": string,           // Google Fonts family
      "body": string,              // Google Fonts family (SHOULD differ from heading unless minimalism demands it)
      "mono": string,              // optional
      "display": string            // optional, for oversized hero type
    },
    "vibe": string,                // 3-6 words
    "layout": "centered" | "asymmetric" | "editorial" | "split" | "grid-heavy" | "magazine" | "minimal-luxury" | "brutalist" | "playful",
    "motion": "subtle" | "expressive" | "kinetic" | "none",
    "design_rationale": string     // 1-2 sentences: WHY this palette/font/layout fits this specific brief
  },
  "pages": [
    {
      "slug": string,              // kebab-case, "home" for landing
      "title": string,
      "seo_description": string,   // 140-160 chars
      "sections": [
        { "type": "<one of the allowed types>", "variant": string, "content": object }
      ]
    }
  ]
}

Allowed section types: hero, about, services, testimonials, gallery, contact, pricing, faq, stats, process, cta, logos, feature-split, custom.

Section content shapes (fill with REAL, specific copy — never lorem ipsum, never "Feature 1"):
- hero:         { "eyebrow"?: string, "headline": string, "subheadline": string, "cta_primary": string, "cta_secondary"?: string, "image_prompt": string, "media_style"?: "photo"|"illustration"|"gradient"|"pattern", "stats"?: [{"label":string,"value":string}] }
  hero.variant: "centered" | "split-image" | "full-bleed" | "editorial-lede" | "asymmetric-mark" | "minimal-luxury"
- about:        { "heading": string, "body": string, "bullets": string[], "image_prompt"?: string, "pull_quote"?: string }
- services:     { "heading": string, "items": [ { "title": string, "description": string, "icon"?: string, "image_prompt"?: string } ] }
  services.variant: "cards" | "list" | "numbered" | "zigzag"
- testimonials: { "heading": string, "items": [ { "quote": string, "author": string, "role"?: string } ] }
- gallery:      { "heading": string, "items": [ { "caption": string, "image_prompt": string } ] }
  gallery.variant: "masonry" | "grid" | "strip" | "showcase"
- contact:      { "heading": string, "body": string, "email"?: string, "phone"?: string, "address"?: string, "form_fields": string[] }
- pricing:      { "heading": string, "tiers": [ { "name": string, "price": string, "period"?: string, "features": string[], "cta": string, "featured"?: boolean } ] }
- faq:          { "heading": string, "items": [ { "q": string, "a": string } ] }
- stats:        { "heading"?: string, "items": [ { "value": string, "label": string } ] }
- process:      { "heading": string, "steps": [ { "title": string, "description": string } ] }
- cta:          { "headline": string, "subheadline"?: string, "cta_primary": string, "cta_secondary"?: string }
- logos:        { "heading"?: string, "items": [ { "name": string } ] }
- feature-split:{ "heading": string, "body": string, "bullets"?: string[], "image_prompt": string, "reverse"?: boolean }
- custom:       { "kind": "calculator"|"booking"|"quote"|"newsletter"|"map"|"embed",
                  "heading"?: string, "body"?: string,
                  "fields"?: [{"name":string,"label":string,"type":"number"|"text"|"email"|"date"|"select","options"?:string[],"unit"?:string}],
                  "formula"?: string,                 // for calculator: e.g. "hours * rate * 1.2"
                  "output_label"?: string, "output_unit"?: string }

Image prompts: for EVERY visual section (hero, about with image, feature-split, gallery items, service items when relevant) provide a SPECIFIC image_prompt — subject, mood, lighting, palette hint. Example: "aerial photo of a wooden pilates studio at golden hour, warm shadows, muted earth tones".

Rules:
- 3-6 pages total. First page slug MUST be "home" and MUST start with a hero.
- Every site should include hero + at least one of (about|services|feature-split) + a contact or cta section.
- Vary section variants across pages so the site doesn't feel templated.
- Copy must be specific to the described business — mention what it actually does, for whom, with real language.
- No lorem ipsum, no "Coming soon", no placeholder text.
- Palette must have readable contrast between bg and text (WCAG AA).
- Fonts must be real Google Fonts families.`;

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
      muted: paletteRaw.muted,
      border: paletteRaw.border,
    },
    font: {
      heading: fontRaw.heading || "Inter",
      body: fontRaw.body || "Inter",
      mono: fontRaw.mono,
      display: fontRaw.display,
    },
    vibe: typeof themeRaw.vibe === "string" ? themeRaw.vibe : "modern, clean, confident",
    layout: typeof themeRaw.layout === "string" ? themeRaw.layout : "centered",
    motion: typeof themeRaw.motion === "string" ? themeRaw.motion : "subtle",
    design_rationale: typeof themeRaw.design_rationale === "string" ? themeRaw.design_rationale : undefined,
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
        return {
          type: t as SectionType,
          variant: typeof ss.variant === "string" ? ss.variant : undefined,
          content: (ss.content as Record<string, unknown>) ?? {},
        };
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
        { type: "hero", variant: "centered", content: { headline: name, subheadline: tagline, cta_primary: "Get started", image_prompt: prompt } },
      ],
    });
  } else {
    pages[0].slug = "home";
    if (pages[0].sections[0]?.type !== "hero") {
      pages[0].sections.unshift({ type: "hero", variant: "centered", content: { headline: name, subheadline: tagline, cta_primary: "Get started", image_prompt: prompt } });
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
            { role: "user", content: `Compile this website brief into the JSON manifest. Follow user-specified style STRICTLY; invent a distinct identity where the brief is silent. Return only the JSON object.\n\nBRIEF:\n${prompt}` },
          ],
          temperature: 0.85,
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
