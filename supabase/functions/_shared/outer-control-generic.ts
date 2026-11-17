// Outer Control: how generic an answer is, measured the same way wherever it is asked (the completion gate's "Gives concrete
// detail", the built-in tools' anti-generic pass). Deterministic and pure: no model call.
//
//   specificDetails(text)  the distinct concrete details: numbers and amounts, names, quoted words, links. Each counts once, so a
//                          detail repeated, a capitalised heading or a list marker does not make an answer look specific.
//   stockPhrases(text)     the phrases that would fit almost any business ("leverage", "build relationships", "target audience").
//   COMMON_WORDS           long everyday words ("already", "people") that say nothing about the person's own situation.

/** Phrases an answer can contain whatever the business: each one found is named, once. */
const STOCK: [string, RegExp][] = [
  ["leverage", /\bleverag(?:e|es|ed|ing)\b/i],
  ["utilize", /\butili[sz](?:e|es|ed|ing)\b/i],
  ["streamline", /\bstreamlin(?:e|es|ed|ing)\b/i],
  ["robust", /\brobust\b/i],
  ["seamless", /\bseamless(?:ly)?\b/i],
  ["synergy", /\bsynerg(?:y|ies)\b/i],
  ["cutting-edge", /\bcutting[- ]edge\b/i],
  ["game-changer", /\bgame[- ]chang(?:er|ing)\b/i],
  ["holistic", /\bholistic\b/i],
  ["empower", /\bempower(?:s|ed|ing)?\b/i],
  ["unlock", /\bunlock(?:s|ed|ing)? (?:the |your )?(?:potential|value|growth|success)\b/i],
  ["elevate", /\belevat(?:e|es|ed|ing) (?:your|the)\b/i],
  ["in today's …", /\bin today['’]s\b/i],
  ["ever-evolving", /\bever[- ](?:evolving|changing)\b/i],
  ["it is important to", /\bit(?:['’]s| is) (?:important|essential|crucial|vital|key) to\b/i],
  ["best practices", /\bbest practices?\b/i],
  ["build relationships", /\bbuild(?:ing)? (?:strong |lasting |meaningful )?relationships\b/i],
  ["target audience", /\btarget audiences?\b/i],
  ["engage with your audience", /\bengag(?:e|ing) with (?:your |the )?(?:audience|customers|community)\b/i],
  ["valuable insights", /\bvaluable (?:insights?|feedback|information)\b/i],
  ["stay ahead", /\bstay(?:ing)? ahead\b/i],
  ["stand out", /\bstand(?:s|ing)? out from\b/i],
  ["unique value proposition", /\bunique (?:value|selling) proposition\b/i],
  ["maximize reach", /\bmaximi[sz](?:e|ing) (?:your |the )?(?:reach|impact|potential|visibility|results)\b/i],
  ["drive growth", /\b(?:drive|fuel|foster|boost) (?:growth|engagement|success)\b/i],
  ["tailor your approach", /\btailor(?:ed|ing)? (?:your|the) (?:approach|strategy|message|offering|solution)\b/i],
  ["strong online presence", /\b(?:strong|solid|robust) (?:online |digital |social media )?presence\b/i],
  ["key to success", /\bkey (?:to|for) success\b/i],
  ["a wide range of", /\ba wide (?:range|variety) of\b/i],
  ["consider using", /\bconsider (?:using|implementing|leveraging|adopting)\b/i],
  ["high-quality content", /\bhigh[- ]quality (?:content|products?|service)\b/i],
  ["focus on the customer", /\bfocus on (?:the )?(?:customer|quality|value)\b/i],
  ["continuously improve", /\bcontinuous(?:ly)? (?:improve|improvement|refine|iterate)\b/i],
];

/** The stock phrases in a text, each named once, in the order of the list. */
export function stockPhrases(text: string): string[] {
  const t = text ?? "";
  return STOCK.filter(([, re]) => re.test(t)).map(([name]) => name);
}

/** Capitalised words that are not names: they open sentences, or every answer has them. */
const NOT_NAMES = new Set(("I AI A An The This That These Those It Its If In On At For To Of And Or But So As By With From Your You Yours We Our " +
  "They Their Them He She His Her Be Is Are Was Were Do Does Did Not No Yes All Any Each Every Some Most More Less Many Much Few One Two " +
  "First Second Third Next Then Also Use Make Start Set Build Create Get Give Keep Try Ask Check Find Write Run Add Focus Consider Offer " +
  "Step Steps Point Points Option Options Summary Conclusion Answer Assumption Assumptions Note Example Examples Risk Risks Key Findings " +
  "Details Certainty High Medium Low Why What When Where Who How Which Here There Now Today Monday Tuesday Wednesday Thursday Friday " +
  "Saturday Sunday January February March April May June July August September October November December").split(" "));

/**
 * The distinct concrete details in a text: numbers and amounts ("200 EUR", "4 weeks", "10%"), names (a capitalised word inside a
 * sentence, not a heading), quoted words and links. Each counts once.
 */
export function specificDetails(text: string): string[] {
  const out = new Set<string>();
  for (const rawLine of (text ?? "").split("\n")) {
    // A list marker, a heading line ("Key findings:", "NEXT STEPS") or a "Label:" opening is structure, not detail.
    const line = rawLine.replace(/^\s*(?:[-*•]|\d{1,2}[.)]|#{1,6})\s+/, "");
    const words = line.trim().split(/\s+/).filter(Boolean);
    const heading = /:\s*$/.test(line) || (!/[a-z]/.test(line) && /[A-Z]/.test(line)) || (words.length <= 6 && !/[.!?]\s*$/.test(line) && words.every((w) => /^[A-Z0-9]/.test(w)));
    for (const m of line.matchAll(/https?:\/\/[^\s)]+/gi)) out.add(`url:${m[0].toLowerCase()}`);
    for (const m of line.matchAll(/["“]([^"”]{2,60})["”]/g)) out.add(`quote:${m[1].toLowerCase()}`);
    for (const m of line.matchAll(/[€$£]?\d[\d.,]*(?:\s?(?:%|percent|k|m|eur|euros?|usd|dollars?|gbp|days?|weeks?|months?|years?|hours?|minutes?|h|min|people|customers?|users?|clients?|shops?|posts?|calls?|emails?))?/gi)) {
      out.add(`num:${m[0].toLowerCase().replace(/\s+/g, " ").replace(/[.,]$/, "")}`);
    }
    if (heading) continue;
    for (const sentence of line.replace(/^[^:]{1,40}:\s+/, "").split(/(?<=[.!?])\s+/)) {
      sentence.split(/\s+/).filter(Boolean).forEach((tok, i) => {
        const w = tok.replace(/^[^\p{L}]+|[^\p{L}\p{N}]+$/gu, "");
        if (i === 0 || w.length < 2 || !/^\p{Lu}/u.test(w) || NOT_NAMES.has(w)) return;
        out.add(`name:${w.toLowerCase()}`);
      });
    }
  }
  return [...out];
}

/** Long everyday words that say nothing about a person's own situation, so a reply does not "use the context" by repeating them. */
export const COMMON_WORDS = new Set(("already always another around because before between business customers customer during enough " +
  "everyone everything others people person really rather should simply something someone things through usually within without " +
  "actually almost little months weeks working product products service services online market launch launched startup company").split(" "));
