// Compile a website prompt into a structured manifest and persist to websites + website_pages.
// Input: { prompt: string, save?: boolean }
// Output: { manifest, website_id?, pages? }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pickAiGateway, callAiGateway } from "../_shared/ai-gateway.ts";
import { consumeGenerationCredit, NO_CREDITS_MESSAGE } from "../_shared/credits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "is", "it",
  "this", "that", "please", "can", "you", "i", "want", "would", "like", "my",
  "me", "with", "be", "make", "add", "change", "update", "edit", "again",
]);

// Loop detection — a user re-sending essentially the SAME edit request a
// couple of turns later is the strongest available signal that the
// previous attempt silently didn't take effect (the refine call reported
// "Applied your changes" but nothing visibly changed, or changed the wrong
// thing). Cheap word-overlap similarity, not embeddings -- good enough to
// catch "make the hero bigger" / "make the hero text bigger please" as the
// same ask without a second model call.
function wordsOf(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  return intersection / (a.size + b.size - intersection);
}
function detectRepeatedRequest(prompt: string, recentTurns: unknown[]): boolean {
  const promptWords = wordsOf(prompt);
  if (promptWords.size < 2) return false;
  const recentUserTurns = (Array.isArray(recentTurns) ? recentTurns : [])
    .filter((t: any) => t?.role === "user" && typeof t?.content === "string")
    .slice(-4, -1); // exclude the current turn itself, look at the ones just before it
  return recentUserTurns.some((t: any) => jaccardSimilarity(promptWords, wordsOf(String(t.content))) >= 0.6);
}

// Did the refine call actually change anything? A model call that returns
// the manifest byte-identical to what went in (a real, observed failure
// mode: it "agrees" with the request but doesn't act on it) must never be
// reported to the user as a successful edit -- that's exactly the "says
// applied, nothing visibly changed, user asks again" loop.
function manifestsEquivalent(a: Manifest, b: Manifest): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

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

G. MOTION — the renderer provides scroll reveal, card 3D tilt, magnetic buttons, and section background shifts by default. Choose motion level:
- "subtle" for professional/luxury/finance/editorial.
- "expressive" for consumer, creative, fashion, agency.
- "kinetic" only if the brand is explicitly playful, gaming, or hype.
- "none" only if requested.

H. CONTENT — specific, scannable, opinionated
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
                  "output_label"?: string, "output_unit"?: string,
                  "address"?: string,                 // for map: a real, specific address/place to embed
                  "embed_url"?: string }              // for embed: a real embeddable URL (YouTube/Vimeo watch link, Calendly, Typeform, Google Calendar/Sheets "publish to web" link, etc.) — never a bare homepage URL

Image prompts: for EVERY visual section (hero, about with image, feature-split, gallery items, service items when relevant) provide a SPECIFIC image_prompt — subject, mood, lighting, palette hint. Example: "aerial photo of a wooden pilates studio at golden hour, warm shadows, muted earth tones".
When the user supplies an exact image URL or uploaded image and asks to place/use it, copy that URL byte-for-byte into the target section/item's asset_url. asset_url always takes precedence over image_prompt; never claim an image was added unless asset_url is present in the updated manifest.

