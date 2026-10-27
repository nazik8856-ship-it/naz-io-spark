// Secrets handling, front 3: a revoked API key stops working on its very next request. That holds because every entry point
// authenticates through resolveApiKeyAuth (fresh resolve_api_key call per request, no cache: control-api-auth_test.ts), and the
// database refuses a revoked key at once (supabase/tests/secrets/api_key_revocation_test.sql). This guard fails if an entry point
// checks API keys some other way, or if anything starts caching the result.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const FUNCTIONS = join(__dirname, "../../supabase/functions");
const read = (p: string) => readFileSync(join(FUNCTIONS, p), "utf8");
const entryPoints = readdirSync(FUNCTIONS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_") && existsSync(join(FUNCTIONS, d.name, "index.ts")))
  .map((d) => d.name);

describe("API keys are checked in one place, fresh on every request", () => {
  it("every function that accepts an API key authenticates it with resolveApiKeyAuth", () => {
    const accepting = entryPoints.filter((n) => /nazai_sk/.test(read(`${n}/index.ts`)) && n !== "api-keys");
    expect(accepting.length).toBeGreaterThan(0);
    for (const n of accepting) expect(read(`${n}/index.ts`), `${n} accepts API keys`).toMatch(/resolveApiKeyAuth\(/);
  });

  it("only resolveApiKeyAuth looks keys up (api-keys only creates and lists them)", () => {
    const lookups = entryPoints.filter((n) => /rpc\(\s*["']resolve_api_key|\.eq\(\s*["']key_hash["']/.test(read(`${n}/index.ts`)));
    expect(lookups).toEqual([]);
  });

  it("resolveApiKeyAuth keeps nothing between requests", () => {
    const src = read("_shared/control-api-auth.ts");
    expect(src).toMatch(/admin\.rpc\("resolve_api_key"/);
    expect(src).not.toMatch(/^(const|let|var)\s+\w+\s*=\s*new (Map|WeakMap|Set)\b/m);
  });
});
