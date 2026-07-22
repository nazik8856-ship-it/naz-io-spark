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
const MODEL = "google/gemini-3.6-flash";

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
- hero:         { "eyebrow"?: string, "headline": string, "subheadline": string, "cta_primary": string, "cta_primary_href"?: string, "cta_secondary"?: string, "cta_secondary_href"?: string, "image_prompt": string, "asset_url"?: string, "media_style"?: "photo"|"illustration"|"gradient"|"pattern", "stats"?: [{"label":string,"value":string}] }
  hero.variant: "centered" | "split-image" | "full-bleed" | "editorial-lede" | "asymmetric-mark" | "minimal-luxury"
- about:        { "heading": string, "body": string, "bullets": string[], "image_prompt"?: string, "asset_url"?: string, "pull_quote"?: string }
- services:     { "heading": string, "items": [ { "title": string, "description": string, "icon"?: string, "image_prompt"?: string } ] }
  services.variant: "cards" | "list" | "numbered" | "zigzag"
- testimonials: { "heading": string, "items": [ { "quote": string, "author": string, "role"?: string } ] }
- gallery:      { "heading": string, "items": [ { "caption": string, "image_prompt": string, "asset_url"?: string } ] }
  gallery.variant: "masonry" | "grid" | "strip" | "showcase"
- contact:      { "heading": string, "body": string, "email"?: string, "phone"?: string, "address"?: string, "form_fields": string[] }
- pricing:      { "heading": string, "tiers": [ { "name": string, "price": string, "period"?: string, "features": string[], "cta": string, "cta_href"?: string, "featured"?: boolean } ] }
- faq:          { "heading": string, "items": [ { "q": string, "a": string } ] }
- stats:        { "heading"?: string, "items": [ { "value": string, "label": string } ] }
- process:      { "heading": string, "steps": [ { "title": string, "description": string } ] }
- cta:          { "headline": string, "subheadline"?: string, "cta_primary": string, "cta_primary_href"?: string, "cta_secondary"?: string, "cta_secondary_href"?: string }
- logos:        { "heading"?: string, "items": [ { "name": string } ] }
- feature-split:{ "heading": string, "body": string, "bullets"?: string[], "image_prompt": string, "asset_url"?: string, "reverse"?: boolean }
- custom:       { "kind": "calculator"|"booking"|"quote"|"newsletter"|"map"|"embed",
                  "heading"?: string, "body"?: string,
                  "fields"?: [{"name":string,"label":string,"type":"number"|"text"|"email"|"date"|"select","options"?:string[],"unit"?:string}],
                  "formula"?: string,                 // for calculator: e.g. "hours * rate * 1.2"
                  "output_label"?: string, "output_unit"?: string }

Image prompts: for EVERY visual section (hero, about with image, feature-split, gallery items, service items when relevant) provide a SPECIFIC image_prompt — subject, mood, lighting, palette hint. Example: "aerial photo of a wooden pilates studio at golden hour, warm shadows, muted earth tones".
When the user supplies an exact image URL or uploaded image and asks to place/use it, copy that URL byte-for-byte into the target section/item's asset_url. asset_url always takes precedence over image_prompt; never claim an image was added unless asset_url is present in the updated manifest.

Rules:
- 3-6 pages total. First page slug MUST be "home" and MUST start with a hero.
- Every site should include hero + at least one of (about|services|feature-split) + a contact or cta section.
- Vary section variants across pages so the site doesn't feel templated.
- Copy must be specific to the described business — mention what it actually does, for whom, with real language.
- No lorem ipsum, no "Coming soon", no placeholder text.
- Palette must have readable contrast between bg and text (WCAG AA).
- Fonts must be real Google Fonts families.

MULTIPAGE NAVIGATION — every CTA is a real link, not decoration:
- Create dedicated pages for anything the brief mentions that deserves its own destination (booking, contact form, pricing, menu, gallery, portfolio, story, quote request, sign up, etc.). Common slugs: "home", "about", "services", "pricing", "gallery", "menu", "contact", "book", "quote", "faq".
- EVERY hero CTA and EVERY cta section CTA MUST set "cta_primary_href" (and "cta_secondary_href" when a second button exists). Every pricing tier CTA MUST set "cta_href".
- href values are one of:
  * a page slug from this manifest ("contact", "book", "pricing", "menu", "gallery", "about", "services", "quote", "faq") — the renderer switches pages and scrolls to top,
  * "#section-id" for in-page anchors,
  * full "https://...", "mailto:...", or "tel:..." for real external destinations the brief supplied.
