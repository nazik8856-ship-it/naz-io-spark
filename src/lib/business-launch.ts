/**
 * Business Launch detection + directive.
 *
 * When the user's prompt clearly signals intent to start, found, or launch a
 * new business / company / startup / SaaS / brand, the Dashboard automatically
 * activates Pro Designer + Antifragile modes (tier permitting) and prepends a
 * supercharged "Business Launch" directive so the AI returns a complete
 * launch-grade package: name + tagline + positioning, branding, premium
 * website, business plan summary, financial projections, marketing assets.
 *
 * NOTE: kept intentionally permissive. Edits / iteration prompts are filtered
 * out at the call-site because the Dashboard detects iteration mode first.
 */
import type { TierId } from "./credit-tiers";

/** Phrases that strongly indicate a fresh business-launch request. */
const LAUNCH_PATTERNS: RegExp[] = [
  /\b(start|starting|launch|launching|found|founding|build|building|create|creating|kick\s*off|bootstrap)\s+(a|an|my|our|the)?\s*(new\s+)?(business|company|startup|start[-\s]?up|saas|brand|venture|agency|micro[-\s]?saas|shop|store|firm|studio)\b/,
  /\b(business|startup|saas|company)\s+idea\s+(for|about|around)\b/,
  /\bi\s+(want|wanna|need|would\s+like|am\s+looking)\s+to\s+(start|launch|build|create|found)\s+(a|an|my|our|the)?\s*(new\s+)?(business|company|startup|saas|brand|venture)\b/,
  /\bi\s+(want|wanna|need|would\s+like)\s+to\s+build\s+(a|an|my|our|the)?\s*(company|business|startup|brand|saas|product)\b/,
  /\b(new|my\s+new|our\s+new)\s+(business|company|startup|saas|brand|venture)\b/,
  /\b(launch\s+my|launch\s+a|launch\s+the)\s+(business|company|startup|brand|saas|product|venture)\b/,
  /\bbusiness\s+(plan|launch|blueprint)\b/,
  /\bgo[-\s]?to[-\s]?market\b/,
];

/** True when the prompt clearly intends to launch a brand-new business. */
export const detectBusinessIntent = (prompt: string): boolean => {
  const text = (prompt || "").toLowerCase().trim();
  if (text.length < 6) return false;
  return LAUNCH_PATTERNS.some((rx) => rx.test(text));
};

/** Tier-aware feature ceiling for the launch package. */
const tierCeiling = (tier: TierId) => {
  if (tier === "explorer") {
    return {
      label: "Explorer (Limited)",
      website: "Single-page basic website with the NazAI watermark in the footer. Limit to 3 sections (hero, value prop, CTA). Use a single accent color, system fonts only.",
      branding: "Provide ONE logo concept (text-based, monochrome) + a simple 3-color palette. No additional variations.",
      plan: "Provide a 5-bullet condensed business plan summary only.",
      financials: "Provide a single-year revenue + cost rough estimate (3 lines max).",
      marketing: "Suggest 2 starter marketing assets (1 social headline + 1 email subject).",
      footerNote: "End the website footer with: \"Built with NazAI — Upgrade to Operator/Titan to unlock full Business Launch.\"",
    };
  }
  if (tier === "operator") {
    return {
      label: "Operator (Full)",
      website: "Premium multi-section website (sticky nav, hero, trust bar, value prop, services, social proof, about, strong CTA, footer). Tailored palette + typography. No watermark.",
      branding: "Provide 3 logo concept directions (described visually), full color palette (primary, secondary, accent, neutrals — HSL), and a typography pairing (heading + body).",
      plan: "Full business plan summary: problem, solution, target audience, USP, business model, GTM strategy, key milestones (90/180/365 days).",
      financials: "12-month revenue, cost, and gross margin projection table + key assumptions.",
      marketing: "Pack of 5 starter assets: 1 landing headline set, 2 social posts, 1 cold email, 1 launch announcement.",
      footerNote: "",
    };
  }
  return {
    label: "Titan (Max)",
    website: "Best-in-class bespoke website. Multi-section premium design with sophisticated micro-interactions, refined typography hierarchy, accessible color system, and conversion-optimized copy. No watermark.",
    branding: "Provide 5 distinct logo concept directions, complete brand system (palette w/ semantic tokens, typography scale, voice & tone, do/don't), and motion guidelines.",
    plan: "Comprehensive business plan: problem, solution, ICP, USP, competitive analysis (table), revenue model, pricing tiers, GTM, channels, hiring plan, risks, milestones (30/60/90/180/365).",
    financials: "24-month projection table (revenue, COGS, OPEX, gross margin, net), CAC/LTV assumptions, breakeven analysis.",
    marketing: "Full starter pack: 3 hero copy variants, 5 social posts, 2 cold email sequences, 1 launch press blurb, 1 SEO meta set, 1 product hunt launch copy.",
    footerNote: "",
  };
};

/**
 * Build the supercharged Business Launch system directive, prepended to the
 * normal master prompt. Returns "" when intent is not detected — caller can
 * unconditionally concatenate.
 */
export const buildBusinessLaunchDirective = (
  prompt: string,
  tier: TierId,
): string => {
  if (!detectBusinessIntent(prompt)) return "";
  const ceil = tierCeiling(tier);
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return (
    `[PRIORITY_DIRECTIVE: BUSINESS_LAUNCH_MODE | TIER: ${ceil.label} | NONCE: ${nonce}]\n` +
    `The user is launching a brand-new business. Treat this as a complete ` +
    `launch package — not a single deliverable. IGNORE any previous ` +
    `generations, cached templates, saved comfort designs, or prior style ` +
    `tokens. Build everything fresh from the user's specific idea.\n\n` +
    `Deeply understand the idea first, then produce ALL sections below in one structured response.\n\n` +
    `## REQUIRED SECTIONS (in order)\n` +
    `1. **Idea Understanding** — 2-3 sentences confirming the business, target audience, and unique angle you inferred.\n` +
    `2. **Brand Identity** — proposed business name (3 options, pick the strongest), tagline, one-line positioning statement.\n` +
    `3. **Visual Branding** — ${ceil.branding}\n` +
    `4. **Website** — ${ceil.website} ${ceil.footerNote}\n` +
    `   Output the website as ONE complete standalone HTML document inside a single \`\`\`html fenced block (inline CSS/JS, renders in iframe srcDoc). No prose inside the fence. The site must be 100% original — unique palette, typography, section order, and copy crafted specifically for THIS business.\n` +
    `5. **Business Plan Summary** — ${ceil.plan}\n` +
    `6. **Financial Projections** — ${ceil.financials} Use a clean Markdown table.\n` +
    `7. **Initial Marketing Assets** — ${ceil.marketing}\n\n` +
    `Quality bar: this output must feel like a senior founder + designer + ` +
    `strategist team handed the user a turnkey launch kit. No filler, no ` +
    `generic templates, no AI-sounding copy, no reused layouts. Be specific ` +
    `to the user's idea — every word and pixel must reflect it.\n\n`
  );
};
