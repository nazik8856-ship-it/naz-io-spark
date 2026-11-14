// General data security, task 1: every content column has a class (docs/data-classification.md).
//
// These checks fail the build when the code register (supabase/functions/_shared/data-classes.ts) and the database seed
// (data_classification migrations) disagree, when an encrypted or exempt column has no class or the wrong kind of class, or when
// a migration adds a text, JSON, array or binary column without giving it a class. classification_report() checks the live schema.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLASS_POLICY, CONTENT_CLASSES, DATA_CLASSES, DATA_CLASSIFICATION, classOf, classifiedColumns, type DataClass,
} from "../../supabase/functions/_shared/data-classes";

const ROOT = join(__dirname, "../..");
const MIGRATIONS = join(ROOT, "supabase/migrations");
const read = (p: string) => readFileSync(p, "utf8");
const migrations = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort().map((f) => ({ f, sql: read(join(MIGRATIONS, f)) }));
const FIRST = "20261108010000_data_classification.sql";
const CLASS_ALT = DATA_CLASSES.join("|");

/** Seed rows (table, column, class) in the classification migrations, later rows winning. */
function seeded(): Map<string, DataClass> {
  const out = new Map<string, DataClass>();
  for (const { f, sql } of migrations) {
    if (f < FIRST) continue;
    for (const insert of sql.matchAll(/INSERT INTO public\.data_classification \(table_name, column_name, class\) VALUES([\s\S]*?)\nON CONFLICT/g)) {
      for (const m of insert[1].matchAll(new RegExp(`\\('(\\w+)', '(\\w+)', '(${CLASS_ALT})'\\)`, "g"))) out.set(`${m[1]}.${m[2]}`, m[3] as DataClass);
    }
    for (const m of sql.matchAll(/DELETE FROM public\.data_classification WHERE table_name = '(\w+)' AND column_name = '(\w+)'/g)) out.delete(`${m[1]}.${m[2]}`);
  }
  return out;
}

// Text-like columns a migration adds: ALTER TABLE ... ADD COLUMN, and the columns of CREATE TABLE.
const TEXTLIKE = /^(text|jsonb|json|varchar|character varying|bytea|vector|[a-z_]+\[\])/i;
export function addedColumns(sql: string): string[] {
  const out: string[] = [];
  for (const alter of sql.matchAll(/ALTER TABLE (?:IF EXISTS )?(?:ONLY )?(?:public\.)?"?(\w+)"?([^;]*);/gi)) {
    for (const add of alter[2].matchAll(/ADD COLUMN (?:IF NOT EXISTS )?"?(\w+)"?\s+([\w\s]+(?:\[\])?)/gi)) {
      if (TEXTLIKE.test(add[2].trim()) && !add[1].endsWith("_enc")) out.push(`${alter[1]}.${add[1]}`);
    }
  }
  for (const create of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\);/gi)) {
    for (const line of create[2].split("\n")) {
      const m = line.match(/^\s*"?(\w+)"?\s+([\w ]+(?:\[\])?)/);
      if (!m || /^(PRIMARY|UNIQUE|CONSTRAINT|CHECK|FOREIGN|EXCLUDE)$/i.test(m[1])) continue;
      if (TEXTLIKE.test(m[2].trim()) && !m[1].endsWith("_enc")) out.push(`${create[1]}.${m[1]}`);
    }
  }
  return out;
}

