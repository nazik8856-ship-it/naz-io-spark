// Safe input & output handling, front 1: the input boundary guard, and the generated inventory of what every function reads.
//
//   1. No server function reads a request body itself. It goes through _shared/input.ts (readJson / parseBody / readCapped), which
//      caps the size, the depth and the number of items, and takes NUL bytes and lone surrogates out of every string. A function that
//      must read the raw body for another reason (a signature over the exact bytes) uses readCapped and says why in RAW_BODY below.
//   2. Everything a function passes as the "headers" of a refusal exists in that file (the old way would have been a ReferenceError
//      at the first bad request, which is the worst moment to find out).
//   3. docs/input-inventory.md lists, for every function, the body fields, query parameters and headers it reads and the size cap that
//      applies. It is generated: `UPDATE_INVENTORY=1 npx vitest run src/test/input-boundary.test.ts` rewrites it, and this test fails
//      when it is out of date, so a new field cannot be added without it showing up in the document.
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FUNCTION_ACCESS } from "../../supabase/functions/_shared/function-access";

const ROOT = join(__dirname, "../../supabase/functions");
const DOC = join(__dirname, "../../docs/input-inventory.md");
const functions = readdirSync(ROOT).filter((d) => !d.startsWith("_") && existsSync(join(ROOT, d, "index.ts"))).sort();
const source = (fn: string) => readFileSync(join(ROOT, fn, "index.ts"), "utf8");
const code = (src: string) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|import\s|export .* from )/.test(l)).join("\n");

/** Functions that read the raw request body, each with the reason. They still go through readCapped (a size cap before the read). */
const RAW_BODY: Record<string, string> = {
  "handle-email-unsubscribe": "RFC 8058 one-click unsubscribe posts a form-encoded body, not JSON",
  "agent-runtime": "an external webhook may post any text; the text is kept as the agent's instruction when it is not JSON",
  "resend-events": "the signature is computed over the exact bytes",
};

