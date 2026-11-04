// Safe input & output handling, front 6: the speed budget. Every check added by fronts 1-4 runs on each request or each model reply;
// together they must stay invisible to users. Each is timed on a realistic input over many runs, and the 95th percentile must stay
// under 5 ms (measured on CI hardware, so the real servers are faster). Hostile inputs get a looser bound: they must never be slow.
import { readJson, parseBody } from "./input.ts";
import { object, text, optional, array, oneOf } from "./schema.ts";
import { cleanText } from "./clean-text.ts";
import { guardOutputText } from "./output-guard.ts";
import { fenceUntrusted } from "./untrusted-input.ts";
import { parseModelJson } from "./model-output.ts";
import { sanitizeSectionContent } from "./site-content-guard.ts";
import { HOSTILE_CASES, p95 } from "./hostile-corpus.ts";
import { cleanLogString } from "./redact-console.ts";

const BUDGET_MS = 5;
const RUNS = 300;

async function measure(fn: () => unknown | Promise<unknown>, runs = RUNS): Promise<number> {
  for (let i = 0; i < 20; i++) await fn(); // warm up
  const ms: number[] = [];
  for (let i = 0; i < runs; i++) { const t0 = performance.now(); await fn(); ms.push(performance.now() - t0); }
  return p95(ms);
}
const within = (name: string, ms: number, budget = BUDGET_MS) => { if (ms > budget) throw new Error(`${name}: p95 ${ms.toFixed(2)} ms is over the ${budget} ms budget`); };

const para = "We are a family bakery in Hamburg. We bake sourdough, rye and croissants every morning, and deliver to cafés nearby. ";
const requestBody = JSON.stringify({ prompt: para.repeat(30), mode: "build", messages: Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: para.repeat(3) })) });
const chatShape = object({ prompt: optional(text({ max: 12000, clip: true })), mode: optional(oneOf(["plan", "build", "ask"] as const)), messages: optional(array(object({ role: text({ max: 20 }), content: text({ max: 30000, clip: true }) }), { max: 40, clip: true })) });
const answer = `## Plan\n\n${para.repeat(10)}\n\n- **Step one**: [docs](https://docs.example.com/a)\n- Step two ![chart](https://abc.supabase.co/x.png)\n\n\`\`\`js\nconsole.log("<b>hi</b>")\n\`\`\`\n`.repeat(3);
const page = (para + "\n").repeat(70);
const modelReply = "Sure! Here it is:\n```json\n" + JSON.stringify({ questions: [{ id: "q1", question: "Which inbox?", options: ["a", "b", "c"] }, { id: "q2", question: para }], notes: para.repeat(5) }) + "\n```";
const section = { headline: "Fresh bread ~every~ morning", subheadline: para, cta_primary: "Order", cta_primary_href: "contact", asset_url: "https://abc.supabase.co/a.png", items: Array.from({ length: 8 }, (_, i) => ({ title: `Item ${i}`, description: para, image_prompt: para })) };
const anyObj = object({}, { unknown: "keep" });

Deno.test("speed budget: reading and checking a typical request body (8 KB) is under 5 ms at p95", async () => {
  within("readJson + schema", await measure(() => parseBody(new Request("https://x.test/f", { method: "POST", body: requestBody }), chatShape)));
});
Deno.test("speed budget: cleaning a 4 KB text is under 5 ms at p95", async () => { within("cleanText", await measure(() => cleanText(para.repeat(35), { max: 8000 }))); });
Deno.test("speed budget: guarding a 7 KB model answer before delivery is under 5 ms at p95", async () => { within("guardOutputText", await measure(() => guardOutputText(answer))); });
Deno.test("speed budget: fencing and scanning an 8 KB web page is under 5 ms at p95", async () => { within("fenceUntrusted", await measure(() => fenceUntrusted(page, { max: 8000 }))); });
Deno.test("speed budget: reading a model's JSON reply is under 5 ms at p95", async () => { within("parseModelJson", await measure(() => parseModelJson(modelReply, anyObj))); });
Deno.test("speed budget: checking a website section is under 5 ms at p95", async () => { within("sanitizeSectionContent", await measure(() => sanitizeSectionContent(section))); });
Deno.test("speed budget: cleaning a log line is under 5 ms at p95", async () => { within("cleanLogString", await measure(() => cleanLogString(page))); });

Deno.test("speed budget: every hostile request is refused or cleaned in under 50 ms (they must never be slow)", async () => {
  for (const c of HOSTILE_CASES) within(`hostile: ${c.name}`, await measure(() => readJson(new Request("https://x.test/f", { method: "POST", body: c.body })), 20), 50);
});
