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

// --- model output ------------------------------------------------------------------------------------------------------------------
// What a model writes is untrusted input. Every place that reads JSON out of a model reply goes through _shared/model-output.ts
// (parseModelJson / askForJson / parseModelObject / parseStrictObject). These are the JSON.parse calls that remain, each for a reason.
const OWN_JSON: Record<string, string> = {
  "governance-backup-export/index.ts": "our own encrypted backup file, opened with our key",
  "compile-website-manifest/index.ts": "our own request body after upload aliases were swapped in (a copy of a body already read and bounded by readJson)",
  "control-test-suite/index.ts": "the answer of our own control-api, read back inside the test run",
  "analyze-inputs/index.ts": "the shape of an attached JSON file, only to describe it; inside try, size bounded by the 256 KB request cap",
  "resend-events/index.ts": "a webhook whose signature was verified, after a 1 MB read cap",
  "agent-runtime/index.ts": "an external webhook body, after a 1 MB read cap; falls back to plain text",
  "mcp/index.ts": "the text our own function returned",
  "_shared/field-crypto.ts": "a value we encrypted ourselves",
  "_shared/figma.ts": "a signed token we issued",
  "_shared/gmail.ts": "a signed token we issued",
  "_shared/generation-quality.ts": "a deep copy of a value already in memory",
  "_shared/uploaded-assets.ts": "a deep copy of our own pages",
  "_shared/webhooks.ts": "the body we stored for a webhook delivery",
  "_shared/outer-control-mcp.ts": "an MCP tool server's reply, parsed by the Outer Control tool reader whose result then goes through parseToolReply",
  "_shared/outer-control-session.ts": "a tool's raw HTTP body, only to find the answer text; the answer then goes through parseToolReply",
  "_shared/outer-control-tool-test.ts": "the connection test of a tool: a tool's raw HTTP body, only to find the answer text",
  "_shared/projects.ts": "a GitHub directory listing, shown as names only inside try",
  "_shared/model-output.ts": "the reader itself",
  "_shared/input.ts": "the reader itself",
  "_shared/safe-fetch.ts": "the reader itself (after depth and size checks)",
  "_shared/output-guard.ts": "the event stream the gateway sent, one line at a time",
};
const modelFiles = [
  ...functions.map((f) => `${f}/index.ts`),
  ...readdirSync(join(ROOT, "_shared")).filter((f) => f.endsWith(".ts") && !f.endsWith("_test.ts")).map((f) => `_shared/${f}`),
];

describe("JSON read out of a model reply goes through the shared reader", () => {
  it.each(modelFiles)("%s", (f) => {
    const src = code(readFileSync(join(ROOT, f), "utf8"));
    const parses = src.split("\n").filter((l) => /\bJSON\.parse\(/.test(l));
    if (!parses.length) return;
    expect(OWN_JSON[f], `${f} calls JSON.parse (${parses[0].trim().slice(0, 80)}); read model output with parseModelJson / askForJson / parseModelObject from _shared/model-output.ts, or record why this one is safe in OWN_JSON`).toBeTruthy();
  });

  it("every exception is still needed", () => {
    for (const f of Object.keys(OWN_JSON)) {
      expect(modelFiles, f).toContain(f);
      expect(/\bJSON\.parse\(/.test(code(readFileSync(join(ROOT, f), "utf8"))), `${f} no longer calls JSON.parse; remove it from OWN_JSON`).toBe(true);
    }
  });
});

// --- outside text going into a prompt (front 2) ----------------------------------------------------------------------------------
// A function that reads a page, a file or a webhook body and puts it in a model prompt must fence it as data (fenceUntrusted / fenceAll)
// and put UNTRUSTED_DATA_RULE in that call's system prompt. These are the functions that do, and the ones that fetch an address and have
// a recorded reason not to.
const FENCES_OUTSIDE_TEXT = ["agent-runtime", "analyze-inputs", "business-context-researcher", "agent-intake"];
const FETCHES_WITHOUT_FENCE: Record<string, string> = {
  "projects": "stores the page as a project snapshot and wraps it in PROJECT_OPEN / PROJECT_CLOSE markers whenever it is shown to a model (_shared/projects.ts)",
  "integration-sync": "reads the customer's own shop numbers into stored snapshots; no model prompt is built from the raw response",
  "integration-connect": "checks that a connection works; the response is never put in a prompt",
};

describe("outside text is fenced before a model reads it", () => {
  it.each(FENCES_OUTSIDE_TEXT)("%s fences outside text and carries the rule", (fn) => {
    const src = code(source(fn));
    expect(/fenceUntrusted\(|fenceAll\(/.test(src), `${fn} puts outside text in a prompt without fenceUntrusted / fenceAll`).toBe(true);
    expect(src.includes("UNTRUSTED_DATA_RULE"), `${fn} must add UNTRUSTED_DATA_RULE to its system prompt`).toBe(true);
  });

  it.each(functions)("%s: a function that fetches an address either fences or says why not", (fn) => {
    const src = code(source(fn));
    if (!/safeFetchText\(|safeFetchJson\(|fetchPublicHttps\(/.test(src)) return;
    const ok = /fenceUntrusted\(|fenceAll\(/.test(src) || fn in FETCHES_WITHOUT_FENCE;
    expect(ok, `${fn} fetches an address; fence what it reads before a model sees it (fenceUntrusted) or record why not in FETCHES_WITHOUT_FENCE`).toBe(true);
  });

  it("the webhook body of an agent run is data, not the operator's instruction", () => {
    const src = code(source("agent-runtime"));
    expect(src).toContain("instructionIsOutsideData");
    expect(src).toMatch(/not an instruction from your operator/);
  });

  it("every exception is a real function", () => {
    for (const fn of Object.keys(FETCHES_WITHOUT_FENCE)) expect(functions).toContain(fn);
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
