// Data encryption, front 3: Outer Control content is stored only encrypted. These checks fail the build when a change would let it
// be stored or read in the clear: an edge function reaching those tables without the encrypting client, the code and the
// migration disagreeing on which columns are encrypted, or a screen reading an encrypted column straight from the database
// (which would show nothing, since the database only holds ciphertext).
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

const ROOT = join(__dirname, "../..");
const FUNCTIONS = join(ROOT, "supabase/functions");
const read = (p: string) => readFileSync(p, "utf8");

// ENCRYPTED_COLUMNS, read from the source (the edge function code is Deno, not imported here).
const registrySrc = read(join(FUNCTIONS, "_shared/encrypted-db.ts"));
const block = registrySrc.slice(registrySrc.indexOf("ENCRYPTED_COLUMNS"), registrySrc.indexOf("};", registrySrc.indexOf("ENCRYPTED_COLUMNS")));
const REGISTRY: Record<string, string[]> = Object.fromEntries(
  [...block.matchAll(/^\s*(\w+): \{\s*cols: \[([^\]]*)\]/gm)].map((m) => [m[1], [...m[2].matchAll(/"(\w+)"/g)].map((x) => x[1])]),
);
const TABLES = Object.keys(REGISTRY);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "_test-support" || n === "mcp" ? [] : sources(p);
    return n.endsWith(".ts") && !n.endsWith("_test.ts") ? [p] : [];
  });
}
const importsOf = (file: string) => [...read(file).matchAll(/(?:import|export)[^'"]*?from\s*['"](\.[^'"]+)['"]|import\s*['"](\.[^'"]+)['"]/g)]
  .map((m) => normalize(join(dirname(file), m[1] ?? m[2]))).filter((p) => existsSync(p));
function reach(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const i of importsOf(file)) reach(i, seen);
  return seen;
}
const touchesTables = (file: string) => TABLES.some((t) => read(file).includes(`"${t}"`));

describe("Outer Control content is encrypted by every edge function that reaches it", () => {
  it("lists the sixteen tables and 43 columns", () => {
    expect(TABLES.length).toBe(16);
    expect(Object.values(REGISTRY).flat().length).toBe(43);
  });

  it("the code and the migration encrypt the same columns", () => {
    const sql = [
      "20261103010000_encrypt_outer_control.sql", "20261103020000_encrypt_visitor_and_integration_data.sql", "20261103030000_encrypt_agent_runs_and_events.sql",
      "20261103040000_encrypt_missions_kb_api_data.sql", "20261103050000_encrypt_pending_approvals.sql",
    ].map((f) => read(join(ROOT, "supabase/migrations", f))).join("\n");
    const inSql = [...sql.matchAll(/\('(\w+)', '(\w+)'\)/g)].filter((m) => REGISTRY[m[1]]).map((m) => `${m[1]}.${m[2]}`).sort();
    const inCode = Object.entries(REGISTRY).flatMap(([t, cols]) => cols.map((c) => `${t}.${c}`)).sort();
    expect([...new Set(inSql)]).toEqual(inCode);
  });

  const fns = readdirSync(FUNCTIONS).filter((d) => !d.startsWith("_") && d !== "mcp" && existsSync(join(FUNCTIONS, d, "index.ts")));
  const reaching = fns.filter((d) => [...reach(join(FUNCTIONS, d, "index.ts"))].some(touchesTables));

  it("finds the functions that reach the tables", () => {
    expect(reaching).toEqual(expect.arrayContaining(["outer-control", "outer-control-drive", "outer-control-session-sweep", "projects", "agent-runtime", "website-form-submit", "integration-sync", "analyze-inputs", "measure-decision-outcomes"]));
  });

  // The backup copies rows exactly as stored, so the encrypted columns stay encrypted in its files.
  const PLAIN_ON_PURPOSE = ["governance-backup-export"];
  it.each(reaching)("%s creates its clients with the encrypting createClient", (fn) => {
    const src = read(join(FUNCTIONS, fn, "index.ts"));
    if (PLAIN_ON_PURPOSE.includes(fn)) expect(src).toMatch(/import \{ createPlainClient as createClient \} from "\.\.\/_shared\/encrypted-client\.ts"/);
    else expect(src).toMatch(/import \{ createClient[^}]*\} from "\.\.\/_shared\/encrypted-client\.ts"/);
    expect(src).not.toMatch(/import \{[^}]*\bcreateClient\b[^}]*\} from "https:\/\/esm\.sh\/@supabase\/supabase-js/);
  });

  it("no shared module that reaches the tables makes a client of its own", () => {
    const own = sources(join(FUNCTIONS, "_shared")).filter((f) => touchesTables(f) && /\bcreateClient\(/.test(read(f)));
    expect(own.map((f) => relative(ROOT, f))).toEqual([]);
  });
});

