// User & data isolation, front 1: every table has a registered owner and access type (isolation_tables, docs/data-isolation.md).
// The live check is isolation_report(); this keeps a new table from being merged without its register row.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(__dirname, "../../supabase/migrations");
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const all = files.map((f) => ({ f, sql: readFileSync(join(MIGRATIONS, f), "utf8") }));
const ACCESS = "owner|team|public_by_link|self|membership|platform|shared_aggregate|system_only";
const registered = new Set(all.flatMap(({ sql }) => [...sql.matchAll(new RegExp(`\\('(\\w+)', '(?:${ACCESS})'`, "g"))].map((m) => m[1])));
const created = (sql: string) => [...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?"?(\w+)"?\s*\(/gi)].map((m) => m[1]);

describe("every table has a registered owner", () => {
  it("the register lists the existing tables", () => {
    expect(registered.size).toBeGreaterThanOrEqual(100);
    for (const t of ["websites", "website_pages", "agents", "outer_control_sessions", "isolation_tables"]) expect(registered.has(t)).toBe(true);
  });

  it("finds a new table (the guard itself works)", () => {
    expect(created("CREATE TABLE IF NOT EXISTS public.team_notes (id uuid);")).toEqual(["team_notes"]);
  });

  it("every table a migration creates from front 1 on is in isolation_tables", () => {
    const bad = all.filter(({ f }) => f >= "20261104020000").flatMap(({ f, sql }) => created(sql).filter((t) => !registered.has(t)).map((t) => `${f}: ${t}`));
    expect(bad).toEqual([]);
  });
});

// Files users attach go to the private `user-uploads` bucket (src/lib/private-upload.ts); only the site generator publishes the
// ones a site places. The website itself never writes to the public bucket or hands out a public link to an upload.
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));

