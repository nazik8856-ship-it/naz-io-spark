// Structure-aware starter pages for the deterministic fallback.
//
// When the AI gateway is down, compile-website-manifest still saves a real site
// from a built-in starter manifest. That starter used to be one fixed 3-page
// shape, so a user who had picked "Pricing-focused" (or approved their own
// outline) could receive a site with no pricing page at all while the saved
// record claimed the template. This module builds the starter's PAGES from the
// chosen template's default outline, or from the user's approved outline, so
// the fallback satisfies the same structure rules a normal generation must.
//
// Copy is generic by design and invents nothing: no prices, no testimonials,
// no statistics, no contact details. Pricing tiers say "Ask for a quote".
// Every button points at a page that exists in the outline.
import type { Outline, OutlineSection } from "./generation-templates.ts";

type Item = Record<string, unknown>;
export type StarterSection = { type: string; variant?: string; content: Record<string, unknown> };
export type StarterPage = { slug: string; title: string; seo_description: string; sections: StarterSection[] };

const PRICING_RE = /pric|plan|package|rate|membership/;

/** The slug the home page's main button should open: pricing first, else the first real content page, else contact. */
function primaryTarget(outline: Outline): string {
  const others = outline.pages.filter((p) => p.slug !== "home");
  const pricing = others.find((p) => PRICING_RE.test(p.slug));
  if (pricing) return pricing.slug;
  const content = others.find((p) => p.slug !== "contact");
  return content?.slug ?? "contact";
}

const items = (n: number, make: (i: number) => Item): Item[] => Array.from({ length: n }, (_, i) => make(i));

// Each section type has a few headings so the same type on two pages never
// repeats its wording (Strict Mode rejects a heading used on two pages).
const pick = (pool: string[], occurrence: number) => pool[occurrence % pool.length];

