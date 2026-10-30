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
