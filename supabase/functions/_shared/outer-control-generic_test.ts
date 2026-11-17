// Run with: deno test --no-check supabase/functions/_shared/outer-control-generic_test.ts
// How generic an answer is (outer-control-generic.ts), and the completion gate's "Gives concrete detail" built on it (Day 3, #155).
import { specificDetails, stockPhrases } from "./outer-control-generic.ts";
import { assessSpecific, contextTerms } from "./outer-control-completion.ts";

function assert(c: unknown, m: string) { if (!c) throw new Error(m); }

// ChatGPT's research answer of 16 Nov 2026 (1937a8fa), as text: looks structured, fits any business.
const GENERIC = `KEY FINDINGS
- Identify a Specific Niche: Small AI startups should focus on a specific niche within the industry to effectively target early adopters. (Certainty: High - Based on common startup strategies and market segmentation best practices.)
- Leverage Existing Tools: Utilize low-cost or free tools for outreach and customer management such as LinkedIn and HubSpot CRM. (Certainty: High - Widely recommended tools in startup circles.)
- Create a Minimum Viable Product (MVP): Develop a basic version of the product that meets the primary need of your niche market. (Certainty: High)
- Network in Industry-specific Events & Online Communities: Participate in forums, LinkedIn groups, and events related to your target audience to build relationships. (Certainty: Medium)
- Use Initial Feedback for Refinement: Gather detailed feedback from early adopters to refine your product and continuously improve its value. (Certainty: High)
- Referral Programs: Implement a referral strategy offering discounts or incentives for referrals. (Certainty: Medium)

WHAT THIS MEANS FOR YOU
Operating within the constraints of 1 person and a €200 monthly budget, focus on highly targeted marketing and efficient use of time. Use free tools and online platforms to maximize reach and ensure your MVP is clear and accessible.`;

// The same question answered for the person: names, amounts, who to contact and when.
const SPECIFIC = `Your best first 10 customers are owners of 5-20 person agencies in Vienna and Graz who already pay for ChatGPT Plus.
1. This week: list 40 such agencies from the WKO member directory and LinkedIn Sales Navigator (free trial, 30 days).
2. Send 10 personal emails a day for 4 days, offering a 30-minute setup call and a €49 first month instead of €99.
3. Book the calls in Calendly; aim for 8 calls from 40 emails (a 20% reply rate is a typical upper estimate, not a promise).
4. At each call, install the product on one real workflow, for example "summarise yesterday's client emails into a Notion page".
5. After 2 weeks, ask the 3 happiest users for one named referral each.
Budget: €200 covers Sales Navigator after the trial (about €80) and €120 of ads on one LinkedIn post aimed at "agency owner" titles in Austria.`;

const CONTEXT = "Stage of the business: Product works, not launched yet, 0 paying customers\nWho it is for: Small business owners who already use ChatGPT at work\nMain limit: 1 person, 200 EUR a month, launch in 4 weeks";
const REQUEST = "How should a small AI startup get its first 10 paying customers?";

Deno.test("stock phrases are named once each; a specific answer has none", () => {
  const s = stockPhrases(GENERIC);
  for (const p of ["leverage", "utilize", "best practices", "target audience", "build relationships", "maximize reach", "continuously improve"]) assert(s.includes(p), `${p} in ${s}`);
  assert(stockPhrases(SPECIFIC).length === 0, stockPhrases(SPECIFIC).join(","));
});

Deno.test("concrete details are distinct: headings, list labels and sentence openings are not names, a repeated number counts once", () => {
  assert(specificDetails("KEY FINDINGS\n- Identify A Niche: Focus On It.\nNEXT STEPS").length === 0, specificDetails("KEY FINDINGS\n- Identify A Niche: Focus On It.").join(","));
  assert(specificDetails("Spend €200. Then spend €200 again. Ask Anna at Etsy.").sort().join(",") === "name:anna,name:etsy,num:€200", specificDetails("Spend €200. Then spend €200 again. Ask Anna at Etsy.").join(","));
  assert(specificDetails(SPECIFIC).length >= 15, String(specificDetails(SPECIFIC).length));
});

Deno.test("the gate: yesterday's structured but generic answer now fails 'Gives concrete detail'; the specific one passes", () => {
  const scope = { request: REQUEST, context: CONTEXT, checks: ["context_used", "concrete"] as ("context_used" | "concrete")[] };
  const g = assessSpecific(GENERIC, scope)!;
  const gc = g.checks.find((c) => c.id === "concrete")!;
  assert(!gc.ok && /fit any business/.test(gc.detail) && /leverage/.test(gc.detail), gc.detail);
  const s = assessSpecific(SPECIFIC, scope)!;
  assert(s.ok, JSON.stringify(s.checks));
});

Deno.test("a short answer is checked too (from 80 words, not 150), and padding with headings does not pass it", () => {
  const short = "OVERVIEW\nFocus on your niche and leverage existing tools to build relationships with your target audience. ".repeat(1) +
    "It is important to stay ahead of the market and maximize reach through a strong online presence. Use best practices, gather valuable insights and continuously improve. " +
    "Consider using social channels and engage with your audience regularly so that the business grows and the customers stay with you for a long time. " +
    "Over time this approach will help you understand what works, refine the offer and keep the momentum going as the company moves forward.";
  const q = assessSpecific(short, { request: REQUEST, context: null, checks: ["concrete"] })!;
  assert(q && !q.ok, JSON.stringify(q));
});

Deno.test("'uses your context' no longer counts everyday words like 'already' or 'people' as the person's situation", () => {
  const terms = contextTerms(CONTEXT, REQUEST);
  assert(!terms.includes("already"), terms.join(","));
  assert(terms.includes("chatgpt"), terms.join(","));
});
