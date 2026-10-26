// Compile a website prompt into a structured manifest and persist to websites + website_pages.
// Input: { prompt: string, save?: boolean }
// Output: { manifest, website_id?, pages? }
import "../_shared/redact-console.ts"; // first: secrets never reach the function logs
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pickAiGateway, callAiGateway } from "../_shared/ai-gateway.ts";
import { consumeGenerationCredit, NO_CREDITS_MESSAGE } from "../_shared/credits.ts";
import { loadSafetyRules, scanWithRules, type SafetyMatch, type SafetyRule } from "../_shared/safety-scanner.ts";
import { computeTrustScore, isRedactableMatch } from "../_shared/outer-control-scoring.ts";
import { enforceImageRelevance, collectAssetUrls } from "../_shared/image-relevance.ts";
import { repairContent } from "../_shared/repair-engine.ts";
import { critiqueAndRevise, findUngroundedFacts } from "../_shared/generation-critique.ts";
import { assessProfessionalFloor, findStructuralIssues, repairUngroundedClaims } from "../_shared/generation-floor.ts";
import { findOutlineConformanceIssues } from "../_shared/generation-templates.ts";
import { generationCacheKeyFor, findCachedGeneration, storeCachedGeneration } from "../_shared/generation-cache.ts";
import { reportProgress, reportChecks } from "../_shared/generation-progress.ts";
import {
  defaultOutline, findOutlineTemplateIssues, getTemplate, isStructureId, OUTLINE_ADDABLE_TYPES, outlinePromptBlock,
  sanitizeOutline, structurePromptBlock, type Outline, type StructureId,
} from "../_shared/generation-templates.ts";
import { gateEdit, introducedIssues, newImageSlotCount } from "../_shared/generation-edit-gate.ts";
import { startersFromOutline } from "../_shared/generation-fallback.ts";
import { GENERATION_UNAVAILABLE_MESSAGE, isProviderOutOfCredits, openIncidentOnce, OUTAGE_SUMMARY, PROVIDER_OUTAGE_KIND } from "../_shared/provider-health.ts";
import {
  findStrictIssues, findVisualIssues, GUARD_PREFIX, initialChecks, repairVisual, setCheck, statusFromCounts, STRICT_PROMPT_BLOCK, VISUAL_FIX_PREFIX,
  type QualityCheck,
} from "../_shared/generation-quality.ts";

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
  /** "professional" = uniform section rhythm (set by the "Make it more professional" pass; read by WebsitePreview). */
  spacing?: string;
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
- Use media_style: "photo" ONLY when this request includes a real uploaded/linked image for that exact section (its asset_url will be set from that real attachment). Never request "photo" as a general stylistic choice for a business that "feels photo-y" (food, hospitality, real estate, galleries) -- a deterministic post-processing check rewrites any "photo" request with no matching real attachment to "illustration" before it's saved, so asking for one without a real attachment wastes this turn's effort for no visual benefit.
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
- 3-6 pages total, and at least 3 is mandatory: "home", AT LEAST ONE more content page the business genuinely needs (e.g. "about", "services", "menu", "pricing", "gallery", "faq" -- each with 2+ sections), and the dedicated "contact" page. A site that is only home + contact is incomplete. First page slug MUST be "home" and MUST start with a hero.
- FIRST-ATTEMPT COMPLETENESS: this is very likely the ONLY generation the user will see before judging the product — do not ship a thin starting point that assumes they'll fill in the gaps by chatting further. The "home" page alone must include, at minimum: hero, about OR feature-split, services (with at least 3 real items), and one more of (gallery|faq|process) chosen to fit the business (testimonials or stats ONLY when the brief itself supplies real customer quotes or real figures -- see NO INVENTED SOCIAL PROOF below). Every page other than "contact" and legal pages needs at least 2 sections (e.g. a heading section plus a supporting faq, process, or cta) -- never a page that is one lone section. In addition, there MUST be a dedicated "contact" page containing a real "contact" section with concrete "form_fields" (e.g. ["name","email","message"]) — a "cta" teaser section alone never satisfies this; a customer must have an actual working form to fill in on the first attempt, not a button that only leads to a promise of one. Every button/CTA anywhere in the manifest (hero, cta section, pricing tier) is genuinely pressable: it MUST have a resolvable href per MULTIPAGE NAVIGATION below — never an empty/omitted href "for later".
- Vary section variants across pages so the site doesn't feel templated.
- Copy must be specific to the described business — mention what it actually does, for whom, with real language.
- No lorem ipsum, no "Coming soon", no placeholder text.
- NO INVENTED SOCIAL PROOF: never write a testimonial, review, or quote attributed to a person (no "Jane Doe", no first-name-only customers) and never write a customer count, rating, percentage, years-in-business, or other statistic unless the brief states that exact person/number. When the brief gives none, omit "testimonials" and numeric "stats" sections and hero "stats" entirely -- a real faq, process, or gallery section is always better than a fabricated endorsement. Descriptions of what the business does are fine; claims about its track record are not.
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
//
// With `outline` (the user's approved outline, or the chosen structure's default
// outline) the PAGES follow that outline instead of the fixed three-page shape,
// so a "Pricing-focused" pick still gets its pricing page when the AI is down.
function fallbackManifest(prompt: string, outline?: Outline | null): Manifest {
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

  const starter: Manifest = {
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
          { type: "hero", variant: "split-image", content: { eyebrow: "Crafted with intent", headline: `Meet the ~remarkable~ side of ${name}.`, subheadline: `Discover ${offering} shaped around the people who expect more from every detail.`, cta_primary: "Explore our work", cta_primary_href: "services", cta_secondary: "Start a conversation", cta_secondary_href: "contact", image_prompt: `${name}, expressive editorial composition, tactile details, dramatic directional light`, media_style: "illustration", stats: [{ value: "01", label: "Distinct point of view" }, { value: "02", label: "Ways to get in touch" }] } },
          { type: "stats", content: { heading: "Built around what matters", items: [{ value: "01", label: "Clear promise" }, { value: "02", label: "Ways to get in touch" }, { value: "03", label: "Ways to explore" }] } },
          { type: "feature-split", variant: "editorial", content: { heading: `A more ~considered~ experience.`, body: `Every part of ${name} is designed to feel coherent, useful, and unmistakably its own.`, bullets: ["A focused, memorable identity", "Details shaped around real needs", "Clear paths from interest to action"], image_prompt: `${name}, close-up material study, refined craftsmanship, category-specific objects`, media_style: "pattern", reverse: true } },
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
  if (outline) starter.pages = startersFromOutline(outline, { name, offering }) as unknown as Page[];
  return starter;
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

// Problem 2 (Generator quality, 2026-10-08): SCHEMA_DOC's own "FIRST-ATTEMPT
// COMPLETENESS" rule already states this as non-negotiable -- "there MUST
// be a dedicated 'contact' page containing a real 'contact' section with
// concrete form_fields... a 'cta' teaser section alone never satisfies
// this" -- but nothing ever verified the model actually did it. That
// instruction was pure prompt-level steering with zero deterministic
// enforcement: a thin generation under a vague brief could (and did) ship
// with no real way to contact the business at all. Same established
// pattern as ensureLegalPages just above -- deterministic, no extra model
// call, so this can never be skipped the way a soft instruction can.
function hasRealContactSection(pages: Page[]): boolean {
  return pages.some((p) =>
    p.sections.some((s) => {
      if (s.type !== "contact") return false;
      const fields = (s.content as { form_fields?: unknown }).form_fields;
      return Array.isArray(fields) && fields.length > 0;
    }),
  );
}

function contactPage(name: string): Page {
  return {
    slug: "contact",
    title: "Contact",
    seo_description: `Get in touch with ${name}.`.slice(0, 160),
    sections: [{
      type: "contact",
      content: {
        heading: "Get in touch",
        body: `Have a question or want to work with ${name}? Send a message below and we'll get back to you.`,
        form_fields: ["name", "email", "message"],
      },
    }],
  };
}

function ensureContactPage(pages: Page[], name: string): void {
  if (!hasRealContactSection(pages)) pages.push(contactPage(name));
}

// GAP 3 (Output Modification & Repair Engine): routes each string leaf
// through the same shared repairContent primitive Outer Control's own
// correction path and compile-agent-manifest's prose scan use, instead of
// calling redactContent directly -- a leaf with nothing redactable in this
// match set (every match here IS pre-filtered to redactable ones by
// applySafetyGate below, but repairContent's own no-op guard is kept as
// defense in depth) comes back unchanged rather than null.
function redactDeep(value: unknown, matches: SafetyMatch[]): unknown {
  if (typeof value === "string") return repairContent(value, matches).repaired ?? value;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, matches));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v, matches);
    return out;
  }
  return value;
}

