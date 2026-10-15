// Run with: deno test --allow-env supabase/functions/_shared/outer-control-excerpt_test.ts
import { excerptOf, maskedDescription, storableText, EXCERPT_MAX } from "./outer-control-text-review.ts";
import { BUILTIN_SAFETY_RULES, type SafetyRule } from "./safety-scanner.ts";

function assert(c: unknown, m: string) { if (!c) throw new Error(m); }
const SECRET = "sk-" + "a".repeat(24);
const CARD = "4111111111111111";

Deno.test("storableText: secrets and card numbers are masked, everything else is kept", () => {
  const out = storableText(BUILTIN_SAFETY_RULES, `Use ${SECRET} and card ${CARD} to pay.`);
  assert(!out.includes(SECRET) && !out.includes(CARD), out);
  assert(out.includes("[REDACTED:secrets]") && out.includes("[REDACTED:pii]") && out.startsWith("Use ") && out.endsWith(" to pay."), out);
  assert(storableText(BUILTIN_SAFETY_RULES, "A plain sentence.") === "A plain sentence.", "clean text unchanged");
});

Deno.test("storableText: a rule that only watches (shadow mode) still gets its secret masked", () => {
  const shadow: SafetyRule[] = BUILTIN_SAFETY_RULES.map((r) => ({ ...r, shadow_mode: true }));
  assert(!storableText(shadow, `key ${SECRET}`).includes(SECRET), "shadow secret stored in the clear");
});

Deno.test("storableText: a custom rule set to cut text out is masked; a plain block rule's text is left as it was", () => {
  const rules: SafetyRule[] = [
    { id: "c1", name: "Codeword", category: "custom", pattern: "zzplanzz", severity: "block", enabled: true, redact: true } as SafetyRule,
    { id: "c2", name: "Codename", category: "custom", pattern: "falcon", severity: "block", enabled: true } as SafetyRule,
  ];
  const out = storableText(rules, "The zzplanzz and the falcon.");
  assert(!out.includes("zzplanzz") && out.includes("falcon"), out);
});

Deno.test("excerptOf masks before cutting, so a cut can never leave half a secret", () => {
  const body = "x".repeat(EXCERPT_MAX - 10) + SECRET;
  const out = excerptOf(storableText(BUILTIN_SAFETY_RULES, body));
  assert(out.length <= EXCERPT_MAX, "too long");
  assert(!/sk-a{1,}/.test(out), "part of the secret survived the cut");
});

Deno.test("maskedDescription keeps the text whole when the sensitive span lives in another field", () => {
  const matches = [{ rule_id: "builtin:secret_key", name: "k", category: "secrets", severity: "block" as const, pattern: BUILTIN_SAFETY_RULES[0].pattern, matched_on: "token", sample: "sk-a…redacted" }];
  assert(maskedDescription("Send the weekly summary.", matches) === "Send the weekly summary.", "description was changed or withheld");
  assert(!maskedDescription(`Send ${SECRET} to them.`, matches).includes(SECRET), "secret in the description not masked");
});