describe("data classification: the register", () => {
  it("has a handling policy for every class, and secrets never leave, reach a prompt or a log", () => {
    expect(Object.keys(CLASS_POLICY).sort()).toEqual([...DATA_CLASSES].sort());
    expect(CLASS_POLICY.SECRET).toMatchObject({ browserRead: false, inPrompt: "never", inLogs: "never", mayLeave: "auth_header_of_its_own_service" });
    expect(CLASS_POLICY.PERSONAL.inLogs).toBe("never");
    expect(CLASS_POLICY.EXTERNAL_RESPONSE.inPrompt).toBe("fenced_untrusted_data");
  });

  it("lists every column once with a known class", () => {
    const rows = classifiedColumns();
    expect(rows.length).toBeGreaterThanOrEqual(454);
    expect(new Set(rows.map(([t, c]) => `${t}.${c}`)).size).toBe(rows.length);
    for (const [, , k] of rows) expect(DATA_CLASSES).toContain(k);
  });

  it("the code register and the database seed list the same columns with the same class", () => {
    const code = new Map(classifiedColumns().map(([t, c, k]) => [`${t}.${c}`, k]));
    expect(Object.fromEntries([...seeded()].sort())).toEqual(Object.fromEntries([...code].sort()));
  });

  it("the credential columns are SECRET", () => {
    for (const [t, c] of [["api_keys", "key_hash"], ["api_keys", "callback_secret"], ["webhooks", "secret"],
      ["webhooks", "previous_secret"], ["email_unsubscribe_tokens", "token"], ["canva_oauth_transactions", "code_verifier"]]) {
      expect(classOf(t, c), `${t}.${c}`).toBe("SECRET");
    }
  });
});