Rules:
- 3-6 pages total. First page slug MUST be "home" and MUST start with a hero.
- FIRST-ATTEMPT COMPLETENESS: this is very likely the ONLY generation the user will see before judging the product — do not ship a thin starting point that assumes they'll fill in the gaps by chatting further. The "home" page alone must include, at minimum: hero, about OR feature-split, services (with at least 3 real items), and one more of (testimonials|gallery|stats|faq|process) chosen to fit the business. In addition, there MUST be a dedicated "contact" page containing a real "contact" section with concrete "form_fields" (e.g. ["name","email","message"]) — a "cta" teaser section alone never satisfies this; a customer must have an actual working form to fill in on the first attempt, not a button that only leads to a promise of one. Every button/CTA anywhere in the manifest (hero, cta section, pricing tier) is genuinely pressable: it MUST have a resolvable href per MULTIPAGE NAVIGATION below — never an empty/omitted href "for later".
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
          { type: "hero", variant: "split-image", content: { eyebrow: "Crafted with intent", headline: `Meet the ~remarkable~ side of ${name}.`, subheadline: `Discover ${offering} shaped around the people who expect more from every detail.`, cta_primary: "Explore our work", cta_primary_href: "services", cta_secondary: "Start a conversation", cta_secondary_href: "contact", image_prompt: `${name}, expressive editorial composition, tactile details, dramatic directional light`, media_style: "illustration", stats: [{ value: "100%", label: "Made with care" }, { value: "01", label: "Distinct point of view" }] } },
          { type: "stats", content: { heading: "Built around what matters", items: [{ value: "01", label: "Clear promise" }, { value: "03", label: "Ways to explore" }, { value: "24/7", label: "Digital access" }] } },
          { type: "feature-split", variant: "editorial", content: { heading: `A more ~considered~ experience.`, body: `Every part of ${name} is designed to feel coherent, useful, and unmistakably its own.`, bullets: ["A focused, memorable identity", "Details shaped around real needs", "Clear paths from interest to action"], image_prompt: `${name}, close-up material study, refined craftsmanship, category-specific objects`, media_style: isFood ? "photo" : "pattern", reverse: true } },
          { type: "services", variant: "numbered", content: { heading: `What makes us ~different~.`, items: [{ title: "Purposeful craft", description: "Every choice supports a clear outcome instead of adding noise." }, { title: "Personal attention", description: "A thoughtful experience that respects context, taste, and time." }, { title: "Lasting character", description: "Work designed to remain distinctive long after the first impression." }] } },
          { type: "cta", content: { headline: `Ready to find your ~new favorite~?`, subheadline: `Step inside ${name} and see what thoughtful craft can feel like.`, cta_primary: "Get started", cta_primary_href: "contact", cta_secondary: "Contact us", cta_secondary_href: "contact" } },
        ],
      },
      {
        slug: "about",
        title: "Our Story",
        seo_description: `Learn about the ideas, standards, and people behind ${name}.`.slice(0, 160),
        sections: [
          { type: "hero", variant: "editorial-lede", content: { eyebrow: "Our story", headline: `Made for people who ~notice details~.`, subheadline: `${name} began with a simple belief: useful things can also carry soul.`, cta_primary: "See what we offer", cta_primary_href: "services", image_prompt: `${name} origin story, authentic workspace, candid editorial light`, media_style: "illustration" } },
          { type: "about", content: { heading: `Standards you can ~feel~.`, body: `We bring discipline and imagination to every touchpoint, balancing expressive ideas with a calm, reliable experience.`, bullets: ["Care before speed", "Clarity before clutter", "Character without compromise"], pull_quote: "The smallest details shape the strongest memories." } },
          { type: "process", variant: "zigzag", content: { heading: `How the ~experience~ unfolds.`, steps: [{ title: "Discover", description: "Explore the collection and find the direction that feels right." }, { title: "Choose", description: "Compare clear options without friction or unnecessary complexity." }, { title: "Enjoy", description: "Move forward with confidence and support when you need it." }] } },
          { type: "cta", content: { headline: `See ${name} in ~action~.`, cta_primary: "Explore now", cta_primary_href: "home", cta_secondary: "Ask a question", cta_secondary_href: "contact" } },
        ],
      },
      {
        slug: "contact",
        title: "Contact",
        seo_description: `Contact ${name} to ask a question, request details, or begin your next step.`.slice(0, 160),
        sections: [
          { type: "hero", variant: "asymmetric-mark", content: { eyebrow: "Start here", headline: `Let’s make the next step ~simple~.`, subheadline: "Tell us what you need and we’ll point you in the right direction.", cta_primary: "Send a message", cta_primary_href: "#contact-form", image_prompt: `${name}, welcoming abstract composition, open forms, warm directional light`, media_style: "gradient" } },
          { type: "contact", content: { heading: `We’d love to ~hear from you~.`, body: "Share a few details and we’ll respond with a clear next step.", email: "hello@example.com", form_fields: ["Name", "Email", "What can we help with?"] } },
          { type: "faq", content: { heading: `Good questions, ~clear answers~.`, items: [{ q: "How quickly will you reply?", a: "We aim to respond within one business day." }, { q: "Can I ask for something custom?", a: "Yes. Tell us what you have in mind and we’ll explain the best route." }, { q: "Where should I begin?", a: "Start with the message form and include the outcome you want." }] } },
        ],
      },
    ],
  };
}

// A footer link to a Privacy Policy / Terms page is table-stakes on a real
// business site, but leaving it to the model meant it only showed up when a
// user thought to ask via chat. Auto-inject both on every normalize() pass
// (fresh compiles AND refine edits) so the very first generation already has
// them -- recognizing existing slugs first so a model-authored legal page
// is never duplicated.
const PRIVACY_SLUG_ALIASES = new Set(["privacy-policy", "privacy", "privacy-notice"]);
const TERMS_SLUG_ALIASES = new Set(["terms", "terms-of-service", "terms-conditions", "terms-and-conditions", "tos"]);