const DIRECT_READ = /\b(?:req|request)\s*\.\s*(?:json|text|formData|arrayBuffer|blob)\s*\(/;

export function directBodyReads(src: string): string[] {
  return code(src).split("\n").filter((l) => DIRECT_READ.test(l)).map((l) => l.trim());
}

describe("no function reads a request body on its own", () => {
  it("the check finds what it looks for (the guard itself works)", () => {
    expect(directBodyReads("const b = await req.json().catch(() => ({}));")).toHaveLength(1);
    expect(directBodyReads("const t = await request.text();")).toHaveLength(1);
    expect(directBodyReads("// the body comes from req.json() in the old code")).toHaveLength(0);
    expect(directBodyReads("const r = await resp.json();")).toHaveLength(0);
    expect(directBodyReads("const b = await readJson(req);")).toHaveLength(0);
  });

  it.each(functions)("%s", (fn) => {
    const src = source(fn);
    expect(directBodyReads(src), `${fn} reads the body itself; use readJson / parseBody from _shared/input.ts`).toEqual([]);
    if (fn in RAW_BODY) expect(/readCapped\(/.test(src), `${fn} is a raw-body exception and must cap the read`).toBe(true);
  });

  it("every raw-body exception still exists and is still needed", () => {
    for (const fn of Object.keys(RAW_BODY)) {
      expect(functions).toContain(fn);
      expect(/readCapped\(/.test(source(fn)), `${fn} no longer reads a raw body; remove it from RAW_BODY`).toBe(true);
    }
  });
});

describe("a refusal is built from headers that exist", () => {
  it.each(functions)("%s", (fn) => {
    const src = source(fn);
    if (!/headers:\s*corsHeaders/.test(code(src)) || !/readJson\(|parseBody\(/.test(src)) return;
    expect(/^(?:export )?(?:const|let|var)\s+corsHeaders\b/m.test(src), `${fn} passes corsHeaders to the reader but never defines it`).toBe(true);
  });
});

// --- the inventory ---------------------------------------------------------------------------------------------------------------
const uniq = (xs: string[]) => [...new Set(xs)].sort();
const CALLERS = "(?:body|payload|input|inputRead\\d*|parsed|fields|raw|reqBody|requestBody)";

export function inventory(src: string) {
  const c = code(src);
  const bodyFields: string[] = [];
  for (const m of c.matchAll(new RegExp(`(?<![/\\w.])${CALLERS}(?:\\.value)?\\s*\\??\\.\\s*([a-z_][A-Za-z0-9_]*)`, "g"))) bodyFields.push(m[1]);
  for (const m of c.matchAll(new RegExp(`(?<![/\\w.])${CALLERS}(?:\\.value)?\\s*\\??\\.?\\[\\s*["']([A-Za-z_][A-Za-z0-9_]*)["']`, "g"))) bodyFields.push(m[1]);
  for (const m of c.matchAll(/const\s*\{([^}]*)\}\s*=\s*(?:body|payload|input\.value|inputRead\d*\.value|parsed)\b/g)) {
    for (const part of m[1].split(",")) { const name = part.trim().split(/[:=\s]/)[0]; if (name && /^[A-Za-z_]\w*$/.test(name)) bodyFields.push(name); }
  }
  const noise = new Set(["ok", "value", "response", "status", "code", "message", "body", "length", "map", "filter", "forEach", "includes", "slice", "trim", "toLowerCase", "toUpperCase", "replace", "split", "join", "test", "match", "startsWith", "endsWith", "push", "entries", "keys", "values", "some", "every", "find", "toString", "concat", "ops", "m", "a"]);
  const query = uniq([...c.matchAll(/searchParams\.get\(\s*["']([^"']+)["']/g)].map((m) => m[1]));
  const headers = uniq([...c.matchAll(/headers\.get\(\s*["']([^"']+)["']/gi)].map((m) => m[1].toLowerCase())).filter((h) => !["content-length"].includes(h));
  const cap = /readJson\(|parseBody\(/.test(c) ? (c.match(/maxBytes:\s*([^,}]+)/)?.[1]?.trim().replace(/\s+/g, " ") ?? "256 KB") : /readCapped\(/.test(c) ? (c.match(/readCapped\([^,]+,\s*([^)]+)\)/)?.[1]?.trim() ?? "capped") : "—";
  const via = /parseBody\(/.test(c) ? "parseBody" : /readJson\(/.test(c) ? "readJson" : /readCapped\(/.test(c) ? "readCapped (raw)" : "no body";
  return { bodyFields: uniq(bodyFields).filter((f) => !noise.has(f)), query, headers, cap, via };
}

export function renderInventory(): string {
  const rows = functions.map((fn) => {
    const i = inventory(source(fn));
    const access = FUNCTION_ACCESS[fn]?.access ?? "?";
    const cell = (xs: string[]) => (xs.length ? xs.map((x) => `\`${x}\``).join(", ") : "—");
    return `| \`${fn}\` | ${access} | ${i.via} | ${i.cap} | ${cell(i.bodyFields)} | ${cell(i.query)} | ${cell(i.headers)} |`;
  });
  return [
    "# What every server function reads from a request",
    "",
    "Generated by `src/test/input-boundary.test.ts` -- do not edit by hand. Rewrite it with `UPDATE_INVENTORY=1 npx vitest run src/test/input-boundary.test.ts`;",
    "the test fails when this file is out of date, so a new field, query parameter or header shows up here in review.",
    "",
    "Every body goes through `supabase/functions/_shared/input.ts`: capped in size (256 KB unless the cap column says otherwise), at most 12 levels deep,",
    "no list over 2,000 items, no object over 500 keys, NUL bytes / control characters / lone surrogates taken out of every string, `__proto__` dropped.",
    "A refusal is `400` (not valid) or `413` (too large) in the function's usual `{ error }` shape, never a 500.",
    "The fields are found by reading the code (names used on the parsed body), so treat the list as a map for review, not as a contract.",
    "",
    "| Function | Access | Body read by | Body cap | Body fields | Query parameters | Headers read |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

describe("docs/input-inventory.md", () => {
  it("finds fields, query parameters and headers (the generator itself works)", () => {
    const i = inventory(`const input = await readJson(req, { maxBytes: 5 * 1024 * 1024 });\nconst { prompt, mode = "x" } = input.value;\nconst a = body?.agent_id; const b = body["name"];\nconst q = url.searchParams.get("limit");\nconst k = req.headers.get("X-Api-Key");`);
    expect(i.bodyFields).toEqual(expect.arrayContaining(["prompt", "mode", "agent_id", "name"]));
    expect(i.query).toEqual(["limit"]);
    expect(i.headers).toEqual(["x-api-key"]);
    expect(i.cap).toBe("5 * 1024 * 1024");
    expect(i.via).toBe("readJson");
  });

  it("is up to date", () => {
    const text = renderInventory();
    if (process.env.UPDATE_INVENTORY === "1") { writeFileSync(DOC, text); return; }
    expect(existsSync(DOC), "docs/input-inventory.md is missing; run with UPDATE_INVENTORY=1").toBe(true);
    expect(readFileSync(DOC, "utf8"), "docs/input-inventory.md is out of date; run with UPDATE_INVENTORY=1").toBe(text);
  });
});
