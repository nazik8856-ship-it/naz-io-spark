// Run with: deno test --allow-env supabase/functions/_shared/redact-console_test.ts
// Secrets handling, front 2: once redact-console.ts is imported, nothing written to the console carries a secret.
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }

const KEY = "sk-ant-api03-" + "Zz9_".repeat(8);
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123_-xyz";

Deno.test("every console method scrubs strings, errors and objects before they reach the log", async () => {
  const seen: unknown[][] = [];
  const saved = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug, trace: console.trace };
  for (const m of Object.keys(saved) as (keyof typeof saved)[]) console[m] = (...a: unknown[]) => { seen.push(a); };
  try {
    const mod = await import("./redact-console.ts");
    console.error("Notion refused:", `token=${KEY}`);
    console.warn(new Error(`provider said Bearer ${JWT}`));
    console.log({ provider: "Gmail", headers: { Authorization: `Bearer ${JWT}` }, body: { refresh_token: "1//0gAnything", note: "fine" } });
    console.info(`calling https://api.example.com/cb?code=abc123&state=ok`);
    mod.installRedactingConsole(); // a second install changes nothing (no double wrapping)
    console.debug(KEY);
    const text = JSON.stringify(seen, (_k, v) => (v instanceof Error ? { message: v.message, stack: v.stack } : v));
    assert(!text.includes(KEY), "the API key reached the log");
    assert(!text.includes(JWT), "the JWT reached the log");
    assert(!text.includes("1//0gAnything") && !text.includes("abc123"), "a token or an auth code reached the log");
    assert(text.includes("Notion refused:") && text.includes("[REDACTED:secrets]") && text.includes("fine") && text.includes("state=ok"), "the rest of each line stays readable");
    assert(seen[1][0] instanceof Error, "an error stays an error");
    assert(seen.length === 5, `each call logged exactly once (got ${seen.length})`);
  } finally {
    Object.assign(console, saved);
  }
});
