// Run with: deno test supabase/functions/_shared/outer-control-diff_test.ts
import { controlDiff, diffForReply, MAX_DIFF_CHARS, type DiffRule } from "./outer-control-diff.ts";
import { BUILTIN_SAFETY_RULES } from "./safety-scanner.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }

const secret: DiffRule = { ...BUILTIN_SAFETY_RULES.find((r) => r.id === "builtin:secret_key")!, effect: "redact" };
const card: DiffRule = { ...BUILTIN_SAFETY_RULES.find((r) => r.id === "builtin:card_number")!, effect: "redact" };
const price: DiffRule = { id: "r-price", name: "No prices", category: "custom", pattern: "\\$\\d+", effect: "block" };
const codename: DiffRule = { id: "p-1", name: "Hide the codename", category: "custom", pattern: "Falcon", effect: "redact" };
const KEY = "sk-ant-api03-" + "x".repeat(30);

Deno.test("removed spans keep only a label and the rule; flagged spans keep their text", () => {
  const d = controlDiff(`Falcon costs $40. Key ${KEY}, card 4111111111111111.`, [secret, card, price, codename]);
  assertEquals(d.segments, [
    { removed: "words", rule: "Hide the codename" }, { t: " costs " }, { flagged: "$40", rule: "No prices", effect: "block" }, { t: ". Key " },
    { removed: "API key", rule: "API key or secret in payload" }, { t: ", card " }, { removed: "card number", rule: "Payment card number" }, { t: "." },
  ]);
  assertEquals([d.removed, d.flagged, d.truncated], [3, 1, false]);
  assert(!JSON.stringify(d).includes("sk-ant") && !JSON.stringify(d).includes("4111"), "nothing removed is kept");
});

Deno.test("a flag that overlaps a removal never shows part of the secret", () => {
  const leak: DiffRule = { id: "r-sk", name: "Mentions sk-", category: "custom", pattern: "Key sk-ant", effect: "approval" };
  const d = controlDiff(`Key ${KEY} end`, [leak, secret]);
  assert(!JSON.stringify(d).includes("sk-ant"), JSON.stringify(d));
  assertEquals(d.segments, [{ removed: "API key", rule: "API key or secret in payload" }, { t: " end" }]);
});

Deno.test("a long reply is capped; nothing matched gives no diff; a bad or empty pattern is skipped", () => {
  const d = controlDiff("a".repeat(MAX_DIFF_CHARS + 50) + " $40", [price]);
  assert(d.truncated, "truncated");
  assertEquals(diffForReply("All fine.", [price, secret]), null);
  assertEquals(controlDiff("x $40", [{ ...price, id: "bad", pattern: "(" }, { ...price, id: "empty", pattern: "" }, price]).flagged, 1);
  assertEquals(controlDiff("abc", [{ ...price, id: "zero", pattern: "x*" }]).segments, [{ t: "abc" }]);
});