describe("uploads stay private", () => {
  const SRC = join(__dirname, "..");
  const browser = walk(SRC).filter((f) => !f.includes(`${join("src", "test")}`)).map((f) => ({ f, code: readFileSync(f, "utf8") }));

  it("the website uploads only to the private bucket", () => {
    const bad = browser.filter(({ code }) => /mission-assets|getPublicUrl\(/.test(code)).map(({ f }) => f);
    expect(bad).toEqual([]);
    const uploaders = browser.filter(({ code }) => /storage\s*\.from\(/.test(code)).map(({ f }) => f.replace(/^.*\/src\//, "src/"));
    expect(uploaders).toEqual(["src/lib/private-upload.ts"]);
  });

  it("the bucket is private and limited to each user's own folder", () => {
    const sql = readFileSync(join(MIGRATIONS, "20261104030000_private_uploads.sql"), "utf8");
    expect(sql).toMatch(/VALUES \('user-uploads', 'user-uploads', false\)/);
    expect(sql.match(/\(storage\.foldername\(name\)\)\[1\] = \(auth\.uid\(\)\)::text/g)?.length).toBe(5);
    expect(sql).toMatch(/DROP POLICY IF EXISTS "Authenticated users can upload to own folder"/);
  });
});

// Front 2: a published site is opened through get_public_site(), never by reading the tables, and the database holds the line.
describe("public sites are opened by link only", () => {
  const read = (name: string) => readFileSync(join(MIGRATIONS, name), "utf8");
  const part1 = read("20261105010000_public_site_lookup.sql");
  const part2 = read("20261105020000_isolation_close_gaps.sql");

  it("the lookup returns only what the public preview shows", () => {
    const body = part1.slice(part1.indexOf("CREATE OR REPLACE FUNCTION public.get_public_site"), part1.indexOf("REVOKE ALL ON FUNCTION public.get_public_site"));
    expect(body.length).toBeGreaterThan(300);
    for (const secret of ["prompt", "generation_notes", "trust_score", "user_id", "html"]) expect(body, secret).not.toMatch(new RegExp(`\\b${secret}\\b`));
    expect(part1).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_public_site\(text, boolean\) TO anon, authenticated, service_role/);
  });

  it("the three read-everything rules are dropped, and nothing re-creates one", () => {
    for (const p of ["Anyone can view a website by its link", "Anyone can view pages of a website by its link", "Anyone can view shared websites"]) {
      expect(part2).toContain(`DROP POLICY IF EXISTS "${p}"`);
    }
    const later = all.filter(({ f }) => f > "20261105020000_isolation_close_gaps.sql").map(({ sql }) => sql).join("\n");
    expect(later).not.toMatch(/CREATE POLICY[^;]*ON\s+(public\.)?(websites|website_pages|shared_websites)[^;]*USING\s*\(\s*true\s*\)/i);
  });

  it("the website reads a site through the lookup, not the tables", () => {
    const preview = readFileSync(join(__dirname, "../pages/WebsitePreview.tsx"), "utf8");
    expect(preview).toContain("fetchPublicSite(");
    expect(preview).not.toMatch(/\.from\("(websites|website_pages|shared_websites)"\)/);
    const middleware = readFileSync(join(__dirname, "../../middleware.ts"), "utf8");
    expect(middleware).toContain("/rest/v1/rpc/get_public_site");
    expect(middleware).not.toMatch(/rest\/v1\/(websites|website_pages|shared_websites)/);
  });

  it("the seven server-only functions are closed to the browser, and has_role checks the caller", () => {
    for (const fn of ["build_policy_snapshot", "delete_expired_agent_events", "get_active_policy_version", "increment_clean_allow_count", "increment_ip_rate_limit", "increment_rate_limit", "sweep_stale_generation_progress"]) {
      expect(part2, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated`));
      expect(part2, fn).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role`));
    }
    expect(part2).toMatch(/CREATE OR REPLACE FUNCTION public\.has_role[\s\S]*auth\.uid\(\)/);
  });

  it("the cross-account stats rule uses the same minimum as the server", () => {
    const m = part2.match(/contributing_account_count >= (\d+)/);
    // read from the server's file as text (importing it would pull a server module into the website's type check)
    const server = readFileSync(join(__dirname, "../../supabase/functions/_shared/cross-account-precedent.ts"), "utf8");
    const min = server.match(/export const MIN_CONTRIBUTING_ACCOUNTS = (\d+)/);
    expect(min).not.toBeNull();
    expect(Number(m?.[1])).toBe(Number(min![1]));
  });
});

// "The owner, or a member of the owner's team" is written one way in a rule: can_access() (20261105030000). A rule that calls
// is_account_member() itself is how the same check ended up spelled five ways; new rules use the helper.
describe("team rules use can_access", () => {
  const policySql = (sql: string) => [...sql.matchAll(/(?:CREATE|ALTER) POLICY[^;]*;/gi)].map((m) => m[0]);
  const direct = (sql: string) => policySql(sql).filter((p) => /is_account_member\s*\(/i.test(p));

  it("finds a hand-written team check in a rule (the guard itself works)", () => {
    expect(direct(`CREATE POLICY "x" ON public.t FOR SELECT USING (is_account_member(user_id));`)).toHaveLength(1);
    expect(direct(`CREATE POLICY "x" ON public.t FOR SELECT USING (public.can_access(user_id));`)).toHaveLength(0);
    expect(direct(`CREATE FUNCTION f() RETURNS boolean AS $$ SELECT is_account_member(x) $$;`)).toHaveLength(0);
  });

  it("no rule written after the move calls is_account_member() directly", () => {
    const bad = all.filter(({ f }) => f > "20261105030000").flatMap(({ f, sql }) => direct(sql).map((p) => `${f}: ${p.slice(0, 80)}`));
    expect(bad).toEqual([]);
  });

  it("the move itself exists and keeps the one rule it leaves", () => {
    const move = all.find(({ f }) => f.startsWith("20261105030000"))!.sql;
    expect(move).toMatch(/ALTER POLICY/);
    expect(move).toMatch(/c\.relname = 'knowledge_base_entries'/);
  });
});

// A public image address says nothing about whose it is: the folder is the site's id, never the owner's (user & data isolation).
describe("public image addresses do not carry the owner", () => {
  const FUNCTIONS = join(__dirname, "../../supabase/functions");
  const generator = readFileSync(join(FUNCTIONS, "generate-site-images/index.ts"), "utf8");
  const uploads = readFileSync(join(FUNCTIONS, "_shared/uploaded-assets.ts"), "utf8");

  it("generated images are stored under the site's id", () => {
    expect(generator).toMatch(/website-images\/\$\{site\.id\}\//);
    expect(generator).not.toMatch(/website-images\/\$\{[^}]*user[^}]*\}/);
  });

  it("published copies of uploads are stored under the site's id", () => {
    expect(uploads).toMatch(/website-images\/\$\{websiteId\}\/uploads\//);
    expect(uploads).not.toMatch(/website-images\/\$\{userId\}/);
  });
});
