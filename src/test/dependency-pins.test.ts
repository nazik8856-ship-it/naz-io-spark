// Supply chain: every outside package an edge function loads is pinned to one exact version, and the Supabase client is the same
// version as the website's. A floating specifier (supabase-js@2, zod@^3) lets the next deploy pick up whatever was published since.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const FN = join(ROOT, "supabase/functions");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string> };

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sources(p);
    return n.endsWith(".ts") && !n.endsWith("_test.ts") && !p.includes("_test-support") ? [p] : [];
  });
}

// Remote specifiers: https://esm.sh/<pkg>@<ver>, npm:<pkg>@<ver>, https://deno.land/x/<pkg>@<ver>, https://deno.land/std@<ver>
const REMOTE = /(?:https:\/\/esm\.sh\/|npm:|https:\/\/deno\.land\/x\/|https:\/\/deno\.land\/)((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)@([^/"'\s]+)/gi;

describe("edge function imports", () => {
  const found: { file: string; pkg: string; ver: string }[] = [];
  for (const f of sources(FN)) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(REMOTE)) found.push({ file: f.replace(ROOT + "/", ""), pkg: m[1], ver: m[2] });
  }

  it("finds the imports it is meant to check", () => {
    expect(found.length).toBeGreaterThan(60);
    expect(found.some((x) => x.pkg === "@supabase/supabase-js")).toBe(true);
  });

  it("pins every one to an exact version (no @2, ^, ~ or ranges)", () => {
    const loose = found.filter((x) => !/^\d+\.\d+\.\d+$/.test(x.ver));
    expect(loose).toEqual([]);
  });

  it("uses one version of the Supabase client everywhere, the one the website uses", () => {
    const want = pkg.dependencies["@supabase/supabase-js"];
    expect(want).toMatch(/^\d+\.\d+\.\d+$/);
    const other = found.filter((x) => x.pkg === "@supabase/supabase-js" && x.ver !== want);
    expect(other).toEqual([]);
  });

  it("keeps the packages the generated MCP bundle uses exact in package.json", () => {
    for (const name of ["@supabase/supabase-js", "zod"]) expect(pkg.dependencies[name], name).toMatch(/^\d+\.\d+\.\d+$/);
    const bundle = readFileSync(join(FN, "mcp/index.ts"), "utf8");
    expect(bundle).toContain(`npm:zod@${pkg.dependencies.zod}`);
  });
});
