// Secrets handling, front 4: every server secret the edge functions read has a rotation procedure in docs/secrets-rotation.md, so a
// new secret can not be added without one; and the functions that can not work without their secret check it at startup.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FUNCTIONS = join(__dirname, "../../supabase/functions");
const RUNBOOK = readFileSync(join(__dirname, "../../docs/secrets-rotation.md"), "utf8");

/** Names that are configuration, not secrets (public ids, addresses, labels), or are given by Supabase itself. */
const NOT_SECRETS = new Set([
  "SUPABASE_URL", "SUPABASE_ANON_KEY", "SENTRY_ENVIRONMENT", "RESEND_FROM",
  "GOOGLE_OAUTH_CLIENT_ID", "NOTION_CLIENT_ID", "FIGMA_CLIENT_ID", "CANVA_CLIENT_ID", "SHOPIFY_CLIENT_ID", "SLACK_CLIENT_ID",
]);

function sources(dir = FUNCTIONS): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return d.name === "_test-support" ? [] : sources(p);
    return d.name.endsWith(".ts") && !d.name.endsWith("_test.ts") ? [p] : [];
  });
}

const READ = /Deno\.env\.get\(['"]([A-Z0-9_]+)['"]\)|\benv\("([A-Z0-9_]+)"\)|requireSecret\("([A-Z0-9_]+)"|webhookSecrets\("([A-Z0-9_]+)"/g;
const secretsRead = [...new Set(sources().flatMap((f) => [...readFileSync(f, "utf8").matchAll(READ)].map((m) => m.slice(1).find(Boolean)!)))]
  .filter((n) => !NOT_SECRETS.has(n)).sort();

describe("rotating server secrets", () => {
  it("finds the secrets the functions read", () => {
    expect(secretsRead).toEqual(expect.arrayContaining(["PROJECTS_KEY", "PROJECTS_KEY_PREVIOUS", "DATA_KEY", "DATA_KEY_PREVIOUS", "RESEND_WEBHOOK_SECRET", "OPENAI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"]));
  });

  it.each(secretsRead)("%s has a procedure in docs/secrets-rotation.md", (name) => {
    expect(RUNBOOK).toContain(name);
  });

  it("the functions that can not work without their secret stop at startup, by name, when it is missing", () => {
    const projects = readFileSync(join(FUNCTIONS, "projects/index.ts"), "utf8");
    expect(projects).toMatch(/^requireSecret\("PROJECTS_KEY"/m);
    expect(projects).toMatch(/^optionalSecret\("PROJECTS_KEY_PREVIOUS"/m);
    for (const fn of ["projects", "outer-control"]) {
      const src = readFileSync(join(FUNCTIONS, `${fn}/index.ts`), "utf8");
      expect(src, fn).toMatch(/^requireSecret\("DATA_KEY"/m);
      expect(src, fn).toMatch(/^optionalSecret\("DATA_KEY_PREVIOUS"/m);
    }
    const resend = readFileSync(join(FUNCTIONS, "resend-events/index.ts"), "utf8");
    expect(resend).toMatch(/^requireSecret\("RESEND_WEBHOOK_SECRET"\)/m);
  });
});