function legalPage(kind: "privacy" | "terms", name: string): Page {
  const year = new Date().getFullYear();
  if (kind === "privacy") {
    return {
      slug: "privacy-policy",
      title: "Privacy Policy",
      seo_description: `How ${name} collects, uses, and protects your information.`.slice(0, 160),
      sections: [{
        type: "about",
        variant: "editorial",
        content: {
          heading: "Privacy Policy",
          body: `Last updated ${year}. This page explains what information ${name} collects when you use this site, how it's used, and the choices available to you.`,
          bullets: [
            `Information we collect: contact details you submit through forms on this site (such as name, email, and message), plus standard technical data like browser type and pages visited.`,
            `How we use it: to respond to inquiries, provide the services you request, and improve this site's content and performance.`,
            `Cookies & analytics: this site may use cookies or similar technology to understand how visitors use it. You can control cookies through your browser settings.`,
            `Sharing: we do not sell your personal information. We only share it with service providers who help us operate this site, under confidentiality obligations.`,
            `Your rights: you may request access to, correction of, or deletion of your information at any time via the contact page.`,
          ],
        },
      }],
    };
  }
  return {
    slug: "terms",
    title: "Terms of Service",
    seo_description: `The terms and conditions for using ${name}'s website and services.`.slice(0, 160),
    sections: [{
      type: "about",
      variant: "editorial",
      content: {
        heading: "Terms of Service",
        body: `Last updated ${year}. By using this site, you agree to the following terms with ${name}.`,
        bullets: [
          `Use of this site: content is provided for general informational purposes and may be updated at any time without notice.`,
          `Submissions: any information you submit through this site must be accurate, and you're responsible for keeping any account credentials secure.`,
          `Intellectual property: the content, branding, and design of this site belong to ${name} and may not be copied or reused without permission.`,
          `Limitation of liability: ${name} is not liable for indirect or incidental damages arising from use of this site, to the fullest extent permitted by law.`,
          `Changes: these terms may be updated periodically; continued use of the site after changes means you accept the updated terms.`,
        ],
      },
    }],
  };
}

function ensureLegalPages(pages: Page[], name: string): void {
  if (!pages.some((p) => PRIVACY_SLUG_ALIASES.has(p.slug.toLowerCase()))) pages.push(legalPage("privacy", name));
  if (!pages.some((p) => TERMS_SLUG_ALIASES.has(p.slug.toLowerCase()))) pages.push(legalPage("terms", name));
}

function normalize(raw: unknown, prompt: string): Manifest {
  const r = (raw ?? {}) as Record<string, unknown>;
  const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : "Untitled Site";
  const tagline = typeof r.tagline === "string" && r.tagline.trim() ? r.tagline.trim() : prompt.slice(0, 80);
  const themeRaw = (r.theme ?? {}) as Record<string, unknown>;
  const paletteRaw = (themeRaw.palette ?? {}) as Record<string, string>;
  const fontRaw = (themeRaw.font ?? {}) as Record<string, string>;
  const theme: Theme = {
    // These defaults only kick in when the model's output is partial (a
    // real failure mode, especially without a hard JSON-mode guarantee) --
    // they used to reproduce the EXACT "generic AI design" clichés
    // SCHEMA_DOC's own CORE DIRECTIVE tells the model to avoid: a blue
    // (#00A3FF) -> purple (#7C3AED) pair reads as the flagged "purple ->
    // pink gradients" cliché, and Inter for both heading and body is
    // flagged verbatim. A malformed response should degrade toward
    // "plain but on-brand," not toward the one look this whole prompt is
    // engineered to prevent.
    palette: {
      bg: paletteRaw.bg || "#0B0B0F",
      surface: paletteRaw.surface || "#151520",
      text: paletteRaw.text || "#F4F4F5",
      accent: paletteRaw.accent || "#E8834A",
      accentSecondary: paletteRaw.accentSecondary || "#1B7A72",
      muted: paletteRaw.muted,
      border: paletteRaw.border,
    },
    font: {
      heading: fontRaw.heading || "Sora",
      body: fontRaw.body || "Inter",
      mono: fontRaw.mono,
      display: fontRaw.display,
    },
    vibe: typeof themeRaw.vibe === "string" ? themeRaw.vibe : "modern, clean, confident",
    layout: typeof themeRaw.layout === "string" ? themeRaw.layout : "asymmetric",
    motion: typeof themeRaw.motion === "string" ? themeRaw.motion : "subtle",
    design_rationale: typeof themeRaw.design_rationale === "string" ? themeRaw.design_rationale : undefined,
  };
  const pagesIn = Array.isArray(r.pages) ? r.pages : [];
  // Slugs must be unique -- they're the page's route, its nav link, and its
  // React key/tab identity downstream (GeneratedDashboard's preview tabs).
  // The AI can return two pages that slugify to the same value (e.g. "About"
  // and "about-us" both -> "about", or a flat-out duplicate slug field);
  // without dedup, the second page silently overwrites the first's route and
  // the site ends up with an unreachable page and a broken nav link.
  const usedSlugs = new Set<string>(["home"]);
  const dedupeSlug = (candidate: string, fallbackIdx: number): string => {
    const base = candidate || `page-${fallbackIdx + 1}`;
    if (!usedSlugs.has(base)) {
      usedSlugs.add(base);
      return base;
    }
    let n = 2;
    while (usedSlugs.has(`${base}-${n}`)) n++;
    const unique = `${base}-${n}`;
    usedSlugs.add(unique);
    return unique;
  };
  const pagesBuilt: Page[] = pagesIn.slice(0, 6).map((p, idx) => {
    const pp = (p ?? {}) as Record<string, unknown>;
    const sectionsIn = Array.isArray(pp.sections) ? pp.sections : [];
    const sections: Section[] = sectionsIn
      .map((s) => {
        const ss = (s ?? {}) as Record<string, unknown>;
        const t = String(ss.type ?? "").toLowerCase();
        if (!SECTION_TYPES.includes(t as SectionType)) return null;
        const content = (ss.content as Record<string, unknown>) ?? {};
        // The AI occasionally emits a section with a valid type but empty
        // content (seen live: "custom"/"gallery" sections shipped as
        // content: {}) -- no section type renders anything meaningful with
        // zero fields, so a blank block reached the live site instead of
        // just not existing. Drop it rather than ship a guaranteed-empty section.
        if (Object.keys(content).length === 0) return null;
        return {
          type: t as SectionType,
          variant: typeof ss.variant === "string" ? ss.variant : undefined,
          content,
        };
      })
      .filter((x): x is Section => !!x);
    const title = typeof pp.title === "string" && pp.title.trim() ? pp.title.trim() : (idx === 0 ? name : `Page ${idx + 1}`);
    const slug = idx === 0 ? "home" : dedupeSlug(slugify(String(pp.slug ?? title)), idx);
    return {
      slug,
      title,
      seo_description: typeof pp.seo_description === "string" ? pp.seo_description.slice(0, 200) : `${name} — ${tagline}`.slice(0, 160),
      sections,
    };
  });

  // A non-home page that lost every section to the empty-content filter above
  // would otherwise ship as a real nav destination with nothing on it -- a
  // dead page is worse than no page, so drop it rather than link to a blank
  // one. Home (idx 0) always gets a hero backfilled below regardless.
  const pages: Page[] = pagesBuilt.filter((p, idx) => idx === 0 || p.sections.length > 0);

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

  ensureLegalPages(pages, name);

  return { name, tagline, theme, pages };
}

