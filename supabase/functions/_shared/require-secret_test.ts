// Run with: deno test --allow-env supabase/functions/_shared/require-secret_test.ts
// Secrets handling, front 4: a missing, misnamed or too short server secret fails loudly, by name, and its value is never printed.
import { optionalSecret, requireSecret, similarNames, type Env } from "./require-secret.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function throwsWith(fn: () => unknown, text: string, notText?: string) {
  try { fn(); } catch (e) {
    const m = (e as Error).message;
    if (!m.includes(text)) throw new Error(`expected "${text}" in: ${m}`);
    if (notText && m.includes(notText)) throw new Error(`the value leaked into: ${m}`);
    return;
  }
  throw new Error(`expected an error containing "${text}"`);
}
const env = (vars: Record<string, string>): Env => ({ get: (n) => vars[n], names: () => Object.keys(vars) });

Deno.test("the PROJECT_KEY typo: names the missing secret and the one that was set instead, without its value", () => {
  throwsWith(() => requireSecret("PROJECTS_KEY", { minLength: 32, env: env({ PROJECT_KEY: "a-long-secret-value-that-must-not-leak-123" }) }),
    "Server secret PROJECTS_KEY is not set. Found PROJECT_KEY: did you mean PROJECTS_KEY?", "must-not-leak");
});

Deno.test("too short: says how long it is and how long it must be, never the value", () => {
  throwsWith(() => requireSecret("PROJECTS_KEY", { minLength: 32, env: env({ PROJECTS_KEY: "short-value-10" }) }), "too short: 14 characters, at least 32 needed", "short-value");
});

Deno.test("set and long enough: returned (trimmed); an optional one may be absent, but set and too short still fails", () => {
  assertEquals(requireSecret("RESEND_WEBHOOK_SECRET", { env: env({ RESEND_WEBHOOK_SECRET: " whsec_abc " }) }), "whsec_abc");
  assertEquals(optionalSecret("PROJECTS_KEY_PREVIOUS", { minLength: 32, env: env({}) }), undefined);
  throwsWith(() => optionalSecret("PROJECTS_KEY_PREVIOUS", { minLength: 32, env: env({ PROJECTS_KEY_PREVIOUS: "x" }) }), "PROJECTS_KEY_PREVIOUS is too short");
  throwsWith(() => requireSecret("RESEND_WEBHOOK_SECRET", { env: env({ RESEND_WEBHOOK_SECRET: "   " }) }), "RESEND_WEBHOOK_SECRET is not set");
});

Deno.test("similarNames: typos and case, not unrelated names", () => {
  assertEquals(similarNames("PROJECTS_KEY", ["PROJECT_KEY", "projects_key", "PROJECTS-KEY", "OPENAI_API_KEY", "PROJECTS_KEY"]), ["PROJECTS-KEY", "PROJECT_KEY", "projects_key"]);
});