describe("screens read and write encrypted content through the server", () => {
  const SRC = join(ROOT, "src");
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "test" || n === "__preview" ? [] : files(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });

  /** Every direct read: the table, and its column list with constants (SESSION_COLS, `${COLS}, x`) filled in. */
  function directReads(file: string): { table: string; cols: string[] }[] {
    const src = read(file);
    const consts = new Map([...src.matchAll(/const (\w+) = ["`]([^"`]*)["`]/g)].map((m) => [m[1], m[2]]));
    const fill = (expr: string) => expr.replace(/\$\{(\w+)\}/g, (_, n) => consts.get(n) ?? "").replace(/^(\w+)$/, (_, n) => consts.get(n) ?? n);
    const out: { table: string; cols: string[] }[] = [];
    for (const m of src.matchAll(/\.from\(\s*"(\w+)"\s*\)\s*\.select\(\s*(?:"([^"]*)"|`([^`]*)`|(\w+ \? `[^`]*` : \w+|[\w]+))/g)) {
      const raw = m[2] ?? m[3] ?? m[4] ?? "";
      const parts = raw.includes("?") ? raw.split(/[?:]/).map((x) => x.trim().replace(/^`|`$/g, "")) : [raw];
      const cols = parts.flatMap((x) => fill(x).split(",")).map((c) => c.trim().split(":").pop()!.split("->")[0].trim()).filter(Boolean);
      out.push({ table: m[1], cols });
    }
    return out;
  }

  it("finds the direct reads it checks (the guard itself works)", () => {
    const sample = join(ROOT, "src/components/control/outer/TaskTracker.tsx");
    expect(directReads(sample).some((r) => r.table === "outer_control_sessions" && r.cols.includes("status"))).toBe(true);
  });

  it("no screen reads an encrypted column straight from the database (it would only find ciphertext)", () => {
    const bad = files(SRC).flatMap((f) => directReads(f).flatMap((r) => (REGISTRY[r.table] ?? []).filter((c) => r.cols.includes(c) || r.cols.includes("*")).map((c) => `${relative(ROOT, f)}: ${r.table}.${c}`)));
    expect(bad).toEqual([]);
  });

  /** Every direct write: the table, the method and (for an update) the keys it sets. */
  function directWrites(file: string): { table: string; method: string; keys: string[] }[] {
    const src = read(file);
    return [...src.matchAll(/\.from\(\s*"(\w+)"\s*\)\s*\.(insert|upsert|update)\(\s*(\{[^}]*\})?/g)].map((m) => ({
      table: m[1], method: m[2], keys: [...(m[3] ?? "").matchAll(/(\w+)\s*:/g)].map((k) => k[1]),
    }));
  }

  it("finds the direct writes it checks (the guard itself works)", () => {
    const w = directWrites(join(ROOT, "src/hooks/useProjects.tsx"));
    expect(w.some((x) => x.table === "missions" && x.method === "update" && x.keys.includes("status"))).toBe(true);
  });

  it("no screen writes an encrypted column straight to the database (it would be stored in the clear)", () => {
    const bad = files(SRC).flatMap((f) => directWrites(f).filter((w) => REGISTRY[w.table] && (w.method !== "update" || w.keys.some((k) => REGISTRY[w.table].includes(k))))
      .map((w) => `${relative(ROOT, f)}: ${w.method} ${w.table}`));
    expect(bad).toEqual([]);
  });

  it("encrypted-write only accepts the writes the screens make", () => {
    const shared = read(join(FUNCTIONS, "_shared/encrypted-write.ts"));
    expect(shared).not.toMatch(/"(upsert|rpc)"/);
  });

  it("the live feed reads each new evaluation's text through the server", () => {
    const feed = read(join(SRC, "pages/ControlLiveFeed.tsx"));
    expect(feed).toMatch(/ocRead\("outer_control_evaluations"\)\.select\(OUTER_EVAL_COLS\)\.eq\("id", ev\.id\)/);
  });

  it("outer-control-read only reads: the methods it accepts", () => {
    const shared = read(join(FUNCTIONS, "_shared/outer-control-read.ts"));
    expect(shared).not.toMatch(/"(insert|update|upsert|delete|rpc)"/);
  });
});