- Match CTA copy to destination: "Book a table" -> "book" page (containing custom section kind:"booking"); "Get a quote" -> "quote" page (custom kind:"quote"); "Contact us" -> "contact" page; "See pricing" -> "pricing" page; "View menu" -> "menu" page; "Subscribe" -> custom kind:"newsletter".
- When a CTA promises an action (book/quote/subscribe/contact), the destination page MUST exist in "pages" AND MUST contain a section that actually performs it (contact form, custom booking/quote/newsletter, or pricing table). Never link to a dead page.
- If the brief supplies external URLs (Calendly, Stripe checkout, phone), copy them byte-for-byte into the corresponding href.`;

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

function titleFromPrompt(prompt: string) {
  const subject = prompt
    .replace(/^(please\s+)?(generate|build|create|make|design)\s+(me\s+)?(a|an|the)?\s*/i, "")
    .split(/[.!?\n]/)[0]
    .replace(/\b(website|site|landing page)\b/gi, "")
    .replace(/\b(with|that|which|make it|including)\b[\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!subject) return "New Venture";
  return subject
    .split(" ")
    .slice(0, 6)
    .map((word) => word ? word[0].toUpperCase() + word.slice(1) : word)
    .join(" ");
}

// A complete local compile keeps generation functional when the AI gateway is
// temporarily rate-limited or out of workspace credits. It is intentionally a
// real multi-page manifest (not a loading placeholder), so the saved website
// can always open in WebsitePreview and can be refined later through chat.
function fallbackManifest(prompt: string): Manifest {
  const name = titleFromPrompt(prompt);
  const lower = prompt.toLowerCase();
  const isFood = /food|bak|pastr|eclair|éclair|cake|cafe|coffee|restaurant|shop|candy|chocolate/.test(lower);
  const isCreative = /creative|design|studio|artist|portfolio|fashion|photo/.test(lower);
  const palette = isFood
    ? { bg: "#180D14", surface: "#2A1722", text: "#FFF7F2", accent: "#FFB547", accentSecondary: "#F05D8B", muted: "#D7BDC9", border: "#563246" }
    : isCreative
      ? { bg: "#0D1017", surface: "#171C28", text: "#F7F4ED", accent: "#55D6BE", accentSecondary: "#FF6B6B", muted: "#AFB7C8", border: "#343C4D" }
      : { bg: "#0A1118", surface: "#121E29", text: "#F4F8FB", accent: "#38D6C7", accentSecondary: "#FFCC66", muted: "#A9BBC7", border: "#2A4352" };
  const offering = isFood ? "small-batch favorites" : isCreative ? "distinctive work" : "thoughtful solutions";

  return {
    name,
    tagline: `${name} — made memorable through craft, clarity, and character.`,
    theme: {
      palette,
      font: { heading: "Bricolage Grotesque", body: "Manrope", display: "Bricolage Grotesque", mono: "Space Mono" },
      vibe: isFood ? "vivid artisanal indulgence" : isCreative ? "expressive editorial craft" : "confident modern precision",
      layout: "asymmetric",
      motion: "expressive",
      design_rationale: "A high-contrast editorial system pairs expressive typography with a category-specific palette and tactile motion.",
    },
    pages: [
      {
        slug: "home",
        title: "Home",
        seo_description: `${name} offers ${offering} with a distinctive, carefully considered experience.`.slice(0, 160),
        sections: [
          { type: "hero", variant: "split-image", content: { eyebrow: "Crafted with intent", headline: `Meet the ~remarkable~ side of ${name}.`, subheadline: `Discover ${offering} shaped around the people who expect more from every detail.`, cta_primary: "Explore our work", cta_secondary: "Start a conversation", image_prompt: `${name}, expressive editorial composition, tactile details, dramatic directional light`, media_style: "illustration", stats: [{ value: "100%", label: "Made with care" }, { value: "01", label: "Distinct point of view" }] } },
          { type: "stats", content: { heading: "Built around what matters", items: [{ value: "01", label: "Clear promise" }, { value: "03", label: "Ways to explore" }, { value: "24/7", label: "Digital access" }] } },
          { type: "feature-split", variant: "editorial", content: { heading: `A more ~considered~ experience.`, body: `Every part of ${name} is designed to feel coherent, useful, and unmistakably its own.`, bullets: ["A focused, memorable identity", "Details shaped around real needs", "Clear paths from interest to action"], image_prompt: `${name}, close-up material study, refined craftsmanship, category-specific objects`, media_style: isFood ? "photo" : "pattern", reverse: true } },
          { type: "services", variant: "numbered", content: { heading: `What makes us ~different~.`, items: [{ title: "Purposeful craft", description: "Every choice supports a clear outcome instead of adding noise." }, { title: "Personal attention", description: "A thoughtful experience that respects context, taste, and time." }, { title: "Lasting character", description: "Work designed to remain distinctive long after the first impression." }] } },
          { type: "cta", content: { headline: `Ready to find your ~new favorite~?`, subheadline: `Step inside ${name} and see what thoughtful craft can feel like.`, cta_primary: "Get started", cta_secondary: "Contact us" } },
        ],
      },
      {
        slug: "about",
        title: "Our Story",
        seo_description: `Learn about the ideas, standards, and people behind ${name}.`.slice(0, 160),
        sections: [
          { type: "hero", variant: "editorial-lede", content: { eyebrow: "Our story", headline: `Made for people who ~notice details~.`, subheadline: `${name} began with a simple belief: useful things can also carry soul.`, cta_primary: "See what we offer", image_prompt: `${name} origin story, authentic workspace, candid editorial light`, media_style: "illustration" } },
          { type: "about", content: { heading: `Standards you can ~feel~.`, body: `We bring discipline and imagination to every touchpoint, balancing expressive ideas with a calm, reliable experience.`, bullets: ["Care before speed", "Clarity before clutter", "Character without compromise"], pull_quote: "The smallest details shape the strongest memories." } },
          { type: "process", variant: "zigzag", content: { heading: `How the ~experience~ unfolds.`, steps: [{ title: "Discover", description: "Explore the collection and find the direction that feels right." }, { title: "Choose", description: "Compare clear options without friction or unnecessary complexity." }, { title: "Enjoy", description: "Move forward with confidence and support when you need it." }] } },
          { type: "cta", content: { headline: `See ${name} in ~action~.`, cta_primary: "Explore now", cta_secondary: "Ask a question" } },
        ],
      },
      {
        slug: "contact",
        title: "Contact",
        seo_description: `Contact ${name} to ask a question, request details, or begin your next step.`.slice(0, 160),
        sections: [
          { type: "hero", variant: "asymmetric-mark", content: { eyebrow: "Start here", headline: `Let’s make the next step ~simple~.`, subheadline: "Tell us what you need and we’ll point you in the right direction.", cta_primary: "Send a message", image_prompt: `${name}, welcoming abstract composition, open forms, warm directional light`, media_style: "gradient" } },
          { type: "contact", content: { heading: `We’d love to ~hear from you~.`, body: "Share a few details and we’ll respond with a clear next step.", email: "hello@example.com", form_fields: ["Name", "Email", "What can we help with?"] } },
          { type: "faq", content: { heading: `Good questions, ~clear answers~.`, items: [{ q: "How quickly will you reply?", a: "We aim to respond within one business day." }, { q: "Can I ask for something custom?", a: "Yes. Tell us what you have in mind and we’ll explain the best route." }, { q: "Where should I begin?", a: "Start with the message form and include the outcome you want." }] } },
        ],
      },
    ],
  };
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

const REFINE_DOC = `You are NazAI Website Refiner. The user is editing an EXISTING generated website via chat.