// Blueprint task #60: close the "no bypass" gap for page generation. Task
// #55's accountRulesBlock only ever STEERS the model before it writes a
// single word -- nothing stopped it from echoing a real-looking secret it
// was fed, or writing copy that matches one of the account's own safety
// rules. Applied to every FINAL manifest (fresh compile, rebuild, and
// refine all produce exactly one, right before it's saved), using the same
// deterministic scanner every real agent action's params already go
// through. scanWithRules' own flatten() already walks ANY nested JSON
// shape field-by-field -- no page-schema-specific extraction needed, the
// whole pages[] tree is handed to it directly.
function applySafetyGate(manifest: Manifest, rules: SafetyRule[]): { manifest: Manifest; notes: string[]; blocked: boolean; blockReason: string | null; trustScore: number } {
  // GAP 3 (Hard Rule Coverage Expansion, 2026-10-10): this used to scan only
  // manifest.pages -- the model-authored business name and tagline are
  // top-level fields, not inside pages[], and were never scanned or
  // redacted at all. Both are free text the model writes from the user's
  // prompt, exactly the same provenance as page copy, so they get the same
  // scan and the same redaction/block treatment below.
  const scan = scanWithRules(rules, { name: manifest.name, tagline: manifest.tagline, pages: manifest.pages }, "");
  if (!scan.matched) return { manifest, notes: [], blocked: false, blockReason: null, trustScore: 100 };
  // GAP 3 (Trust Score + Provenance + Control Report, 2026-10-09): same
  // computeTrustScore Outer Control's own evaluations and
  // checkWebsiteAssembly (final-assembly-check.ts) already use -- this is
  // the generation-time half of the same score, computed from this
  // generation's own matches before any redaction below.
  const trustScore = computeTrustScore(scan.matches);
  const redactable = scan.matches.filter((m) => isRedactableMatch(m));
  const nonRedactable = scan.matches.filter((m) => !isRedactableMatch(m));
  const notes: string[] = [];
  let pages = manifest.pages;
  let name = manifest.name;
  let tagline = manifest.tagline;
  if (redactable.length) {
    // Secrets/PII have an excisable span -- strip just that; every other
    // field across every page (and the business name/tagline, now that
    // they're scanned above too) is unaffected and still ships as written.
    pages = redactDeep(manifest.pages, redactable) as Page[];
    name = redactDeep(manifest.name, redactable) as string;
    tagline = redactDeep(manifest.tagline, redactable) as string;
    notes.push(`Content matching your safety rule(s) (${redactable.map((m) => m.name).join(", ")}) was redacted at generation time.`);
  }
  // Problem 1 (Control Gate weak on websites, 2026-10-08): a block-severity
  // match with nothing mechanically redactable (destructive wording, etc.)
  // used to get the SAME "not blocked, review before publishing" note as a
  // require_approval match -- "block" severity never actually blocked
  // anything for a website, the one path in this system where it didn't.
  // Every real agent action already stops outright on a non-redactable
  // block match (decision-scoring.ts); this makes websites match that,
  // instead of just noting the same thing require_approval content gets.
  // require_approval content (mass-audience wording, a refund mention,
  // etc.) is routine, legitimate business copy far more often than not, so
  // that stays a visible note, never a block.
  const blockSeverityNonRedactable = nonRedactable.filter((m) => m.severity === "block");
  const requireApprovalNonRedactable = nonRedactable.filter((m) => m.severity !== "block");
  if (requireApprovalNonRedactable.length) {
    notes.push(`This page's copy touches your safety rule(s) (${requireApprovalNonRedactable.map((m) => m.name).join(", ")}) -- not blocked, review before publishing.`);
  }
  if (blockSeverityNonRedactable.length) {
    return {
      manifest: { ...manifest, name, tagline, pages },
      notes,
      blocked: true,
      blockReason: `This page's copy matches your safety rule(s) (${blockSeverityNonRedactable.map((m) => m.name).join(", ")}) -- a block-severity rule with nothing mechanically redactable here, so generation is stopped rather than published with just a note.`,
      trustScore,
    };
  }
  return { manifest: { ...manifest, name, tagline, pages }, notes, blocked: false, blockReason: null, trustScore };
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
    spacing: themeRaw.spacing === "professional" ? "professional" : undefined,
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
  ensureContactPage(pages, name);

  return { name, tagline, theme, pages };
}

// Custom image generation (2026-10-11): once a site is saved, ask
// generate-site-images to create the pictures. That function answers 202
// immediately and keeps working in the background, so this never delays the
// response by more than its own round trip. Best-effort by design -- a failure
// here must never fail a generation that already saved; the site simply keeps
// its decorative illustrations and the preview shows no spinner.
async function kickOffImageGeneration(websiteId: string, authHeader: string, extra: Record<string, unknown> = {}): Promise<void> {
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-site-images`, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json", apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "" },
      body: JSON.stringify({ website_id: websiteId, ...extra }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    console.error("generate-site-images kickoff failed", e);
  }
}

// findStructuralIssues now lives in ../_shared/generation-floor.ts (pure, tested), where it
// also checks non-home pages -- it used to inspect only the home page.

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

// ---- Generator UX (2026-10-12) helpers -----------------------------------------

/** Instruction blocks appended to the system prompt for every generation/revision call. */
function directiveBlocks(structure: StructureId | null, strict: boolean, outline: Outline | null): string {
  return [
    // With an approved outline, the outline is the authority: the template's
    // page rules would contradict a user edit.
    structure && !outline ? structurePromptBlock(structure) : "",
    outline ? outlinePromptBlock(outline) : "",
    strict ? STRICT_PROMPT_BLOCK : "",
  ].filter(Boolean).join("\n\n");
}

const OUTLINE_DOC = (templateBlock: string) => `You plan website structures. Return STRICT JSON only: {"pages":[{"slug":string,"title":string,"sections":[{"type":string,"variant"?:string}]}]}
Allowed section types: hero, about, feature-split, services, gallery, process, faq, pricing, cta, contact. Use testimonials, stats or logos ONLY when the brief itself supplies real ones.
Rules: the first page has slug "home" and starts with a "hero"; the last page has slug "contact" with one "contact" section; slugs are kebab-case; page titles are specific to this business (for example "Menu" for a café, "Treatments" for a clinic); no empty pages; at most 6 pages and 10 sections per page.
${templateBlock}`;

/** Stage 1 of the progressive flow. Never throws; a model failure yields the template's default outline. */
async function proposeOutline(
  gw: NonNullable<ReturnType<typeof pickAiGateway>>,
  brief: string,
  structure: StructureId,
): Promise<{ outline: Outline; structure: StructureId; source: "model" | "default"; note: string | null; addable_types: readonly string[] }> {
  const fallback = defaultOutline(structure);
  const label = getTemplate(structure).label;
  const base = { structure, addable_types: OUTLINE_ADDABLE_TYPES };
  try {
    const resp = await callAiGateway({
      model: gw.model,
      messages: [
        { role: "system", content: OUTLINE_DOC(structurePromptBlock(structure)) },
        { role: "user", content: `BRIEF:\n${brief.slice(0, 3000)}` },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    }, gw);
    if (!resp.ok) throw new Error(`gateway ${resp.status}`);
    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content ?? "{}";
    const outline = sanitizeOutline(JSON.parse(stripFences(typeof raw === "string" ? raw : JSON.stringify(raw))));
    if (!outline) throw new Error("unusable outline");
    if (findOutlineTemplateIssues(outline, structure).length) {
      return { ...base, outline: fallback, source: "default", note: `The suggested pages didn't fit the "${label}" structure, so the standard ${label} outline is shown. Adjust it below.` };
    }
    return { ...base, outline, source: "model", note: null };
  } catch (e) {
    console.error("outline proposal failed", e);
    return { ...base, outline: fallback, source: "default", note: `Couldn't tailor the outline to your brief this time, so the standard ${label} outline is shown. Adjust it below.` };
  }
}