const REFINE_DOC = `You are NazAI Website Refiner. The user is editing an EXISTING generated website via chat.

Your job in 6 steps — READ, IDENTIFY, CLASSIFY, PLAN, EXECUTE, VERIFY. Do not skip straight from reading to writing a manifest; the intermediate identifiedEdits list is a required output, not internal scratch work.

1. READ the user's message AND the "--- Analyzed context ---" block carefully. Every attachment (uploaded file, image, URL, CSV/JSON data, integration snapshot, referenced project, tone selection) has already been analyzed for you. Treat every listed key fact, requirement, tone, and raw attached row as an EXECUTABLE instruction, not background trivia.
2. IDENTIFY the concrete, atomic edits being asked for as a short list (1-6 items). Each item must name the specific page/section/field it targets, e.g. "Pricing page — change the 'Pro' tier price to $49/mo", "Home page — add a testimonials section", "Hero — replace headline with the new tagline". This list is returned verbatim as "identifiedEdits" — write it BEFORE deciding how to implement it, so every edit below traces back to one of these items.
3. CLASSIFY intent as one of:
   - "theme": palette, fonts, vibe, motion, layout style (also triggered by tone selection or palette_hints)
   - "copy": headlines/subheads/body copy/CTA text on existing sections
   - "content": add/remove/reorder sections or pages, add items to lists, materialize attached data (CSV rows → pricing tiers/services/gallery/stats, integration rows → real cards/lists, referenced project facts → about/services copy)
   - "structural": rename site, change tagline, major restructure
   - "mixed": any combination
4. PLAN + STRUCTURE an UPDATED full manifest that implements every item in identifiedEdits. PRESERVE everything the user did NOT ask to change. Apply the minimum edits that satisfy intent + every analyzed requirement, then keep everything else byte-identical to the current manifest.
5. EXECUTE, do not merely describe:
   - Uploaded/linked image → put its exact URL byte-for-byte in the target section/item's asset_url.
   - Uploaded/attached data (CSV, JSON, exports) → turn actual rows into visible content (pricing tiers, service items, gallery captions, stats numbers, FAQ pairs, testimonial quotes — whichever section type matches the data shape).
   - Integration snapshot data → surface concrete values (real product names, real event titles, real metrics) into the appropriate section instead of placeholder copy.
   - Referenced project (agent/site) → mirror the concrete facts (name, role, goal, tagline) into the requested section.
   - Tone selection → rewrite the copy of any section you touch to match that tone; if user asked for a tone shift only, apply it across all copy.
   - Palette/layout hints from analysis → apply them to theme when relevant.
   - Requested navigation/redirect ("Book Now button should open a booking form", "add a Contact page and link the hero CTA to it", "Learn More should go to /services") → create the destination page if missing, ensure it contains the interactive section (booking/quote/newsletter/contact/pricing), and set the correct "cta_primary_href"/"cta_secondary_href"/"cta_href" on the source button. If the user supplies an external URL (Calendly, Stripe, mailto:, tel:), copy it verbatim into the href.
6. VERIFY — walk identifiedEdits one by one against the manifest you are about to return. Every single item MUST be concretely visible in it; if one isn't, go back and apply it before responding — never ship a manifest that leaves an identified edit undone. Also self-check against every listed key fact / requirement / exact asset from analysis. The summary must name only changes that are visibly present in the returned manifest. Never say an edit was applied if the relevant field/content is absent.

Return STRICT JSON only:
{
  "intent": "theme"|"copy"|"content"|"structural"|"mixed",
  "identifiedEdits": string[],   // 1-6 short items from step 2 — exactly what you identified, each naming the page/section/field it targets
  "summary": string,
  "manifest": { ...full manifest, same shape as compile }
}`;


