// Run with: deno test --no-check supabase/functions/_shared/inner-chat-rule_test.ts
// Inner Control Day 1 (#167): a rule drafted in the chat from plain words; nothing is saved here.
import { describeDraft, draftFromArgs, phrasesPattern, RULE_SCOPES } from "./inner-chat-rule.ts";

function assert(c: unknown, m: string) { if (!c) throw new Error(m); }

Deno.test("a text rule: NazAI builds the pattern from plain words; it matches whole words, any case, and never empty text", () => {
  const d = draftFromArgs({ type: "text", name: "No prices to customers", phrases: ["Price", "prices", "price", "€", "x", "special offer", "a.*"], action: "block" });
  if (!d.ok) throw new Error(d.reason);
  if (d.draft.type !== "text") throw new Error("type");
  assert(d.draft.phrases.join("|") === "price|prices|€|special offer|a.*", d.draft.phrases.join("|"));
  const re = new RegExp(d.draft.pattern, "i"); // as the safety scanner matches
  for (const hit of ["The PRICE is fair", "prices start at 10", "only 5 €", "a Special   Offer today", "use a.* here"]) assert(re.test(hit), hit);
  for (const miss of ["", "priceless memories", "our apricot jam", "a cat"]) assert(!re.test(miss), `should not match: ${miss}`);
  assert(!new RegExp(d.draft.pattern).test(""), "never matches empty text");
  assert(/\\\.\\\*/.test(d.draft.pattern), "the model's characters are escaped, not used as a pattern");
});

Deno.test("an action rule: known scopes only, block unless 'hold for approval' was asked", () => {
  const d = draftFromArgs({ type: "action", text: "  Never email customers on Sundays ", scope: "send_email", effect: "always_require_approval" });
  assert(d.ok && d.draft.type === "action" && d.draft.text === "Never email customers on Sundays" && d.draft.scope === "send_email" && d.draft.effect === "always_require_approval", JSON.stringify(d));
  const odd = draftFromArgs({ type: "action", text: "Stop deploys", scope: "drop table", effect: "whatever" });
  assert(odd.ok && odd.draft.type === "action" && odd.draft.scope === "*" && odd.draft.effect === "always_block", JSON.stringify(odd));
  assert(Object.keys(RULE_SCOPES).includes("*"), "any action");
});

Deno.test("too little to go on is a question back, not a rule", () => {
  const a = draftFromArgs({ type: "text", phrases: [] });
  assert(!a.ok && /words or phrases/.test(a.reason), JSON.stringify(a));
  const b = draftFromArgs({ type: "action", text: "x" });
  assert(!b.ok && /few words/.test(b.reason), JSON.stringify(b));
});

Deno.test("the draft in plain words always says nothing is saved yet", () => {
  const t = draftFromArgs({ type: "text", name: "No prices", phrases: ["price"], action: "redact" });
  if (!t.ok) throw new Error("t");
  assert(describeDraft(t.draft) === "New rule “No prices”: when a reply contains “price”, it removes the matching words from the reply. Nothing is saved until you press Save.", describeDraft(t.draft));
  const a = draftFromArgs({ type: "action", text: "Never email on Sundays", scope: "send_email" });
  if (!a.ok) throw new Error("a");
  assert(describeDraft(a.draft) === "New rule: “Never email on Sundays”. It blocks sending email. Nothing is saved until you press Save.", describeDraft(a.draft));
  const lp = phrasesPattern(["ab", "abc"]);
  assert(lp.indexOf("abc(") < lp.indexOf("ab(?!"), lp);
});