Your job in 5 steps:
1. READ the user's message AND the "--- Analyzed context ---" block carefully. Every attachment (uploaded file, image, URL, CSV/JSON data, integration snapshot, referenced project, tone selection) has already been analyzed for you. Treat every listed key fact, requirement, tone, and raw attached row as an EXECUTABLE instruction, not background trivia.
2. CLASSIFY intent as one of:
   - "theme": palette, fonts, vibe, motion, layout style (also triggered by tone selection or palette_hints)
   - "copy": headlines/subheads/body copy/CTA text on existing sections
   - "content": add/remove/reorder sections or pages, add items to lists, materialize attached data (CSV rows → pricing tiers/services/gallery/stats, integration rows → real cards/lists, referenced project facts → about/services copy)
   - "structural": rename site, change tagline, major restructure
   - "mixed": any combination
3. Produce an UPDATED full manifest. PRESERVE everything the user did NOT ask to change. Apply the minimum edits that satisfy intent + every analyzed requirement, then keep everything else byte-identical to the current manifest.
4. EXECUTE, do not merely describe:
   - Uploaded/linked image → put its exact URL byte-for-byte in the target section/item's asset_url.
   - Uploaded/attached data (CSV, JSON, exports) → turn actual rows into visible content (pricing tiers, service items, gallery captions, stats numbers, FAQ pairs, testimonial quotes — whichever section type matches the data shape).
   - Integration snapshot data → surface concrete values (real product names, real event titles, real metrics) into the appropriate section instead of placeholder copy.
   - Referenced project (agent/site) → mirror the concrete facts (name, role, goal, tagline) into the requested section.
   - Tone selection → rewrite the copy of any section you touch to match that tone; if user asked for a tone shift only, apply it across all copy.
   - Palette/layout hints from analysis → apply them to theme when relevant.
   - Requested navigation/redirect ("Book Now button should open a booking form", "add a Contact page and link the hero CTA to it", "Learn More should go to /services") → create the destination page if missing, ensure it contains the interactive section (booking/quote/newsletter/contact/pricing), and set the correct "cta_primary_href"/"cta_secondary_href"/"cta_href" on the source button. If the user supplies an external URL (Calendly, Stripe, mailto:, tel:), copy it verbatim into the href.
