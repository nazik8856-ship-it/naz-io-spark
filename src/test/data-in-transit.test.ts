// General data security, task 2: protected data in transit (docs/data-in-transit.md).
//
// These checks fail the build when a function loses the request guard, when a place where an account's content leaves NazAI stops
// masking it, when a new direct model call skips masking, or when a log line would print a request body, headers or a credential.
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const FUNCTIONS = join(ROOT, "supabase/functions");
const read = (p: string) => readFileSync(p, "utf8");
const fns = readdirSync(FUNCTIONS).filter((d) => !d.startsWith("_") && d !== "mcp" && existsSync(join(FUNCTIONS, d, "index.ts")));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "_test-support" || n === "mcp" ? [] : sources(p);
    return n.endsWith(".ts") && !n.endsWith("_test.ts") ? [p] : [];
  });
}

describe("the request guard is in every function", () => {
  it("finds the functions", () => expect(fns.length).toBeGreaterThanOrEqual(95));
  it.each(fns)("%s imports the outbound guard right after the log scrubber", (fn) => {
    const imports = read(join(FUNCTIONS, fn, "index.ts")).split("\n").filter((l) => l.startsWith("import "));
    const i = imports.findIndex((l) => l.includes("redact-console.ts"));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(imports[i + 1]).toMatch(/from "\.\.\/_shared\/outbound-guard\.ts"|^import "\.\.\/_shared\/outbound-guard\.ts"/);
  });
});

describe("content is masked where it leaves NazAI", () => {
  const expectIn = (file: string, ...needles: (string | RegExp)[]) => {
    const src = read(join(FUNCTIONS, file));
    for (const n of needles) expect(src, `${file}: ${n}`).toMatch(n);
  };
  it("connected tools and MCP servers (Outer Control)", () => {
    expectIn("_shared/outer-control-session.ts", "const outBody = maskOutbound(request.body, [token]).value;", "body: JSON.stringify(outBody)",
      "request: { headers: request.headers, body: outBody }", /maskOutboundText\(\[reqInput\.objective/, "const stored = scrubInbound(");
  });
  it("agent tools, provider writes, webhooks and callbacks", () => {
    expectIn("agent-runtime/index.ts", "const maskedInput = maskOutbound(validation.data);", "let input = maskedInput.value;");
    expectIn("_shared/provider-writes.ts", /export async function runProviderWrite\([\s\S]{0,300}input = maskOutbound\(input\)\.value;/);
    expectIn("_shared/webhooks.ts", "const body = maskedJson({ event, data: payload");
    expectIn("_shared/callback-delegation.ts", 'const body = maskedJson({ event: "decision_needs_resolution"');
  });
  it("model prompts and embeddings", () => {
    expectIn("_shared/ai-gateway.ts", "body: JSON.stringify(maskOutbound(body).value)", "input: maskOutboundText(text).text");
  });

  // A direct call to a model provider (not through callAiGateway) must send a masked body.
  const MODEL_CALL = /fetch\(\s*(OPENAI_URL|LOVABLE_URL|OPENAI_EMBEDDINGS_URL|LOVABLE_EMBEDDINGS_URL|gw\.url|cfg\.url|gateway\.url|"https:\/\/(ai\.gateway\.lovable\.dev|api\.openai\.com|openrouter\.ai|api\.anthropic\.com)[^"]*")/g;
  const unmasked = (src: string) => [...src.matchAll(MODEL_CALL)].filter((m) => {
    const after = src.slice(m.index!, m.index! + 600);
    const body = after.match(/\bbody:\s*([^\n]*)/);
    return !body || !/maskedJson\(|maskOutbound\(/.test(body[1]);
  }).map((m) => m[1]);
  it("finds an unmasked model call (the guard itself works)", () => {
    expect(unmasked('const r = await fetch(OPENAI_URL, {\n  method: "POST",\n  body: JSON.stringify({ messages }),\n});')).toEqual(["OPENAI_URL"]);
    expect(unmasked('const r = await fetch(gw.url, {\n  body: maskedJson({ messages }),\n});')).toEqual([]);
  });
  it.each(sources(FUNCTIONS).map((p) => p.slice(FUNCTIONS.length + 1)))("%s: every direct model call masks its body", (file) => {
    expect(unmasked(read(join(FUNCTIONS, file)))).toEqual([]);
  });
});

describe("no log line prints a body, headers or a credential", () => {
  const BANNED = /\b(body|rawText|headers|token|accessToken|access_token|refreshToken|refresh_token|secret|apiKey|api_key|authorization|password|credentials|serviceKey|outBody)\b/;
  // The arguments of every console call with string literals removed (so a word inside a message is fine).
  function offending(src: string): string[] {
    const out: string[] = [];
    for (const m of src.matchAll(/console\.(log|error|warn|info|debug)\(/g)) {
      let depth = 1, i = m.index! + m[0].length, q: string | null = null, args = "";
      for (; i < src.length && depth > 0; i++) {
        const c = src[i];
        if (q) { if (c === "\\") { i++; continue; } if (c === q) q = null; else if (q === "`" && c === "$" && src[i + 1] === "{") { args += " "; } continue; }
        if (c === '"' || c === "'" || c === "`") { q = c; continue; }
        if (c === "(") depth++; else if (c === ")") depth--;
        if (depth > 0) args += c;
      }
      // template expressions: ${...} are code, keep them
      const tmpl = [...src.slice(m.index!, i).matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1]).join(" ");
      const code = `${args} ${tmpl}`.replace(/\.\w+/g, (p) => (BANNED.test(p.slice(1)) ? " " : p)); // a property like .error is fine; x.token is not
      const hit = (code + " " + tmpl).match(BANNED);
      if (hit && !/\.(token|secret|body|headers)\b/.test(src.slice(m.index!, i)) ) out.push(src.slice(m.index!, Math.min(i, m.index! + 120)));
      else if (/\.(token|secret|headers|authorization|apiKey|password)\b/.test(src.slice(m.index!, i).replace(/(["'`])(?:\\.|(?!\1).)*\1/g, ""))) out.push(src.slice(m.index!, Math.min(i, m.index! + 120)));
    }
    return out;
  }
  it("finds a log line that prints one (the guard itself works)", () => {
    expect(offending('console.log("sending", body);')).toHaveLength(1);
    expect(offending("console.error(`failed with ${token}`);")).toHaveLength(1);
    expect(offending('console.log("got", res.headers);')).toHaveLength(1);
    expect(offending('console.error("Failed to mark token as used", { error: e, id });')).toHaveLength(0);
    expect(offending('console.log(`[x] ${count} items`);')).toHaveLength(0);
  });
  it.each(sources(FUNCTIONS).map((p) => p.slice(FUNCTIONS.length + 1)))("%s", (file) => {
    expect(offending(read(join(FUNCTIONS, file)))).toEqual([]);
  });
});