// Route a chat follow-up on an existing website into one of three actions.
// "edit"    → surgical refinement of the current manifest (default, safest)
// "rebuild" → regenerate this same website from scratch, replacing its pages
// "new"     → compile a separate, additional website and open it
async function routeWebsiteChatIntent(
  gw: NonNullable<ReturnType<typeof pickAiGateway>>,
  prompt: string,
  siteName: string,
): Promise<{ route: "edit" | "rebuild" | "new"; brief: string; reason: string }> {
  const fallback = { route: "edit" as const, brief: prompt, reason: "defaulted to an edit" };
  try {
    const resp = await callAiGateway({
      model: gw.model,
      messages: [
        {
          role: "system",
          content: `You classify what a user wants when they message the chat agent attached to an existing generated website called "${siteName}".

Return STRICT JSON: { "route": "edit" | "rebuild" | "new", "brief": string, "reason": string }

Rules:
- "edit" (DEFAULT): any change, addition, removal, restyle, copy tweak, new page/section on the CURRENT site. Use this whenever in doubt.
- "rebuild": the user wants THIS SAME site regenerated from scratch / a totally different design for it ("start over", "redo it completely", "regenerate this site", "scrap it and make it again", "completely different design").
- "new": the user wants an ADDITIONAL, separate website for a different business/topic ("make me another website for a gym", "create a new site for my bakery", "build a second site").
- "brief": for "rebuild"/"new", a complete standalone website brief (subject, audience, style, pages, features) built from the user's message; for "edit", echo the user's message unchanged.
- "reason": one short sentence.`,
        },
        { role: "user", content: prompt },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    }, gw);
    if (!resp.ok) return fallback;
    const data = await resp.json();
    const parsed = JSON.parse(stripFences(String(data?.choices?.[0]?.message?.content ?? "{}")));
    const route = parsed?.route === "rebuild" || parsed?.route === "new" ? parsed.route : "edit";
    const brief = typeof parsed?.brief === "string" && parsed.brief.trim().length > 12 ? parsed.brief.trim() : prompt;
    return { route, brief: route === "edit" ? prompt : brief, reason: String(parsed?.reason || "") };
  } catch (err) {
    console.error("website intent routing failed", err);
    return fallback;
  }
}

// Snapshot the CURRENT (pre-change) website + pages before an edit or rebuild
// overwrites them, so a regeneration the user doesn't like can be undone.
// Best-effort: a failure here must never block the actual save.
async function snapshotWebsiteVersion(
  supabase: ReturnType<typeof createClient>,
  websiteId: string,
  userId: string,
  label: string,
  websiteRow: Record<string, unknown>,
  pageRows: Record<string, unknown>[],
) {
  try {
    await supabase.from("website_versions").insert({
      website_id: websiteId,
      user_id: userId,
      label,
      website_snapshot: websiteRow,
      pages_snapshot: pageRows,
    });
  } catch (err) {
    console.warn("website version snapshot failed (non-fatal)", err);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const gw = pickAiGateway();
    if (!gw) return json({ error: "Missing OPENAI_API_KEY (or LOVABLE_API_KEY)" }, 500);

    const body = await req.json().catch(() => ({}));
    const { prompt, save = true, previousWebsiteId, refine = false, recentTurns = [], attachments = [] } = body || {};
    const visualAttachments = Array.isArray(attachments)
      ? attachments.filter((a: any) => a && a.kind === "image" && (a.assetUrl || a.url)).slice(0, 6)
      : [];
    if (!prompt || typeof prompt !== "string") return json({ error: "prompt required" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;

    // A chat edit on an existing website REQUIRES a resolved user -- without
    // one, refine/previousWebsiteId used to fall straight through both refine
    // blocks below into the fresh-compile path, which has no idea an edit was
    // intended: it silently compiled the user's request as a brand-new
    // website, inserted a disconnected row nothing pointed at, and returned a
    // normal-looking success response. The frontend re-reads the ORIGINAL
    // website by its unchanged id, sees nothing changed, but still shows
    // "✓ Updated" -- the user's suggestion silently never applied, no error
    // surfaced. Fail loudly instead so the chat shows a real, actionable error.
    if (refine && previousWebsiteId && !user) {
      return json({ error: "Your session expired. Please refresh the page and try again." }, 401);
    }

    // Follow-up chat on an existing website: decide edit vs rebuild vs new site.
    let compilePrompt = prompt;
    let rebuildWebsiteId: string | null = null;
    let routeInfo: { route: "edit" | "rebuild" | "new"; reason: string } = { route: "edit", reason: "" };

    // ============ REFINE PATH ============
    if (refine && previousWebsiteId && user) {
      const { data: existing } = await supabase.from("websites").select("*").eq("id", previousWebsiteId).eq("user_id", user.id).maybeSingle();
      if (!existing) return json({ error: "Website not found" }, 404);
      const { data: existingPages } = await supabase.from("website_pages").select("*").eq("website_id", previousWebsiteId).order("order_index", { ascending: true });

      const routed = await routeWebsiteChatIntent(gw, prompt, String(existing.name || "this website"));
      routeInfo = { route: routed.route, reason: routed.reason };
      if (routed.route !== "edit") {
        compilePrompt = routed.brief;
        rebuildWebsiteId = routed.route === "rebuild" ? String(previousWebsiteId) : null;
      }
    }

    if (refine && previousWebsiteId && user && routeInfo.route === "edit") {
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

      // Loop detection: the user re-asking for essentially the same thing a
      // couple of turns later means the previous attempt didn't visibly
      // land. Tell the model explicitly rather than silently repeating
      // whatever weak transformation produced that non-result.
      const isRepeatedRequest = detectRepeatedRequest(prompt, recentTurns);
      const loopClause = isRepeatedRequest
        ? "\n\nIMPORTANT: This looks like a REPEATED request — a similar message appeared a turn or two ago, which means the previous attempt did not produce a visible change. Do not repeat the same shallow edit. Re-read the CURRENT MANIFEST field-by-field, locate the EXACT page/section/field the request refers to, and make sure every item in identifiedEdits is CONCRETELY different in your returned manifest at that exact location — not just semantically equivalent. If you genuinely cannot identify which section the request refers to, set \"intent\" to \"mixed\", leave identifiedEdits naming the section names you considered, and use \"summary\" to ask which one, rather than guessing again."
        : "";

      let refined: { intent?: string; identifiedEdits?: unknown; summary?: string; manifest?: unknown } = {};
      try {
        const resp = await callAiGateway({
          model: gw.deepModel,
          messages: [
            { role: "system", content: `${REFINE_DOC}\n\n${SCHEMA_DOC}` },
            {
              role: "user",
              content: visualAttachments.length
                ? [
                    { type: "text", text: `CURRENT MANIFEST (do not regenerate untouched parts):\n${JSON.stringify(currentManifest)}\n\n${conversation ? `RECENT CONVERSATION (use only to resolve references and continuity):\n${conversation}\n\n` : ""}USER REQUEST + ANALYZED INTENT:\n${prompt}\n\nAttached images are shown below — copy their exact URLs byte-for-byte into the target section/item's asset_url so they render in the site. First infer the user's real expectation, then execute it as a coordinated design change: visual signature, palette, typography, copy, hierarchy, imagery, and micro-interactions must still feel like one deliberate system. Preserve every detail not requested or required for coherence. Return the JSON envelope { intent, identifiedEdits, summary, manifest }.${loopClause}` },
                    ...visualAttachments.map((a: any) => ({ type: "image_url", image_url: { url: a.assetUrl || a.url } })),
                  ]
                : `CURRENT MANIFEST (do not regenerate untouched parts):\n${JSON.stringify(currentManifest)}\n\n${conversation ? `RECENT CONVERSATION (use only to resolve references and continuity):\n${conversation}\n\n` : ""}USER REQUEST + ANALYZED INTENT:\n${prompt}\n\nFirst infer the user's real expectation, then execute it as a coordinated design change: visual signature, palette, typography, copy, hierarchy, imagery, and micro-interactions must still feel like one deliberate system. Preserve every detail not requested or required for coherence. Return the JSON envelope { intent, identifiedEdits, summary, manifest }.${loopClause}`,
            },
          ],
          temperature: isRepeatedRequest ? 0.2 : 0.4,
          response_format: { type: "json_object" },
        }, gw);
        if (resp.status === 429) throw new Error("gateway rate limited");
        if (resp.status === 402) throw new Error("gateway credits unavailable");
        if (!resp.ok) throw new Error(`gateway ${resp.status}`);
        const data = await resp.json();
        const raw = data?.choices?.[0]?.message?.content ?? "{}";
        refined = JSON.parse(stripFences(typeof raw === "string" ? raw : JSON.stringify(raw)));
      } catch (err) {
        console.error("refine AI failure", err);
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("credits unavailable")) {
          return json({ error: "AI credits exhausted for this workspace. Add credits in Settings → Plans & credits to keep refining." }, 402);
        }
        if (msg.includes("rate limited")) {
          return json({ error: "AI is rate-limited right now. Try again in a moment." }, 429);
        }
        return json({ error: "Could not understand that request. Try rephrasing more specifically." }, 500);
      }

      // The model's own JSON output isn't validated for having a usable
      // `manifest` before this point. Two real failure modes if it's not:
      // - `manifest` omitted entirely -> normalize(currentManifest) rebuilds
      //   the untouched site, but the response still claims success ("✓
      //   Applied your changes") even though nothing changed.
      // - `manifest` present but degenerate (e.g. `{}`) -> normalize()
      //   doesn't detect that as "no manifest"; it manufactures a brand-new
      //   minimal site ("Untitled Site", one default hero page) and that
      //   gets written straight over the user's real content.
      // A real website always has at least one page, so require that as the
      // minimum signal the model actually returned something usable, and
      // fail loudly instead of silently no-op'ing or overwriting.
      const refinedManifestRaw = refined.manifest as Record<string, unknown> | undefined;
      if (!refinedManifestRaw || typeof refinedManifestRaw !== "object" || !Array.isArray(refinedManifestRaw.pages) || refinedManifestRaw.pages.length === 0) {
        console.error("refine AI returned no usable manifest", { intent: refined.intent, hasManifest: !!refinedManifestRaw });
        return json({ error: "Couldn't apply that edit — the AI didn't return a usable update. Nothing was changed; please try again or rephrase your request." }, 502);
      }
      const nextManifest = normalize(refinedManifestRaw, existing.prompt || prompt);
      // The model's step-2 output from REFINE_DOC — the concrete, atomic edits
      // it identified from the request before deciding how to implement them.
      // Surfaced to the user so "identifies the wished edits" is a real,
      // visible artifact of the pipeline, not just an internal instruction.
      const identifiedEdits: string[] = Array.isArray(refined.identifiedEdits)
        ? (refined.identifiedEdits as unknown[]).filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 6)
        : [];

      // A model call that returns the manifest unchanged (byte-for-byte) is
      // exactly the failure mode loop detection above exists to catch: it
      // "agreed" with the request but didn't act on it. Normalize the
      // BEFORE manifest through the same function for a fair comparison
      // (currentManifest is a raw DB read, nextManifest went through
      // normalize's own defaulting/cleanup). Report this honestly instead
      // of the generic "Applied your changes" the summary would otherwise
      // claim — a customer who already saw the SAME message land with no
      // effect once needs a real answer, not the same false confirmation.
      const normalizedCurrent = normalize(currentManifest, existing.prompt || prompt);
      if (manifestsEquivalent(normalizedCurrent, nextManifest)) {
        // This is NOT necessarily a failure -- it also fires (correctly) when
        // the request is already satisfied, e.g. asking for a footer link
        // that ensureLegalPages already auto-added. A flat "didn't work" here
        // reads as a bug report when the site may already match what was
        // asked. `code: "no_change"` lets the frontend show this as a neutral
        // "nothing to change" note instead of a hard failure.
        const identifiedNote = identifiedEdits.length
          ? ` Identified: ${identifiedEdits.join("; ")}.`
          : "";
        return json({
          error: isRepeatedRequest
            ? `Still no visible change after a second attempt.${identifiedNote} Either the site already matches this (check the live preview) or the request needs to name the exact page and section (e.g. "on the Pricing page, change the headline").`
            : `No visible change was needed — the site may already match this request.${identifiedNote} If something's still missing, name the exact page or section to edit.`,
          code: "no_change",
          identified_edits: identifiedEdits,
        }, 422);
      }

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

      // Snapshot the pre-edit state so this refinement can be undone. Fires
      // before the write below, and never blocks the save if it fails.
      await snapshotWebsiteVersion(
        supabase, String(previousWebsiteId), user.id,
        `Edit: ${refined.intent || "mixed"}`, existing, existingPages || [],
      );

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
        identified_edits: identifiedEdits,
        summary: refined.summary || "Applied your changes.",
        refined: true,
      });
    }

    // ============ FRESH COMPILE PATH (also used for rebuild / new-site chat routes) ============
    let manifest: Manifest;
    // Any AI failure here (rate limit aside, already handled above) used to
    // silently drop into the generic 3-flavor fallbackManifest with no
    // signal at all -- the response looked like a normal success, so a user
    // had no way to know they got a boilerplate template instead of a real
    // generation for their business. Threaded through every response below
    // that returns `manifest` so the frontend can tell the difference.
    let usedFallback = false;
    try {
      const resp = await callAiGateway({
        // This is the single call every fresh generation is judged on, and
        // SCHEMA_DOC asks for genuinely hard creative-writing + design
        // judgment (brand-specific copy, deliberate asymmetric layout,
        // self-critique) -- exactly the "genuinely hard reasoning" case
        // ai-gateway.ts's deep tier exists for, not the fast/cheap default.
        model: gw.deepModel,
        messages: [
          { role: "system", content: `You are NazAI Website Compiler.\n\n${SCHEMA_DOC}` },
          { role: "user", content: `Compile this website brief into the JSON manifest. Follow user-specified style STRICTLY; invent a distinct identity where the brief is silent. Return only the JSON object.\n\nBRIEF:\n${compilePrompt}` },
        ],
        temperature: 0.85,
        // Was missing here (present on the refine and intent-routing calls)
        // -- relying solely on the "Return STRICT JSON only" prompt
        // instruction meant a higher chance of invalid JSON on exactly the
        // call that matters most, silently dropping the whole generation
        // into the generic 3-flavor fallbackManifest below with no signal
        // to the user that they got a template instead of a real one.
        response_format: { type: "json_object" },
      }, gw);
      if (resp.status === 429) return json({ error: "Rate limited. Please retry in a moment." }, 429);
      if (resp.status === 402) return json({ error: "AI credits exhausted for this workspace." }, 402);
      if (!resp.ok) throw new Error(`gateway ${resp.status}`);
      const data = await resp.json();
      const raw = data?.choices?.[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(stripFences(typeof raw === "string" ? raw : JSON.stringify(raw)));
      manifest = normalize(parsed, compilePrompt);
    } catch (err) {
      console.error("compile-website-manifest AI failure", err);
      manifest = fallbackManifest(compilePrompt);
      usedFallback = true;
    }

    if (!save) return json({ manifest, used_fallback: usedFallback });
    // A caller that asked to save (the frontend's default) but has no
    // resolved session used to fall into the same branch as "preview only"
    // above, silently returning {manifest} with no website_id and no error
    // at status 200. The frontend's own check (`!resp.ok || !body?.website_id`)
    // then had nothing to show but a generic `Website compile failed (200)` --
    // a real auth failure disguised as a mysteriously-empty success. Fail
    // loudly with the same wording compile-agent-manifest already uses for
    // this exact case.
    if (!user) return json({ error: "Not authenticated — sign in to save your website.", manifest }, 401);

    // REBUILD: regenerate this same website in place, replacing all of its pages.
    if (rebuildWebsiteId) {
      const { data: oldWebsite } = await supabase
        .from("websites").select("*").eq("id", rebuildWebsiteId).eq("user_id", user.id).maybeSingle();
      const { data: oldPages } = await supabase
        .from("website_pages").select("*").eq("website_id", rebuildWebsiteId);

      // Snapshot the pre-rebuild state so a full regeneration can be undone —
      // this is the most destructive save path, and the one most worth an undo.
      if (oldWebsite) {
        await snapshotWebsiteVersion(
          supabase, String(rebuildWebsiteId), user.id,
          "Full rebuild", oldWebsite, oldPages || [],
        );
      }

      const rebuildRows = manifest.pages.map((p, i) => ({
        website_id: rebuildWebsiteId,
        slug: p.slug,
        title: p.title,
        seo_description: p.seo_description ?? null,
        sections: p.sections,
        order_index: i,
      }));
      const { error: upErr } = await supabase
        .from("website_pages")
        .upsert(rebuildRows, { onConflict: "website_id,slug" });
      if (upErr) return json({ error: upErr.message }, 500);

      const keep = new Set(manifest.pages.map((p) => p.slug));
      const staleIds = (oldPages || []).filter((p: any) => !keep.has(p.slug)).map((p: any) => p.id);
      if (staleIds.length) await supabase.from("website_pages").delete().in("id", staleIds);

      const { error: wErr } = await supabase
        .from("websites")
        .update({
          name: manifest.name,
          title: manifest.name,
          tagline: manifest.tagline,
          theme: manifest.theme,
          prompt: compilePrompt,
        })
        .eq("id", rebuildWebsiteId)
        .eq("user_id", user.id);
      if (wErr) return json({ error: wErr.message }, 500);

      return json({
        manifest,
        website_id: rebuildWebsiteId,
        pages: manifest.pages,
        intent: "rebuild",
        rebuilt: true,
        summary: usedFallback
          ? `Something went wrong generating a custom design for "${manifest.name}" — showing a starter template instead. Try rebuilding again or refining it via chat.`
          : `Regenerated "${manifest.name}" from scratch — ${manifest.pages.length} page${manifest.pages.length === 1 ? "" : "s"} with a completely new design.`,
        used_fallback: usedFallback,
        route_reason: routeInfo.reason,
      });
    }

    // Charge one credit for creating a brand-new website -- editing/refining
    // or rebuilding an existing one (both handled above, before this point)
    // stays free, so iterating on what you've already built never drains
    // your balance. This is the only place a genuinely new website is ever
    // inserted, so it's the only place that should ever be charged.
    const credit = await consumeGenerationCredit(user.id);
    if (!credit.ok) return json({ error: NO_CREDITS_MESSAGE, code: "no_credits" }, 402);

    const { data: siteRow, error: siteErr } = await supabase
      .from("websites")
      .insert({
        user_id: user.id,
        name: manifest.name,
        title: manifest.name,
        tagline: manifest.tagline,
        theme: manifest.theme,
        prompt: compilePrompt,
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

    return json({
      manifest,
      website_id: siteRow.id,
      pages: pagesOut,
      used_fallback: usedFallback,
      ...(routeInfo.route === "new"
        ? {
            intent: "new",
            created_new: true,
            summary: usedFallback
              ? `Something went wrong generating a custom design for "${manifest.name}" — showing a starter template instead. Try regenerating or refining it via chat.`
              : `Built a separate new website — "${manifest.name}" (${manifest.pages.length} page${manifest.pages.length === 1 ? "" : "s"}). Opening it now; your previous site is untouched.`,
            route_reason: routeInfo.reason,
          }
        : {}),
    });
  } catch (e) {
    console.error("compile-website-manifest error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
