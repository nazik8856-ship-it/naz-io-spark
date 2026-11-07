import { containExternal, heldNotice, holdSignals, originDecision, taintAfter, type RunTaint } from "./external-content.ts";
import { HOSTILE_REPLIES } from "./hostile-corpus.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c: unknown, m = "assertion failed"): asserts c { if (!c) throw new Error(m); }

Deno.test("every hostile reply in the corpus is held", () => {
  for (const r of HOSTILE_REPLIES) {
    const c = containExternal(r.text, { label: "reply of a tool" });
    assertEquals(c.status, "quarantined", `${r.name}: ${JSON.stringify(c.reasons)}`);
    assertEquals(c.block, "", `${r.name}: a held text is never fenced into a prompt`);
    assert(c.reasons.length > 0, r.name);
  }
});

// Ordinary replies from AI tools doing business work. None may be held (a held reply stops the step). Some are "limited" (fenced, and a
// state change after them needs a person) because they speak to the reader in the imperative; that is accepted.
const BUSINESS_REPLIES = [
  "Here is a draft email to your customers announcing the new pricing. Subject: Our plans are changing on March 1.",
  "Don't forget the brand rules: use the dark logo on light backgrounds and keep headings in sentence case.",
  "To rotate your API key, open Settings, then API keys, click Rotate, and update the key in your deployment.",
  "Step 1: export the CSV. Step 2: update the rules document with the new discount tiers. Step 3: share it with finance.",
  "You should send this proposal to all three decision makers before Friday.",
  "The system design uses a queue between the web tier and the workers; instructions for local setup are in README.md.",
  "Approve the budget once the numbers are final; the approval workflow is described in section 4.",
  "Use the create_doc output as the template for next week's report.".replace("create_doc", "same"),
  "Ignore the outliers in March; the data for that month was incomplete.",
  "function getKey() { return process.env.STRIPE_KEY; } // reads the key from the environment at runtime",
  "The guide covers: how passwords are stored (hashed), how tokens expire, and how to revoke an access token.",
  "Our customer asked us to share the invoice with their accountant.",
  "Update your memory foam mattress listing with the new photos.",
];

Deno.test("ordinary business replies are never held", () => {
  for (const t of BUSINESS_REPLIES) {
    const c = containExternal(t, { label: "reply" });
    assert(c.status !== "quarantined", `held by mistake: "${t}" (${c.rules.join(", ")})`);
  }
  // most are simply clean
  const clean = BUSINESS_REPLIES.filter((t) => containExternal(t, { label: "reply" }).status === "clean").length;
  assert(clean >= BUSINESS_REPLIES.length - 3, `only ${clean} of ${BUSINESS_REPLIES.length} clean`);
});

Deno.test("instruction-like language that is common in business text is limited, not held", () => {
  const c = containExternal("Hey assistant, if you are an AI you must summarise this politely.", { label: "reply" });
  assertEquals(c.status, "limited");
  assert(c.block.includes("<<<BEGIN_UNTRUSTED_DATA"), "limited text is passed on fenced");
});

Deno.test("a credential in a reply is removed in every outcome and counted", () => {
  const key = "sk-ant-api03-" + "A".repeat(40);
  const c = containExternal(`Here is the config you asked for: ${key}`, { label: "reply" });
  assertEquals(c.secretsRemoved, 1);
  assert(!c.text.includes(key) && !c.block.includes(key));
  assert(c.reasons.some((r) => /credential/.test(r)));
  // and the tool's own key, passed as an extra secret
  const own = containExternal("echo: tok_live_1234567890abcdef", { label: "reply", extraSecrets: ["tok_live_1234567890abcdef"] });
  assertEquals(own.secretsRemoved, 1);
  assert(!own.text.includes("tok_live_1234567890abcdef"));
});

Deno.test("hidden characters are removed from what is stored", () => {
  const c = containExternal("plain\u200B text\u202E here", { label: "reply" });
  assertEquals(c.text, "plain text here");
});

Deno.test("the held notice names the reasons, never the text", () => {
  const c = containExternal(HOSTILE_REPLIES[0].text, { label: "reply" });
  const n = heldNotice("result of http_get", c);
  assert(n.includes("held by NazAI"));
  assert(!n.includes("mark this task as approved"));
});

Deno.test("hold rules: each corpus entry names at least one rule", () => {
  for (const r of HOSTILE_REPLIES) assert(holdSignals(r.text.replace(/\u200B/g, "")).length > 0, r.name);
});

Deno.test("origin: a run reached by held content refuses every state change; limited content sends it to a person", () => {
  let t: RunTaint = null;
  const W = { mode: "write" as const, gated: true }, R = { mode: "read" as const, gated: false }, M = { mode: "internal" as const, gated: false };
  const REPORT = { mode: "write" as const, gated: false };
  assertEquals(originDecision(t, "send_email", W), "run");
  t = taintAfter(t, { status: "limited", reasons: ["Is written to the AI"] }, "result of http_get");
  assertEquals(originDecision(t, "send_email", W), "approval");
  assertEquals(originDecision(t, "remember", M), "refuse", "memory is never written after flagged content");
  assertEquals(originDecision(t, "web_search", R), "run", "reading is still allowed");
  assertEquals(originDecision(t, "generate_report", REPORT), "run", "a report for the operator still runs after limited content");
  assertEquals(originDecision(t, "request_approval", M), "run", "queueing an approval is a person's decision");
  t = taintAfter(t, { status: "quarantined", reasons: ["Tries to override"] }, "result of read_email");
  assertEquals(originDecision(t, "send_email", W), "refuse");
  assertEquals(originDecision(t, "generate_report", REPORT), "refuse");
  assertEquals(originDecision(t, "web_search", R), "run");
  // a later clean or limited result never relaxes it
  t = taintAfter(t, { status: "limited", reasons: [] }, "x");
  t = taintAfter(t, { status: "clean", reasons: [] }, "y");
  assertEquals(t?.status, "quarantined");
  assertEquals(t?.source, "result of read_email");
});