5. SELF-CHECK the final manifest against the request AND every listed key fact / requirement / exact asset. The summary must name only changes that are visibly present in the returned manifest. Never say an edit was applied if the relevant field/content is absent.

Return STRICT JSON only:
{
  "intent": "theme"|"copy"|"content"|"structural"|"mixed",
  "summary": string,
  "manifest": { ...full manifest, same shape as compile }
}`;


serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) return json({ error: "Missing LOVABLE_API_KEY" }, 500);

    const body = await req.json().catch(() => ({}));
    const { prompt, save = true, previousWebsiteId, refine = false, recentTurns = [] } = body || {};
    if (!prompt || typeof prompt !== "string") return json({ error: "prompt required" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;

    // ============ REFINE PATH ============
    if (refine && previousWebsiteId && user) {
      const { data: existing } = await supabase.from("websites").select("*").eq("id", previousWebsiteId).eq("user_id", user.id).maybeSingle();
      if (!existing) return json({ error: "Website not found" }, 404);
      const { data: existingPages } = await supabase.from("website_pages").select("*").eq("website_id", previousWebsiteId).order("order_index", { ascending: true });

      const currentManifest = {
        name: existing.name,
        tagline: existing.tagline,
        theme: existing.theme,
        pages: (existingPages || []).map((p: any) => ({
          slug: p.slug, title: p.title, seo_description: p.seo_description, sections: p.sections || [],
        })),
      };
      const conversation = Array.isArray(recentTurns)
        ? recentTurns.slice(-6).map((turn: any) => {
          const role = turn?.role === "assistant" ? "NazAI" : "User";
          const content = typeof turn?.content === "string" ? turn.content.slice(0, 2000) : "";
          return `${role}: ${content}`;
        }).filter(Boolean).join("\n")
        : "";

      let refined: { intent?: string; summary?: string; manifest?: unknown } = {};
      try {
        const resp = await fetch(LOVABLE_URL, {
          method: "POST",
          headers: { "Lovable-API-Key": key, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: MODEL,
            messages: [
              { role: "system", content: `${REFINE_DOC}\n\n${SCHEMA_DOC}` },
              { role: "user", content: `CURRENT MANIFEST (do not regenerate untouched parts):\n${JSON.stringify(currentManifest)}\n\n${conversation ? `RECENT CONVERSATION (use only to resolve references and continuity):\n${conversation}\n\n` : ""}USER REQUEST + ANALYZED INTENT:\n${prompt}\n\nFirst infer the user's real expectation, then execute it as a coordinated design change: visual signature, palette, typography, copy, hierarchy, imagery, and micro-interactions must still feel like one deliberate system. Preserve every detail not requested or required for coherence. Return the JSON envelope { intent, summary, manifest }.` },
            ],
            temperature: 0.4,
          }),
        });
        if (resp.status === 429) throw new Error("gateway rate limited");
        if (resp.status === 402) throw new Error("gateway credits unavailable");
        if (!resp.ok) throw new Error(`gateway ${resp.status}`);
        const data = await resp.json();
        const raw = data?.choices?.[0]?.message?.content ?? "{}";
        refined = JSON.parse(stripFences(typeof raw === "string" ? raw : JSON.stringify(raw)));
      } catch (err) {
        console.error("refine AI failure", err);
        return json({ error: "Could not understand that request. Try rephrasing more specifically." }, 500);
      }

      const nextManifest = normalize(refined.manifest ?? currentManifest, existing.prompt || prompt);

      // A linked/uploaded asset is an executable instruction, not prose. If the
      // model omitted the exact URL, fail visibly instead of claiming success.
      const requestedAssetUrls = Array.from(prompt.matchAll(/https?:\/\/[^\s)\]}>"']+/g))
        .map((match) => match[0])
        .filter((url) => /(?:\/storage\/v1\/object\/public\/|\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$))/i.test(url));
      if (requestedAssetUrls.length) {
        const serializedManifest = JSON.stringify(nextManifest);
        const missingAssets = requestedAssetUrls.filter((url) => !serializedManifest.includes(url));
        if (missingAssets.length) {
          return json({ error: "The requested image could not be placed in the website. Please attach it again or provide a direct image URL." }, 422);
        }
      }

      const pageRows = nextManifest.pages.map((p, i) => ({
        website_id: previousWebsiteId,
        slug: p.slug, title: p.title,
        seo_description: p.seo_description ?? null,
        sections: p.sections, order_index: i,
      }));
      // Upsert first so a failed refinement can never delete the currently
      // visible website. Only stale pages are removed after replacements exist.
      const { data: pagesOut, error: pagesErr } = await supabase
        .from("website_pages")
        .upsert(pageRows, { onConflict: "website_id,slug" })
        .select("id, slug, title, order_index");
      if (pagesErr) return json({ error: pagesErr.message }, 500);

      const nextSlugs = new Set(nextManifest.pages.map((p) => p.slug));
      const stalePageIds = (existingPages || []).filter((p: any) => !nextSlugs.has(p.slug)).map((p: any) => p.id);
      if (stalePageIds.length) {
        const { error: cleanupErr } = await supabase.from("website_pages").delete().in("id", stalePageIds);
        if (cleanupErr) console.warn("stale website page cleanup failed", cleanupErr);
      }

      const { error: uErr } = await supabase
        .from("websites")
        .update({
          name: nextManifest.name,
          title: nextManifest.name,
          tagline: nextManifest.tagline,
          theme: nextManifest.theme,
        })
        .eq("id", previousWebsiteId)
        .eq("user_id", user.id);
      if (uErr) return json({ error: uErr.message }, 500);

      return json({
        manifest: nextManifest,
        website_id: previousWebsiteId,
        pages: nextManifest.pages,
        intent: refined.intent || "mixed",
        summary: refined.summary || "Applied your changes.",
        refined: true,
      });
    }

    // ============ FRESH COMPILE PATH ============
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
      manifest = fallbackManifest(prompt);
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
      // Avoid leaving a saved project that can only render as an empty preview.
      await supabase.from("websites").delete().eq("id", siteRow.id).eq("user_id", user.id);
      return json({ manifest, website_id: siteRow.id, error: pagesErr.message }, 500);
    }

    return json({ manifest, website_id: siteRow.id, pages: pagesOut });
  } catch (e) {
    console.error("compile-website-manifest error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
