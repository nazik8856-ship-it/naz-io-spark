// Run with: deno test --allow-env supabase/functions/_shared/redact-console_test.ts
// Secrets handling, front 2: once redact-console.ts is imported, nothing written to the console carries a secret.
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }

const KEY = "sk-ant-api03-" + "Zz9_".repeat(8);
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123_-xyz";

Deno.test("every console method that prints scrubs strings, errors and objects before they reach the log", async () => {
  const seen: unknown[][] = [];
  const saved = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug, trace: console.trace, group: console.group, groupCollapsed: console.groupCollapsed, dir: console.dir, table: console.table, assert: console.assert, timeLog: console.timeLog };
  for (const m of Object.keys(saved) as (keyof typeof saved)[]) (console as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => { seen.push(a); };
  try {
    const mod = await import("./redact-console.ts");
    console.error("Notion refused:", `token=${KEY}`);
    console.warn(new Error(`provider said Bearer ${JWT}`));
    console.log({ provider: "Gmail", headers: { Authorization: `Bearer ${JWT}` }, body: { refresh_token: "1//0gAnything", note: "fine" } });
    console.info(`calling https://api.example.com/cb?code=abc123&state=ok`);
    mod.installRedactingConsole(); // a second install changes nothing (no double wrapping)
    console.debug(KEY);
    console.group(`step with ${KEY}`);
    console.dir({ api_key: "anything-secret-1" }, { depth: 2 });
    console.table([{ token: KEY }]);
    console.assert(false, `assertion with ${KEY}`);
    console.timeLog("call", { password: "hunter2024!" });
    const text = JSON.stringify(seen, (_k, v) => (v instanceof Error ? { message: v.message, stack: v.stack } : v));
    assert(!text.includes(KEY), "the API key reached the log");
    assert(!text.includes(JWT), "the JWT reached the log");
    assert(!text.includes("1//0gAnything") && !text.includes("abc123"), "a token or an auth code reached the log");
    assert(text.includes("Notion refused:") && text.includes("[REDACTED:secrets]") && text.includes("fine") && text.includes("state=ok"), "the rest of each line stays readable");
    assert(seen[1][0] instanceof Error, "an error stays an error");
    assert(seen.length === 10, `each call logged exactly once (got ${seen.length})`);
    assert(!text.includes("anything-secret-1") && !text.includes("hunter2024!"), "a secret-named value reached the log");
    assert(seen[6][0] !== undefined && JSON.stringify(seen[6][1]) === '{"depth":2}', "dir keeps its options");
    assert(seen[8][0] === false && seen[9][0] === "call", "assert keeps its condition and timeLog its label");
  } finally {
    Object.assign(console, saved);
  }
});

Deno.test("log lines: terminal escapes and control characters are removed, line breaks and tabs kept, length capped", async () => {
  const { cleanLogString, MAX_LOG_STRING } = await import("./redact-console.ts");
  const forged = "user said: hi\u001B[2J\u001B[1;31mFAKE ERROR\u001B[0m\u0000\u0007 done‮";
  const out = cleanLogString(forged);
  if (/\u001B|\u0000|\u0007|‮/.test(out)) throw new Error(`escape survived: ${JSON.stringify(out)}`);
  if (out !== "user said: hiFAKE ERROR done") throw new Error(JSON.stringify(out));
  if (cleanLogString("line 1\n\tline 2") !== "line 1\n\tline 2") throw new Error("line breaks and tabs must stay");
  const huge = cleanLogString("x".repeat(MAX_LOG_STRING + 500));
  if (!huge.endsWith("…(500 more characters cut)") || huge.length > MAX_LOG_STRING + 40) throw new Error("not capped");
  if (!cleanLogString("key sk-" + "a".repeat(40)).includes("[REDACTED")) throw new Error("secrets must still be scrubbed");
});