/** One bounded revision call that fixes exactly the listed issues. Returns null on any failure. */
async function reviseManifestWithIssues(
  gw: NonNullable<ReturnType<typeof pickAiGateway>>,
  directive: string,
  issues: string[],
  current: Manifest,
  brief: string,
): Promise<Manifest | null> {
  try {
    const reviseResp = await callAiGateway({
      model: gw.deepModel,
      messages: [
        { role: "system", content: `You are NazAI Website Compiler.\n\n${SCHEMA_DOC}${directive ? `\n\n${directive}` : ""}` },
        { role: "user", content: `Revise this website manifest to fix ONLY the specific issues listed below -- keep everything else intact. Return only the corrected JSON object.\n\nISSUES TO FIX:\n${issues.join("\n")}\n\nCURRENT MANIFEST:\n${JSON.stringify(current)}\n\nORIGINAL BRIEF:\n${brief.slice(0, 2000)}` },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    }, gw);
    if (!reviseResp.ok) return null;
    const data = await reviseResp.json();
    const raw = data?.choices?.[0]?.message?.content ?? "{}";
    return normalize(JSON.parse(stripFences(typeof raw === "string" ? raw : JSON.stringify(raw))), brief);
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const gw = pickAiGateway();
    if (!gw) return json({ error: "Missing OPENAI_API_KEY (or LOVABLE_API_KEY)" }, 500);

    const body = await req.json().catch(() => ({}));
    const { prompt, save = true, previousWebsiteId, refine = false, recentTurns = [], attachments = [], requestId = null } = body || {};
    // Generator UX (2026-10-12): the user's structure choice, Strict Mode,
    // the stage-1 outline step, and the staged-flow marker. All optional --
    // a request without them behaves exactly as before.
    const structure: StructureId | null = isStructureId(body?.structure) ? body.structure : null;
    const strict = body?.strict === true;
    const outlineMode = body?.mode === "outline";
    const approvedOutline: Outline | null = body?.outline ? sanitizeOutline(body.outline) : null;
    const staged = body?.staged === true;
    const improveMode = body?.improve === "professional";
    const visualAttachments = Array.isArray(attachments)
      ? attachments.filter((a: any) => a && a.kind === "image" && (a.assetUrl || a.url)).slice(0, 6)
      : [];
    // Image-relevance quality loop (2026-10-09): the only asset_url values
    // ever genuinely trustworthy are ones that came from a real upload/link
    // the user attached to THIS request -- anything else in a manifest's
    // asset_url is either echoed from a PAST save (handled separately, see
    // enforceImageRelevance's no-verified-set mode) or invented by the
    // model. Built once, reused by every save path below.
    const verifiedImageUrls = new Set(visualAttachments.map((a: any) => a.assetUrl || a.url));
    if (!prompt || typeof prompt !== "string") return json({ error: "prompt required" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    // GAP 8 (Speed & Reliability Layer): a service-role client for the
    // generation_cache/generation_progress writes below -- authenticated
    // users only ever get a SELECT grant on those tables, so writing
    // through the user-context `supabase` client above would silently fail
    // (and be swallowed by those helpers' own try/catch) every time.
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    await reportProgress(admin, requestId, user?.id, "understanding");

    // Progressive refinement, stage 1 (Structure): propose the page/section
    // outline for the chosen structure. No content is written, nothing is
    // saved and no credit is charged -- the user reviews/edits the outline,
    // then a second request (outline + staged) generates the content.
    if (outlineMode) {
      if (!user) return json({ error: "Not authenticated — sign in to generate." }, 401);
      return json(await proposeOutline(gw, prompt, structure ?? "full-business"));
    }

    // Blueprint task #2: give page generation the same account-rules-
    // awareness compile-agent-manifest's Generator got (task #49). A
    // generated page could otherwise promise something ("book instantly",
    // "chat with our AI agent", a specific integration or claim) that an
    // account-wide hard/safety rule would block the moment an agent tried to
    // act on it -- the site and the rules that govern the business behind it
    // must read as one system, not two unrelated tools. Only account-wide
    // rules (agent_id IS NULL) apply here, same scoping as task #49.
    let accountRulesBlock = "";
    if (user) {
      const [{ data: hardRules }, { data: safetyRules }] = await Promise.all([
        supabase.from("hard_rules").select("rule_text, action_type_pattern, effect, provider")
          .eq("user_id", user.id).is("agent_id", null).eq("enabled", true),
        supabase.from("safety_rules").select("name, category, severity").eq("user_id", user.id).eq("enabled", true),
      ]);
      const hr = (hardRules ?? []) as { rule_text: string; action_type_pattern: string; effect: string; provider: string | null }[];
      const sr = (safetyRules ?? []) as { name: string; category: string; severity: string }[];
      if (hr.length || sr.length) {
        accountRulesBlock = `\n\nEXISTING ACCOUNT-WIDE RULES (already enforced for every agent and automation on this account -- do not design copy, forms, or CTAs that promise something one of these rules would block, e.g. an "always_block" rule on a booking/send action while the page's CTA promises instant booking/sending):` +
          (hr.length
            ? `\nHard rules:\n${hr.map((r) => `- [${r.effect}] pattern "${r.action_type_pattern}"${r.provider ? ` (provider: ${r.provider})` : ""}: ${r.rule_text}`).join("\n")}`
            : "") +
          (sr.length
            ? `\nSafety rules: ${sr.map((r) => `${r.name} (${r.category}, ${r.severity})`).join("; ")}`
            : "");
      }
    }

    // Blueprint task #60: full safety_rules (with patterns, not just the
    // name/category/severity summary above) for the deterministic gate
    // applied to the actual generated copy below -- a separate fetch from
    // accountRulesBlock's lightweight one since that one only ever steers
    // the model's prompt text.
    const gateSafetyRules = user ? await loadSafetyRules(supabase, user.id, null) : [];

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
    // GAP 4 (Speed & Reliability Layer, 2026-10-09): hoisted out of the two
    // "REFINE PATH" blocks below -- both used to fetch this SAME website +
    // its SAME pages independently (the routing block only to read
    // `existing.name` for the classifier prompt, the edit block to build
    // currentManifest), paying for the website_pages round-trip twice on
    // every single chat-edit request, the single most common path through
    // this function. Fetched once here and reused by both.
    let existing: Record<string, unknown> | null = null;
    let existingPages: Record<string, unknown>[] | null = null;

    // ============ PROFESSIONAL PASS ("Make it more professional") ============
    // Re-runs an EXISTING site through the strict rules: deterministic
    // colour/variant repair, the strict floor (+ the site's saved structure
    // template) with bounded revisions, invented-claim removal, the image
    // relevance gate, and uniform section spacing (theme.spacing). A
    // snapshot is taken first so the result can be compared and undone.
    if (improveMode) {
      if (!user || !previousWebsiteId) return json({ error: "Sign in and open a website to improve it." }, 401);
      const { data: siteRow } = await supabase.from("websites").select("*").eq("id", previousWebsiteId).eq("user_id", user.id).maybeSingle();
      if (!siteRow) return json({ error: "Website not found" }, 404);
      const { data: pageRowsRaw } = await supabase.from("website_pages").select("*").eq("website_id", previousWebsiteId).order("order_index", { ascending: true });
      const pageRows = pageRowsRaw ?? [];
      const brief = String(siteRow.prompt || prompt);
      const siteStructure: StructureId | null = isStructureId(siteRow.structure_template) ? siteRow.structure_template : null;
      const before = normalize({
        name: siteRow.name, tagline: siteRow.tagline, theme: siteRow.theme,
        pages: pageRows.map((p: any) => ({ slug: p.slug, title: p.title, seo_description: p.seo_description, sections: p.sections || [] })),
      }, brief);

      await reportProgress(admin, requestId, user.id, "refining");
      let proChecks: QualityCheck[] = initialChecks();
      const publishPro = async (stage: string) => { await reportChecks(admin, requestId, user.id, stage, proChecks); };
      const proNotes: string[] = [];

      const vBefore = findVisualIssues(before).length;
      const visual = repairVisual(before);
      let working: Manifest = visual.manifest;
      visual.notes.forEach((n) => proNotes.push(VISUAL_FIX_PREFIX + n));
      proChecks = setCheck(proChecks, "visual", statusFromCounts(vBefore, findVisualIssues(working).length), visual.notes[0] ?? "Palette, contrast, layout and hero variants are consistent");
      proChecks = setCheck(setCheck(proChecks, "structure", "checking"), "claims", "checking");
      await publishPro("refining");

      const proOpts = { template: siteStructure ?? undefined, strict: true };
      const proDirective = [siteStructure ? structurePromptBlock(siteStructure) : "", STRICT_PROMPT_BLOCK].filter(Boolean).join("\n\n");
      const structBefore = findStructuralIssues(working, siteStructure ?? undefined).length;
      let issues = assessProfessionalFloor(working, brief, proOpts).issues;
      const issuesStart = issues.length;
      for (let attempt = 0; attempt < 3 && issues.length; attempt++) {
        const revised = await reviseManifestWithIssues(gw, proDirective, issues, working, brief);
        if (!revised || !revised.name || !revised.pages?.length) break;
        const repairedRevision = repairVisual(revised).manifest;
        const nextIssues = assessProfessionalFloor(repairedRevision, brief, proOpts).issues;
        if (nextIssues.length > issues.length) break;
        working = repairedRevision;
        issues = nextIssues;
      }
      if (issuesStart > issues.length) proNotes.push(`${GUARD_PREFIX}Fixed ${issuesStart - issues.length} of ${issuesStart} quality issue(s) (wording, links, structure).`);

      const claimFix = repairUngroundedClaims(working, brief);
      working = claimFix.manifest;
      claimFix.notes.forEach((n) => proNotes.push(GUARD_PREFIX + n));

      working = { ...working, theme: { ...working.theme, spacing: "professional" } };
      if (before.theme.spacing !== "professional") proNotes.push(`${VISUAL_FIX_PREFIX}Applied one consistent vertical rhythm to every section.`);

      const gated = applySafetyGate(working, gateSafetyRules);
      if (gated.blocked) return json({ error: "blocked_by_safety_rule", message: gated.blockReason }, 422);
      const imageGate = enforceImageRelevance(gated.manifest.pages, collectAssetUrls(before.pages));
      const polished: Manifest = { ...gated.manifest, pages: imageGate.pages };
      imageGate.notes.forEach((n) => proNotes.push(GUARD_PREFIX + n));

      const structAfter = findStructuralIssues(polished, siteStructure ?? undefined);
      proChecks = setCheck(proChecks, "structure", statusFromCounts(structBefore, structAfter.length),
        structAfter.length ? `${structAfter.length} structure issue(s) remain` : siteStructure ? `Follows the ${getTemplate(siteStructure).label} structure` : "Complete home page and supporting pages");
      proChecks = setCheck(proChecks, "claims", claimFix.removed.length ? "fixed" : "passed", claimFix.removed.length ? `Removed ${claimFix.removed.length} invented item(s)` : "No invented testimonials, statistics or placeholder copy");
      proChecks = setCheck(proChecks, "images", imageGate.notes.length ? "fixed" : "passed", imageGate.notes.length ? `Replaced ${imageGate.notes.length} unverified image(s)` : "Images are checked against your brief");
      await publishPro("reviewing");

      const remaining = assessProfessionalFloor(polished, brief, proOpts).issues;
      const keptNotes = (Array.isArray(siteRow.generation_notes) ? siteRow.generation_notes : [])
        .filter((n: unknown) => typeof n === "string" && !n.startsWith(GUARD_PREFIX) && !n.startsWith(VISUAL_FIX_PREFIX) && !n.startsWith("Quality check:"));
      const generationNotes = [...new Set([...keptNotes, ...gated.notes, ...proNotes, ...(remaining.length ? [`Quality check: ${remaining.join(" ")}`] : [])])];

      const unchanged = JSON.stringify(normalize(before, brief)) === JSON.stringify(polished);
      if (unchanged) {
        await supabase.from("websites").update({ generation_stage: "polished" }).eq("id", previousWebsiteId).eq("user_id", user.id);
        return json({
          improved: false, website_id: previousWebsiteId, quality_checks: proChecks, generation_notes: generationNotes,
          summary: "This site already meets the professional standard — nothing needed to change.",
        });
      }

      await reportProgress(admin, requestId, user.id, "saving");
      await snapshotWebsiteVersion(supabase, String(previousWebsiteId), user.id, "Before professional pass", siteRow, pageRows);
      const rows = polished.pages.map((p, i) => ({
        website_id: previousWebsiteId, slug: p.slug, title: p.title, seo_description: p.seo_description ?? null, sections: p.sections, order_index: i,
      }));
      const { error: upErr } = await supabase.from("website_pages").upsert(rows, { onConflict: "website_id,slug" });
      if (upErr) return json({ error: upErr.message }, 500);
      const keepSlugs = new Set(polished.pages.map((p) => p.slug));
      const staleIds = pageRows.filter((p: any) => !keepSlugs.has(p.slug)).map((p: any) => p.id);
      if (staleIds.length) await supabase.from("website_pages").delete().in("id", staleIds);
      const { error: wErr } = await supabase.from("websites").update({
        name: polished.name, title: polished.name, tagline: polished.tagline, theme: polished.theme,
        generation_notes: generationNotes, trust_score: gated.trustScore, generation_stage: "polished",
      }).eq("id", previousWebsiteId).eq("user_id", user.id);
      if (wErr) return json({ error: wErr.message }, 500);

      await kickOffImageGeneration(String(previousWebsiteId), authHeader, { polish: true });
      return json({
        improved: true,
        website_id: previousWebsiteId,
        manifest: polished,
        pages: polished.pages,
        generation_notes: generationNotes,
        quality_checks: proChecks,
        trust_score: gated.trustScore,
        polish_notes: proNotes,
        remaining_issues: remaining,
        summary: proNotes.length
          ? `Professional pass applied ${proNotes.length} improvement${proNotes.length === 1 ? "" : "s"}. Compare it with the previous version, or restore that version from History.`
          : "Professional pass finished.",
      });
    }

    // ============ REFINE PATH ============
    if (refine && previousWebsiteId && user) {
      const { data: existingRow } = await supabase.from("websites").select("*").eq("id", previousWebsiteId).eq("user_id", user.id).maybeSingle();
      if (!existingRow) return json({ error: "Website not found" }, 404);
      existing = existingRow;
      const { data: existingPagesRows } = await supabase.from("website_pages").select("*").eq("website_id", previousWebsiteId).order("order_index", { ascending: true });
      existingPages = existingPagesRows ?? [];

      const routed = await routeWebsiteChatIntent(gw, prompt, String(existing.name || "this website"));
      routeInfo = { route: routed.route, reason: routed.reason };
      if (routed.route !== "edit") {
        compilePrompt = routed.brief;
        rebuildWebsiteId = routed.route === "rebuild" ? String(previousWebsiteId) : null;
      }
    }

    if (refine && previousWebsiteId && user && routeInfo.route === "edit") {
      // Always set by the routing block above (it runs first, under the
      // same `refine && previousWebsiteId && user` guard, and returns 404
      // before routeInfo can become "edit" otherwise) -- this check only
      // narrows the type for everything below without a redundant DB call.
      if (!existing) return json({ error: "Website not found" }, 404);
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
      await reportProgress(admin, requestId, user.id, "generating");
      try {
        const resp = await callAiGateway({
          model: gw.deepModel,
          messages: [
            { role: "system", content: `${REFINE_DOC}\n\n${SCHEMA_DOC}` },
            {
              role: "user",
              content: visualAttachments.length
                ? [
                    { type: "text", text: `CURRENT MANIFEST (do not regenerate untouched parts):\n${JSON.stringify(currentManifest)}\n\n${conversation ? `RECENT CONVERSATION (use only to resolve references and continuity):\n${conversation}\n\n` : ""}USER REQUEST + ANALYZED INTENT:\n${prompt}${accountRulesBlock}\n\nAttached images are shown below — copy their exact URLs byte-for-byte into the target section/item's asset_url so they render in the site. First infer the user's real expectation, then execute it as a coordinated design change: visual signature, palette, typography, copy, hierarchy, imagery, and micro-interactions must still feel like one deliberate system. Preserve every detail not requested or required for coherence. Return the JSON envelope { intent, identifiedEdits, summary, manifest }.${loopClause}` },
                    ...visualAttachments.map((a: any) => ({ type: "image_url", image_url: { url: a.assetUrl || a.url } })),
                  ]
                : `CURRENT MANIFEST (do not regenerate untouched parts):\n${JSON.stringify(currentManifest)}\n\n${conversation ? `RECENT CONVERSATION (use only to resolve references and continuity):\n${conversation}\n\n` : ""}USER REQUEST + ANALYZED INTENT:\n${prompt}${accountRulesBlock}\n\nFirst infer the user's real expectation, then execute it as a coordinated design change: visual signature, palette, typography, copy, hierarchy, imagery, and micro-interactions must still feel like one deliberate system. Preserve every detail not requested or required for coherence. Return the JSON envelope { intent, identifiedEdits, summary, manifest }.${loopClause}`,
            },
          ],
          temperature: isRepeatedRequest ? 0.2 : 0.4,
          response_format: { type: "json_object" },
        }, gw);
        if (resp.status === 429 || resp.status === 402) {
          // Our provider account being out of credit is an outage on our side, not a rate limit the user can wait out.
          if (isProviderOutOfCredits(resp.status, await resp.clone().text().catch(() => ""))) throw new Error("gateway credits unavailable");
          throw new Error("gateway rate limited");
        }
        if (!resp.ok) throw new Error(`gateway ${resp.status}`);
        const data = await resp.json();
        const raw = data?.choices?.[0]?.message?.content ?? "{}";
        refined = JSON.parse(stripFences(typeof raw === "string" ? raw : JSON.stringify(raw)));
      } catch (err) {
        console.error("refine AI failure", err);
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("credits unavailable")) {
          await openIncidentOnce(admin, PROVIDER_OUTAGE_KIND, OUTAGE_SUMMARY, { source: "compile-website-manifest:refine" });
          return json({ error: GENERATION_UNAVAILABLE_MESSAGE, code: "generation_unavailable" }, 503);
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
      const refinedGated = applySafetyGate(normalize(refinedManifestRaw, existing.prompt || prompt), gateSafetyRules);
      if (refinedGated.blocked) {
        return json({ error: "blocked_by_safety_rule", message: refinedGated.blockReason }, 422);
      }
      // A linked/uploaded asset is an executable instruction, not prose --
      // hoisted above the image-relevance gate (was computed below, after
      // nextManifest already existed) because a URL the user typed directly
      // into their edit prompt is just as real an instruction as a file
      // attachment, and must be in the verified set BEFORE enforcement runs
      // or the gate strips it as "unverified" and the missing-asset check
      // below then fails an edit that actually worked correctly.
      const requestedAssetUrls = Array.from(prompt.matchAll(/https?:\/\/[^\s)\]}>"']+/g))
        .map((match) => match[0])
        .filter((url) => /(?:\/storage\/v1\/object\/public\/|\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$))/i.test(url));
      // Image-relevance quality loop (2026-10-09): REFINE_DOC tells the
      // model to echo untouched sections back verbatim, so a section this
      // edit never touched can legitimately carry an asset_url that was
      // verified and saved at an EARLIER generation -- folded into this
      // request's own verifiedImageUrls so it's never mistaken for a fresh
      // hallucination just because it wasn't re-attached this time. A URL
      // the user explicitly typed into this edit's prompt (requestedAssetUrls)
      // is the same tier of trust as a file attachment and joins the set too.
      const refineVerifiedUrls = new Set([...verifiedImageUrls, ...collectAssetUrls(currentManifest.pages), ...requestedAssetUrls]);
      const imageGated = enforceImageRelevance(refinedGated.manifest.pages, refineVerifiedUrls);
      const nextManifest = { ...refinedGated.manifest, pages: imageGated.pages };
      // Problem 3 follow-up (fresh audit, 2026-10-08): findUngroundedFacts
      // was wired into the fresh-generation/rebuild path only -- an edit
      // through this chat-refine branch never ran it at all, even though an
      // edit prompt ("add a pricing section") is typically SHORTER and less
      // detailed than a full site brief, exactly the condition the audit
      // named as the trigger for invented facts. Grounds against the
      // site's original brief PLUS this edit's own request, since a fact
      // the user just typed in their edit is legitimately sourced, not
      // fabricated. Advisory note only, same as the fresh-path check --
      // never blocks or alters content.
      const editFactCheckNotes: string[] = [];
      {
        const ungrounded = findUngroundedFacts(JSON.stringify(nextManifest.pages), `${existing.prompt || ""}\n${prompt}`);
        if (ungrounded.length) {
          editFactCheckNotes.push(
            `This edit's copy includes ${ungrounded.map((f) => `a ${f.kind} ("${f.value}")`).join(", ")} not found in your original brief or this request -- verify before publishing.`,
          );
        }
      }
      const generationNotes = [...refinedGated.notes, ...editFactCheckNotes, ...imageGated.notes];
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

      // requestedAssetUrls is computed above, before the image-relevance
      // gate runs, so it can be folded into refineVerifiedUrls. If the
      // model still omitted the exact URL, fail visibly instead of
      // claiming success.
      if (requestedAssetUrls.length) {
        const serializedManifest = JSON.stringify(nextManifest);
        const missingAssets = requestedAssetUrls.filter((url) => !serializedManifest.includes(url));
        if (missingAssets.length) {
          return json({ error: "The requested image could not be placed in the website. Please attach it again or provide a direct image URL." }, 422);
        }
      }

      // GEN+ 1: an edit gets the same quality guarantees as a first build,
      // limited to what can never fight the user's own request: mechanical
      // visual repair, removal of testimonials/statistics THIS edit invented,
      // and -- only on a Strict Mode site -- one bounded revision of wording/
      // link problems the edit introduced. Structure problems the edit
      // introduced are reported, never forced back to the template.
      const editBrief = String(existing.prompt || prompt);
      const siteStructure: StructureId | null = isStructureId(existing.structure_template) ? existing.structure_template : null;
      const gate = gateEdit({ before: normalizedCurrent, after: nextManifest, brief: editBrief, prompt, strict: existing.strict_mode === true, template: siteStructure });
      let finalManifest: Manifest = gate.manifest;
      const editNotes: string[] = [...gate.notes];
      let strictLeft = gate.strictIssues;
      if (strictLeft.length) {
        await reportProgress(admin, requestId, user.id, "refining");
        const revised = await reviseManifestWithIssues(
          gw,
          `${STRICT_PROMPT_BLOCK}\n\nThe user's latest request is authoritative: keep every change it asked for and fix only the listed issues.\nUSER REQUEST: ${prompt.slice(0, 600)}`,
          strictLeft, finalManifest, editBrief,
        );
        if (revised?.name && revised.pages?.length) {
          const revisedGated = applySafetyGate(repairVisual(revised).manifest, gateSafetyRules);
          if (!revisedGated.blocked) {
            const candidate: Manifest = { ...revisedGated.manifest, pages: enforceImageRelevance(revisedGated.manifest.pages, refineVerifiedUrls).pages };
            const left = introducedIssues(findStrictIssues(normalizedCurrent, editBrief), findStrictIssues(candidate, `${editBrief}\n${prompt}`));
            if (left.length < strictLeft.length) {
              editNotes.push(`${GUARD_PREFIX}Strict Mode: fixed ${strictLeft.length - left.length} of ${strictLeft.length} wording/link issue(s) this edit introduced.`);
              finalManifest = candidate;
              strictLeft = left;
            }
          }
        }
      }
      if (strictLeft.length) editNotes.push(`Quality check: ${strictLeft.join(" ")}`);
      if (gate.structureIssues.length) editNotes.push(`Quality check: this edit left the site with: ${gate.structureIssues.join(" ")}`);
      const finalNotes = [...generationNotes, ...editNotes];
      const newImageSlots = newImageSlotCount(normalizedCurrent.pages, finalManifest.pages, { siteName: finalManifest.name, layout: finalManifest.theme?.layout });

      await reportProgress(admin, requestId, user.id, "saving");
      // Snapshot the pre-edit state so this refinement can be undone. Fires
      // before the write below, and never blocks the save if it fails.
      await snapshotWebsiteVersion(
        supabase, String(previousWebsiteId), user.id,
        `Edit: ${refined.intent || "mixed"}`, existing, existingPages || [],
      );

      const pageRows = finalManifest.pages.map((p, i) => ({
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

      const nextSlugs = new Set(finalManifest.pages.map((p) => p.slug));
      const stalePageIds = (existingPages || []).filter((p: any) => !nextSlugs.has(p.slug)).map((p: any) => p.id);
      if (stalePageIds.length) {
        const { error: cleanupErr } = await supabase.from("website_pages").delete().in("id", stalePageIds);
        if (cleanupErr) console.warn("stale website page cleanup failed", cleanupErr);
      }

      const { error: uErr } = await supabase
        .from("websites")
        .update({
          name: finalManifest.name,
          title: finalManifest.name,
          tagline: finalManifest.tagline,
          theme: finalManifest.theme,
          generation_notes: finalNotes,
          trust_score: refinedGated.trustScore,
        })
        .eq("id", previousWebsiteId)
        .eq("user_id", user.id);
      if (uErr) return json({ error: uErr.message }, 500);

      if (newImageSlots > 0) await kickOffImageGeneration(String(previousWebsiteId), authHeader);
      const extras = [
        gate.visualFixes ? "fixed contrast/consistency issues" : "",
        gate.claimsRemoved ? `removed ${gate.claimsRemoved} invented testimonial/statistic item(s)` : "",
        newImageSlots ? `generating ${newImageSlots} new image${newImageSlots === 1 ? "" : "s"}` : "",
      ].filter(Boolean);
      return json({
        manifest: finalManifest,
        generation_notes: finalNotes,
        trust_score: refinedGated.trustScore,
        website_id: previousWebsiteId,
        pages: finalManifest.pages,
        intent: refined.intent || "mixed",
        identified_edits: identifiedEdits,
        summary: `${refined.summary || "Applied your changes."}${extras.length ? ` Also: ${extras.join("; ")}.` : ""}`,
        images_generating: newImageSlots > 0,
        quality_notes: editNotes,
        refined: true,
      });
    }

    // ============ FRESH COMPILE PATH (also used for rebuild / new-site chat routes) ============
    let manifest: Manifest | null = null;
    // Any AI failure here (rate limit aside, already handled above) used to
    // silently drop into the generic 3-flavor fallbackManifest with no
    // signal at all -- the response looked like a normal success, so a user
    // had no way to know they got a boilerplate template instead of a real
    // generation for their business. Threaded through every response below
    // that returns `manifest` so the frontend can tell the difference.
    let usedFallback = false;
    // GAP 7 (Graceful Degradation, 2026-10-10): usedFallback alone only ever
    // told the frontend "something went wrong," never WHAT, so a customer
    // had nothing concrete to change in their next attempt. Set alongside
    // usedFallback in the catch block below.
    let fallbackReason: string | null = null;
    let visualRepairNotes: string[] = [];
    // GAP 8 (Speed & Reliability Layer): skip the expensive AI call(s)
    // entirely on an identical repeated request (a double-submit, or a
    // retry after a network blip) -- scoped by the exact brief text, so a
    // genuinely different brief (including a rebuild with new intent)
    // never collides with an older one.
    const directive = directiveBlocks(structure, strict, approvedOutline);
    // An outline the user approved (and possibly edited) is THE structure: where
    // it departs from the chosen template the user's version wins, and the
    // departure is reported on the structure check instead of being "fixed".
    const outlineDeviations = approvedOutline && structure ? findOutlineTemplateIssues(approvedOutline, structure) : [];
    const savedStructure: StructureId | null = approvedOutline && outlineDeviations.length ? null : structure;
    const floorOpts = { template: structure ?? undefined, strict, outline: approvedOutline ?? undefined };
    // Live Quality Preview Strip: the four check states, published to
    // generation_progress as each one resolves so GeneratorHome can render them.
    let checks: QualityCheck[] = initialChecks();
    const publishChecks = async (stage: string) => { if (user) await reportChecks(admin, requestId, user.id, stage, checks); };
    const generationCacheKey = user ? await generationCacheKeyFor({ compilePrompt, structure, strict, outline: approvedOutline }) : null;
    if (generationCacheKey && user) {
      manifest = await findCachedGeneration<Manifest>(admin, user.id, "website", generationCacheKey);
    }
    // The cached value already reflects GAP 7's critique-and-revise pass
    // and fact-check (only ever written AFTER both run, below) -- a hit
    // skips straight past the generation call AND the critique call.
    const servedFromCache = manifest !== null;
    if (!manifest) {
    if (user) await reportProgress(admin, requestId, user.id, "generating");
    try {
      const resp = await callAiGateway({
        // This is the single call every fresh generation is judged on, and
        // SCHEMA_DOC asks for genuinely hard creative-writing + design
        // judgment (brand-specific copy, deliberate asymmetric layout,
        // self-critique) -- exactly the "genuinely hard reasoning" case
        // ai-gateway.ts's deep tier exists for, not the fast/cheap default.
        model: gw.deepModel,
        messages: [
          { role: "system", content: `You are NazAI Website Compiler.\n\n${SCHEMA_DOC}${directive ? `\n\n${directive}` : ""}` },
          { role: "user", content: `Compile this website brief into the JSON manifest. Follow user-specified style STRICTLY; invent a distinct identity where the brief is silent. Return only the JSON object.\n\nBRIEF:\n${compilePrompt}${accountRulesBlock}` },
        ],
        temperature: strict ? 0.4 : 0.85,
        // Was missing here (present on the refine and intent-routing calls)
        // -- relying solely on the "Return STRICT JSON only" prompt
        // instruction meant a higher chance of invalid JSON on exactly the
        // call that matters most, silently dropping the whole generation
        // into the generic 3-flavor fallbackManifest below with no signal
        // to the user that they got a template instead of a real one.
        response_format: { type: "json_object" },
      }, gw);
      if (resp.status === 429 || resp.status === 402) {
        if (isProviderOutOfCredits(resp.status, await resp.clone().text().catch(() => ""))) {
          await openIncidentOnce(admin, PROVIDER_OUTAGE_KIND, OUTAGE_SUMMARY, { source: "compile-website-manifest:generate" });
          return json({ error: GENERATION_UNAVAILABLE_MESSAGE, code: "generation_unavailable" }, 503);
        }
        return json({ error: "Rate limited. Please retry in a moment." }, 429);
      }
      if (!resp.ok) throw new Error(`gateway ${resp.status}`);
      const data = await resp.json();
      const raw = data?.choices?.[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(stripFences(typeof raw === "string" ? raw : JSON.stringify(raw)));
      manifest = normalize(parsed, compilePrompt);
    } catch (err) {
      console.error("compile-website-manifest AI failure", err);
      // GAP 7 (Graceful Degradation, 2026-10-10): the one signal available
      // here for WHY the real generation failed -- surfaced instead of
      // discarded, same reasoning as compile-agent-manifest's own fix.
      const errMsg = err instanceof Error ? err.message : String(err);
      fallbackReason = /^gateway 429/.test(errMsg)
        ? "The AI gateway was rate-limited."
        : /^gateway 402/.test(errMsg)
          ? "AI credits were exhausted for this workspace."
          : /^gateway \d/.test(errMsg)
            ? "The AI gateway was unreachable."
            : "The AI's response wasn't valid JSON this time -- can happen on an unusually short or ambiguous brief.";
      manifest = fallbackManifest(compilePrompt, approvedOutline ?? (structure ? defaultOutline(structure) : null));
      usedFallback = true;
    }
    }
    if (!manifest) {
      // Unreachable in practice -- every path above either returns or
      // assigns manifest a real Manifest. Narrows the type for everything
      // below without relying on TS to trace that through the nested
      // try/catch above.
      return json({ error: "Website compilation failed unexpectedly." }, 500);
    }

    // GAP 7 (High-Quality Generation Engine): one self-critique + bounded
    // regeneration pass against a fixed quality rubric -- strictly before
    // applySafetyGate below. Never runs for a deterministic fallback
    // manifest or a cache hit (GAP 8 -- the cached value was already
    // critiqued-and-revised before it was stored). Any failure anywhere
    // in this pass keeps the original manifest unchanged.
    // Generator UX (2026-10-12): visual consistency is repaired
    // deterministically BEFORE the floor runs, so the revision calls below
    // never spend a model turn on something arithmetic can fix (contrast,
    // an unsupported variant). Applies to fresh, cached, and fallback
    // manifests alike.
    {
      const visualBefore = findVisualIssues(manifest).length;
      const visualRepair = repairVisual(manifest);
      manifest = visualRepair.manifest;
      visualRepairNotes = visualRepair.notes;
      const visualAfter = findVisualIssues(manifest).length;
      checks = setCheck(checks, "visual", statusFromCounts(visualBefore, visualAfter),
        visualRepair.notes.length ? visualRepair.notes[0] : visualAfter ? `${visualAfter} wording/rhythm issue(s) left to review` : "Palette, contrast, layout and hero variants are consistent");
    }
    const structIssuesOf = (m: Manifest) => [
      ...findStructuralIssues(m, approvedOutline ? undefined : structure ?? undefined, { outlineMode: !!approvedOutline }),
      ...(approvedOutline ? findOutlineConformanceIssues(m, approvedOutline) : []),
    ];
    const structureBefore = structIssuesOf(manifest).length;
    checks = setCheck(setCheck(checks, "structure", "checking"), "claims", "checking");
    await publishChecks("refining");

    if (!usedFallback && !servedFromCache) {
      if (user) await reportProgress(admin, requestId, user.id, "refining");
      const critiqueContext = `\n\nORIGINAL BRIEF:\n${compilePrompt.slice(0, 2000)}`;
      const isValidRevision = (candidate: Manifest) => Boolean(candidate.name && candidate.pages?.length);
      const revise = (issues: string[]): Promise<Manifest | null> =>
        reviseManifestWithIssues(gw, directive, issues, manifest!, compilePrompt);

      // Generator Quality (2026-10-11): the deterministic floor
      // (_shared/generation-floor.ts) replaces the old home-page-only
      // structural check. It covers every page's minimum structure, invented
      // testimonials/statistics, and placeholder copy -- the defects a live
      // "a bakery website" run shipped with trust_score 100 because the
      // model's own soft critique passed them. Deterministic issues force the
      // revision call directly with the exact, concrete issue list; up to TWO
      // bounded revisions run, only while issues remain, and a revision that
      // makes things worse (more issues) is discarded. The soft critique
      // (critiqueAndRevise, unchanged) still runs for tone/specificity when
      // the floor already passes.
      // Generator UX (2026-10-12): the floor also enforces the user's chosen
      // structure template, the approved outline, and (Strict Mode) the
      // strict wording/wiring/visual rules. Strict Mode gets a third attempt.
      let floorIssues = assessProfessionalFloor(manifest, compilePrompt, floorOpts).issues;
      if (floorIssues.length) {
        const maxAttempts = strict ? 3 : 2;
        for (let attempt = 0; attempt < maxAttempts && floorIssues.length; attempt++) {
          const revised = await revise(floorIssues);
          if (!revised || !isValidRevision(revised)) break;
          const repairedRevision = repairVisual(revised).manifest;
          const nextIssues = assessProfessionalFloor(repairedRevision, compilePrompt, floorOpts).issues;
          if (nextIssues.length > floorIssues.length) break;
          manifest = repairedRevision;
          floorIssues = nextIssues;
        }
      } else {
        const { result: revisedManifest } = await critiqueAndRevise(
          callAiGateway, gw, manifest, critiqueContext, revise, isValidRevision,
        );
        if (revisedManifest) manifest = repairVisual(revisedManifest).manifest;
      }
    }

    // Generator Quality LOOP 4/5: whatever survived revision, an invented
    // testimonial or statistic is removed outright (never published, never
    // merely flagged), for fresh, cached, and fallback manifests alike. What
    // the floor still finds afterward (a structurally thin page the model
    // failed to fix twice) can't be backfilled without inventing content, so
    // it is disclosed in generation_notes instead, and the result is not
    // cached so a regenerate gets a fresh attempt.
    const claimRepair = repairUngroundedClaims(manifest, compilePrompt);
    manifest = claimRepair.manifest;
    const floorNotes: string[] = [
      ...claimRepair.notes.map((n) => GUARD_PREFIX + n),
      ...visualRepairNotes.map((n) => VISUAL_FIX_PREFIX + n),
    ];
    const remainingFloorIssues = assessProfessionalFloor(manifest, compilePrompt, floorOpts).issues;
    if (remainingFloorIssues.length) {
      floorNotes.push(`Quality check: ${remainingFloorIssues.join(" ")} Ask the chat to fix this, or regenerate with more detail.`);
    }
    {
      const structureAfter = structIssuesOf(manifest);
      checks = setCheck(checks, "structure", statusFromCounts(structureBefore, structureAfter.length),
        structureAfter.length
          ? `${structureAfter.length} structure issue(s) could not be fixed automatically`
          : approvedOutline ? `Built to your approved outline${outlineDeviations.length ? ` (differs from the ${getTemplate(structure!).label} structure: ${outlineDeviations[0].replace(/^Structure "[^"]+": /, "")})` : ""}`
          : structure ? `Follows the ${getTemplate(structure).label} structure${structureBefore ? " (corrected)" : ""}` : `${manifest.pages.length} pages, complete home page${structureBefore ? " (corrected)" : ""}`);
    }

    // GAP 7: post-generation fact-check -- grounds the site's copy
    // against the brief it was actually generated from, catching an
    // invented contact detail (email/phone/URL) absent from the brief.
    // Surfaced as a visible note, never auto-stripped. Merged into
    // generationNotes alongside applySafetyGate's own notes just below.
    const factCheckNotes: string[] = [];
    {
      const ungrounded = findUngroundedFacts(JSON.stringify(manifest.pages), compilePrompt);
      if (ungrounded.length) {
        factCheckNotes.push(
          `This site's copy includes ${ungrounded.map((f) => `a ${f.kind} ("${f.value}")`).join(", ")} not found in your original brief -- verify before publishing.`,
        );
      }
    }

    // GAP 8: cache the fully critiqued, fact-checked candidate -- never
    // for a deterministic fallback or a value that just came FROM the
    // cache (would just rewrite the same row with a refreshed TTL for no
    // real benefit).
    if (generationCacheKey && user && !usedFallback && !servedFromCache && remainingFloorIssues.length === 0) {
      await storeCachedGeneration(admin, user.id, "website", generationCacheKey, manifest);
    }

    // Blueprint task #60: applied uniformly to both the AI-compiled and the
    // deterministic-fallback manifest -- the fallback is static safe copy so
    // this is a no-op for it, but a single gate point is simpler than two.
    // Also covers the REBUILD branch below, which reuses this same `manifest`.
    const freshGated = applySafetyGate(manifest, gateSafetyRules);
    if (freshGated.blocked) {
      return json({ error: "blocked_by_safety_rule", message: freshGated.blockReason }, 422);
    }
    manifest = freshGated.manifest;
    // Image-relevance quality loop (2026-10-09): a fresh compile or a full
    // rebuild has no "untouched parts" to preserve -- every asset_url here
    // either came from this request's own real attachments or was invented,
    // so verifiedImageUrls alone (no existing-pages union) is correct.
    const imageGated = enforceImageRelevance(manifest.pages, verifiedImageUrls);
    manifest = { ...manifest, pages: imageGated.pages };
    const generationNotes = [...freshGated.notes, ...floorNotes, ...factCheckNotes, ...imageGated.notes];
    {
      // Live Quality Preview Strip: claims and images resolve last.
      const removed = claimRepair.removed.length;
      checks = setCheck(checks, "claims", factCheckNotes.length ? "flagged" : removed ? "fixed" : "passed",
        factCheckNotes.length
          ? "Contact details look like placeholders — edit them before publishing"
          : removed ? `Removed ${removed} invented testimonial/statistic item(s)` : "No invented testimonials, statistics or placeholder copy");
      checks = setCheck(checks, "images", imageGated.notes.length ? "fixed" : "passed",
        imageGated.notes.length ? `Replaced ${imageGated.notes.length} unverified stock photo(s) with matching illustrations` : "No unverified stock photos; matching images are generated after saving");
    }
    await publishChecks("reviewing");
    // GAP 7 (Graceful Degradation, 2026-10-10): same surface the account
    // rules/safety-rule/image-relevance findings above already render
    // through -- a specific reason instead of a silent generic template.
    if (fallbackReason) {
      generationNotes.push(
        `This site's custom generation didn't complete, so a starter template was used instead. ${fallbackReason} Try regenerating with more specific detail about your business.`,
      );
    }

    if (!save) return json({ manifest, generation_notes: generationNotes, trust_score: freshGated.trustScore, used_fallback: usedFallback, fallback_reason: fallbackReason, quality_checks: checks });
    // A caller that asked to save (the frontend's default) but has no
    // resolved session used to fall into the same branch as "preview only"
    // above, silently returning {manifest} with no website_id and no error
    // at status 200. The frontend's own check (`!resp.ok || !body?.website_id`)
    // then had nothing to show but a generic `Website compile failed (200)` --
    // a real auth failure disguised as a mysteriously-empty success. Fail
    // loudly with the same wording compile-agent-manifest already uses for
    // this exact case.
    if (!user) return json({ error: "Not authenticated — sign in to save your website.", manifest }, 401);
    await reportProgress(admin, requestId, user.id, "saving");

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
          generation_notes: generationNotes,
          trust_score: freshGated.trustScore,
          ...(savedStructure ? { structure_template: savedStructure } : {}),
          ...(strict ? { strict_mode: true } : {}),
        })
        .eq("id", rebuildWebsiteId)
        .eq("user_id", user.id);
      if (wErr) return json({ error: wErr.message }, 500);

      await kickOffImageGeneration(String(rebuildWebsiteId), authHeader);
      return json({
        manifest,
        generation_notes: generationNotes,
        trust_score: freshGated.trustScore,
        website_id: rebuildWebsiteId,
        pages: manifest.pages,
        quality_checks: checks,
        intent: "rebuild",
        rebuilt: true,
        summary: usedFallback
          ? `${fallbackReason ?? "Something went wrong generating a custom design"} for "${manifest.name}" — showing a starter template instead. Try rebuilding again or refining it via chat.`
          : `Regenerated "${manifest.name}" from scratch — ${manifest.pages.length} page${manifest.pages.length === 1 ? "" : "s"} with a completely new design.`,
        used_fallback: usedFallback,
        fallback_reason: fallbackReason,
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
        generation_notes: generationNotes,
        trust_score: freshGated.trustScore,
        structure_template: savedStructure,
        strict_mode: strict,
        generation_stage: staged ? "content" : null,
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

    await kickOffImageGeneration(String(siteRow.id), authHeader);
    return json({
      manifest,
      generation_notes: generationNotes,
      trust_score: freshGated.trustScore,
      website_id: siteRow.id,
      pages: pagesOut,
      quality_checks: checks,
      structure: savedStructure,
      outline_deviations: outlineDeviations,
      used_fallback: usedFallback,
      fallback_reason: fallbackReason,
      ...(routeInfo.route === "new"
        ? {
            intent: "new",
            created_new: true,
            summary: usedFallback
              ? `${fallbackReason ?? "Something went wrong generating a custom design"} for "${manifest.name}" — showing a starter template instead. Try regenerating or refining it via chat.`
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