function build(section: OutlineSection, ctx: { name: string; offering: string; isHome: boolean; target: string; pageTitle: string; index: number; occurrence: number }): StarterSection | null {
  const { name, offering, isHome, target, pageTitle, occurrence } = ctx;
  const variant = section.variant;
  const base = (content: Record<string, unknown>): StarterSection => ({ type: section.type, ...(variant ? { variant } : {}), content });
  switch (section.type) {
    case "hero":
      return base({
        eyebrow: isHome ? "Welcome" : pageTitle,
        headline: isHome ? `Meet ~${name}~.` : `${pageTitle} at ~${name}~.`,
        subheadline: `Discover ${offering} shaped around the people who expect more from every detail.`,
        cta_primary: target === "contact" ? "Get in touch" : "Explore",
        cta_primary_href: target,
        cta_secondary: "Contact us",
        cta_secondary_href: "contact",
        image_prompt: `${name}, welcoming editorial composition, natural light, authentic details`,
        media_style: "illustration",
      });
    case "about":
      return base({
        heading: pick([`About ~${name}~`, `The story behind ~${name}~`, "Who we ~are~"], occurrence),
        body: `${name} is built around ${offering}, with care taken over every detail. Tell us what you need and we will point you to the right next step.`,
        bullets: ["A clear, focused offer", "Details shaped around real needs", "Easy to reach and quick to respond"],
        image_prompt: `${name}, people at work, candid natural light`,
        media_style: "illustration",
      });
    case "feature-split":
      return base({
        heading: pick([`What ${name} is ~about~`, "Why it ~matters~", "What sets us ~apart~"], occurrence),
        body: `Every part of ${name} is designed to feel coherent, useful, and easy to act on.`,
        bullets: ["A focused, memorable identity", "Details shaped around real needs", "Clear paths from interest to action"],
        image_prompt: `${name}, close-up of the work, refined craftsmanship`,
        media_style: "pattern",
        reverse: ctx.index % 2 === 1,
      });
    case "services":
      return base({
        heading: pick(["What we ~offer~", "How we ~help~", "Our services in ~detail~"], occurrence),
        items: [
          { title: "Purposeful craft", description: "Every choice supports a clear outcome instead of adding noise.", image_prompt: `${name}, purposeful craft, detail shot` },
          { title: "Personal attention", description: "A thoughtful experience that respects context, taste, and time.", image_prompt: `${name}, personal attention, friendly interaction` },
          { title: "Lasting quality", description: "Work designed to stay useful long after the first impression.", image_prompt: `${name}, lasting quality, finished result` },
        ],
      });
    case "gallery":
      return base({
        heading: pick(["A closer ~look~", "Selected ~work~", "More from the ~studio~"], occurrence),
        items: items(3, (i) => ({ caption: ["The work", "The details", "The result"][i], image_prompt: `${name}, ${["the work in progress", "close-up details", "the finished result"][i]}, natural light` })),
      });
    case "process":
      return base({
        heading: pick(["How it ~works~", "The process, step by ~step~", "What to ~expect~"], occurrence),
        steps: [
          { title: "Tell us what you need", description: "Share a few details about what you are looking for." },
          { title: "We propose a plan", description: "You get a clear option without unnecessary complexity." },
          { title: "We deliver", description: "We follow through and stay in touch until you are happy." },
        ],
      });
    case "faq":
      return base({
        heading: pick(["Good questions, ~clear answers~", "Common ~questions~", "Before you ~decide~"], occurrence),
        items: [
          { q: "How quickly will you reply?", a: "We aim to respond within one business day." },
          { q: "Can I ask for something custom?", a: "Yes. Tell us what you have in mind and we will explain the best route." },
          { q: "Where should I begin?", a: "Start with the contact form and describe the outcome you want." },
        ],
      });
    case "pricing":
      return base({
        heading: pick(["Plans to ~choose~ from", "Compare the ~options~"], occurrence),
        tiers: [
          { name: "Starter", price: "Ask for a quote", features: ["Core offer", "Clear scope"], cta: "Get in touch", cta_href: "contact" },
          { name: "Standard", price: "Ask for a quote", features: ["Everything in Starter", "More flexibility"], cta: "Get in touch", cta_href: "contact", featured: true },
          { name: "Premium", price: "Ask for a quote", features: ["Everything in Standard", "Priority support"], cta: "Get in touch", cta_href: "contact" },
        ],
      });
    case "cta":
      return base({
        headline: pick(["Ready to ~get started~?", "Let us ~talk~ it through", "Take the ~next step~"], occurrence),
        subheadline: `Tell ${name} what you need and get a clear next step.`,
        cta_primary: "Contact us",
        cta_primary_href: "contact",
        cta_secondary: target === "contact" ? undefined : "Learn more",
        cta_secondary_href: target === "contact" ? undefined : target,
      });
    case "contact":
      return base({
        heading: `We would love to ~hear from you~`,
        body: "Share a few details and we will respond with a clear next step.",
        form_fields: ["Name", "Email", "What can we help with?"],
      });
    default:
      return null;
  }
}

/** Starter pages that follow `outline`. Sections of unknown types are skipped. */
export function startersFromOutline(outline: Outline, meta: { name: string; offering: string }): StarterPage[] {
  const target = primaryTarget(outline);
  const seen: Record<string, number> = {};
  return outline.pages.map((page, pi) => ({
    slug: page.slug,
    title: page.title,
    seo_description: `${page.title} — ${meta.name}. ${meta.offering[0].toUpperCase()}${meta.offering.slice(1)}.`.slice(0, 160),
    sections: page.sections
      .map((s, si) => {
        const occurrence = seen[s.type] ?? 0;
        seen[s.type] = occurrence + 1;
        return build(s, { ...meta, isHome: pi === 0, target, pageTitle: page.title, index: si, occurrence });
      })
      .filter((s): s is StarterSection => s !== null)
      .map((s) => {
        // Drop keys whose value is undefined so the saved JSON stays clean.
        const content = Object.fromEntries(Object.entries(s.content).filter(([, v]) => v !== undefined));
        return { ...s, content };
      }),
  }));
}