/** An encryption_exempt_columns row in a migration: ('table', 'column', 'reason'[, 'by_design' | 'deferred']). */
// (A classification seed row, ('table', 'column', 'OPERATIONAL'), is not an exemption: a class name is never a reason.)
const EXEMPT_ROW = /\('(\w+)', '(\w+)', '(?!(?:SECRET|RULE|PROJECT_CONTENT|EXTERNAL_RESPONSE|PERSONAL|OPERATIONAL)')([^']{10,})'(?:, '(by_design|deferred)')?\)/g;

describe("data classification: agrees with encryption", () => {
  // ENCRYPTED_COLUMNS, read from the source as in field-encryption.test.ts.
  const src = read(join(ROOT, "supabase/functions/_shared/encrypted-db.ts"));
  const block = src.slice(src.indexOf("ENCRYPTED_COLUMNS"), src.indexOf("};", src.indexOf("ENCRYPTED_COLUMNS")));
  const encrypted = [...block.matchAll(/^\s*(\w+): \{\s*cols: \[([^\]]*)\]/gm)].flatMap((m) => [...m[2].matchAll(/"(\w+)"/g)].map((x) => `${m[1]}.${x[1]}`));
  encrypted.push("imported_projects.content");

  it("finds the encrypted columns", () => expect(encrypted.length).toBeGreaterThanOrEqual(52));

  it("every encrypted column has a content class", () => {
    const wrong = encrypted.filter((n) => { const [t, c] = n.split("."); const k = classOf(t, c); return !k || !CONTENT_CLASSES.includes(k); });
    expect(wrong).toEqual([]);
  });

  it("every column exempt from encryption has a class", () => {
    const exempt = migrations.flatMap(({ sql }) => [...sql.matchAll(EXEMPT_ROW)].map((m) => `${m[1]}.${m[2]}`))
      .filter((n) => !n.startsWith("isolation_") && !n.includes(".data_classification"));
    const missing = [...new Set(exempt)].filter((n) => { const [t, c] = n.split("."); return DATA_CLASSIFICATION[t] && !classOf(t, c); });
    expect(missing).toEqual([]);
  });
});

describe("data classification: new columns need a class", () => {
  it("finds the columns a migration adds (the guard itself works)", () => {
    expect(addedColumns("ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS motto text, ADD COLUMN runs int, ADD COLUMN goal_enc text;")).toEqual(["agents.motto"]);
    expect(addedColumns("ALTER TABLE agents ADD COLUMN labels text[];")).toEqual(["agents.labels"]);
    expect(addedColumns("CREATE TABLE IF NOT EXISTS public.notes (\n  id uuid PRIMARY KEY,\n  body text NOT NULL,\n  meta jsonb,\n  n int,\n  PRIMARY KEY (id)\n);")).toEqual(["notes.body", "notes.meta"]);
  });

  it("every text, JSON, array or binary column a migration adds from task 1 on has a class", () => {
    const missing = migrations.filter(({ f }) => f >= FIRST).flatMap(({ f, sql }) =>
      addedColumns(sql).filter((n) => { const [t, c] = n.split("."); return !classOf(t, c); }).map((n) => `${f}: ${n}`));
    expect(missing).toEqual([]);
  });
});

// General data security, task 3: protected data at rest.
describe("data at rest: every content column is encrypted or has a recorded reason", () => {
  const src = read(join(ROOT, "supabase/functions/_shared/encrypted-db.ts"));
  const block = src.slice(src.indexOf("ENCRYPTED_COLUMNS"), src.indexOf("};", src.indexOf("ENCRYPTED_COLUMNS")));
  const encrypted = new Set([...block.matchAll(/^\s*(\w+): \{\s*cols: \[([^\]]*)\]/gm)].flatMap((m) => [...m[2].matchAll(/"(\w+)"/g)].map((x) => `${m[1]}.${x[1]}`)));
  encrypted.add("imported_projects.content"); // PROJECTS_KEY (project-crypto.ts)
  const exempt = new Map<string, { reason: string; kind: string }>();
  for (const { sql } of migrations) {
    if (!sql.includes("encryption_exempt_columns")) continue;
    for (const m of sql.matchAll(EXEMPT_ROW)) exempt.set(`${m[1]}.${m[2]}`, { reason: m[3], kind: m[4] ?? "by_design" });
  }
  // A deferred column that a later migration encrypts loses its exemption (20261113010000_data_at_rest.sql deletes the row).
  const ended = new Set(migrations.filter(({ sql }) => /DELETE FROM public\.encryption_exempt_columns/.test(sql))
    .flatMap(({ sql }) => [...sql.matchAll(/\('(\w+)', '(\w+)'\)/g)].map((m) => `${m[1]}.${m[2]}`)));
  for (const n of ended) if (exempt.get(n)?.kind === "deferred" && encrypted.has(n)) exempt.delete(n);

  it("finds the exemptions (the guard itself works)", () => {
    expect(exempt.get("websites.html")?.kind).toBe("by_design");
    expect(exempt.has("agents.goal")).toBe(false); // was deferred; encrypted by the data-at-rest migration
    expect(encrypted.has("agents.goal")).toBe(true);
    expect(encrypted.has("agent_memory.value")).toBe(true);
  });

  it("no content column is left without one or the other (classification_gaps() is empty)", () => {
    const gaps = classifiedColumns().filter(([t, c, k]) => CONTENT_CLASSES.includes(k) && !encrypted.has(`${t}.${c}`) && !exempt.has(`${t}.${c}`)).map(([t, c]) => `${t}.${c}`);
    expect(gaps).toEqual([]);
  });

  it("a column is never both encrypted and exempt", () => {
    expect([...exempt.keys()].filter((n) => encrypted.has(n) && exempt.get(n)!.kind === "deferred")).toEqual([]);
  });

  it("a deferred column says what has to change before it can be encrypted", () => {
    const vague = [...exempt].filter(([, x]) => x.kind === "deferred" && !/first$/.test(x.reason)).map(([n]) => n);
    expect(vague).toEqual([]);
  });

  it("every SECRET column has a storage rule (secret_storage_rules)", () => {
    const rules = new Set(migrations.flatMap(({ sql }) => [...sql.matchAll(/\('(\w+)', '(\w+)', '(?:vault_only|hash_only|short_lived|link_token)'/g)].map((m) => `${m[1]}.${m[2]}`)));
    const missing = classifiedColumns().filter(([, , k]) => k === "SECRET").map(([t, c]) => `${t}.${c}`).filter((n) => !rules.has(n));
    expect(missing).toEqual([]);
  });

  it("the columns whose value lives in the vault are kept empty by a check, and key hashes must be hashes", () => {
    const sql = read(join(MIGRATIONS, "20261109010000_protect_data_at_rest.sql"));
    for (const c of ["agent_integrations_credentials_vault_only", "api_keys_callback_secret_vault_only", "webhooks_secret_vault_only",
      "webhooks_previous_secret_vault_only", "api_keys_key_hash_hash_only"]) expect(sql, c).toMatch(new RegExp(`ADD CONSTRAINT ${c} CHECK`));
  });
});
