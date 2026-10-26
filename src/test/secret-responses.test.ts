// Secrets handling, front 1: a server function may accept a secret but never send one back, except the deliberate one-time
// displays below (the value is shown once, right after it is made, and never again). This scans every edge function's responses
// (json(...), Response.json(...), new Response(...)) for a key or a value whose name says it is a secret; anything not on the
// allowlist fails the build.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "../../supabase/functions");
const SECRETISH = /(secret|token|password|passwd|credential|raw_?key|api_?key|private_?key|authorization|bearer)/i;
// Names that only point at or describe a secret: an id, a timestamp, a count, a display prefix, token usage.
const HARMLESS = /(_id|Id|_at|At|_count|Count|_prefix|Prefix|tokens|Tokens|_used|_expires_at|_ok|Ok)$/;

/** One-time displays, each with the reason it is allowed. */
const ALLOWED: { file: string; name: string; why: string }[] = [
  { file: "api-keys/index.ts", name: "rawKey", why: "the new API key, shown once at creation or rotation; only its hash is stored" },
  { file: "webhooks-create/index.ts", name: "secret", why: "the new webhook signing secret, shown once at creation; stored in Vault" },
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f.startsWith("_") ? [] : files(p);
    return f === "index.ts" ? [p] : [];
  });
}

/** The body argument of each json(...), Response.json(...) and new Response(...) call, with string literals and comments blanked out. */
function responseArgs(src: string): { line: number; text: string }[] {
  const clean = src
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (m) => `"${" ".repeat(Math.max(0, m.length - 2))}"`);
  const out: { line: number; text: string }[] = [];
  const re = /\b(?:json|Response\.json|new\s+Response)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    let depth = 1, i = m.index + m[0].length;
    const start = i;
    for (; i < clean.length && depth > 0; i++) {
      if ("({[".includes(clean[i])) depth++;
      else if (")}]".includes(clean[i])) depth--;
      else if (clean[i] === "," && depth === 1) break;
    }
    out.push({ line: clean.slice(0, m.index).split("\n").length, text: clean.slice(start, i) });
  }
  return out;
}

/** Every identifier in a response argument that names a secret (keys, values, spreads, shorthand properties). */
export function secretNamesIn(arg: string): string[] {
  const names = [...arg.matchAll(/[A-Za-z_$][\w$]*/g)].map((x) => x[0]);
  return [...new Set(names.filter((n) => SECRETISH.test(n) && !HARMLESS.test(n)))];
}

describe("edge functions never send a secret back", () => {
  it("the scanner finds secret names in a response and ignores ids, counts and text", () => {
    expect(secretNamesIn("{ ok: true, token, user: data.access_token }")).toEqual(["token", "access_token"]);
    expect(secretNamesIn("{ ok: true, secret_id: id, tokens_used: n, key_prefix: p, message: \"  \" }")).toEqual([]);
    expect(responseArgs("return json({ error: \"bad token\", message: 'the secret is wrong' }, 400);")[0].text).not.toMatch(/token|secret/);
    expect(responseArgs("return new Response(JSON.stringify({ access_token: t }), { status: 200 });").map((r) => secretNamesIn(r.text))).toEqual([["access_token"]]);
  });

  it("no response outside the one-time displays carries a secret", () => {
    const found: string[] = [];
    for (const f of files(ROOT)) {
      const rel = relative(ROOT, f);
      for (const r of responseArgs(readFileSync(f, "utf8"))) {
        for (const name of secretNamesIn(r.text)) {
          if (!ALLOWED.some((a) => a.file === rel && a.name === name)) found.push(`${rel}:${r.line} → ${name}`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it("every allowlisted one-time display still exists (a stale entry would hide a new one)", () => {
    for (const a of ALLOWED) {
      const hits = responseArgs(readFileSync(join(ROOT, a.file), "utf8")).filter((r) => secretNamesIn(r.text).includes(a.name));
      expect(hits.length, `${a.file} ${a.name}`).toBeGreaterThan(0);
    }
  });
});
