// Migrations are SQL text that no other build check executes. These checks catch the damage a shell does when a migration is
// written through an unquoted heredoc: "$$" replaced by the process id ("DO 514"), "$fn$" collapsed to "$", and dollar quotes
// that no longer pair up. Found on 2026-11-05 in 20261108010000_data_classification.sql before it was applied.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(__dirname, "../../supabase/migrations");
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

/** What is wrong with a migration's dollar quoting, if anything. */
export function dollarQuoteProblems(sql: string): string[] {
  const out: string[] = [];
  // Comments can hold anything. (Quoted strings are left in: escapes like E'\'' make stripping them unreliable.)
  const code = sql.replace(/--[^\n]*/g, "");
  if (/\bDO\s+\d+\s*(\n|$)/i.test(code)) out.push("DO followed by a number (a shell replaced $$)");
  if (/\bEND\s+\d+\s*;/i.test(code)) out.push("END followed by a number (a shell replaced $$)");
  if (/\bAS\s+\$\s*\n/i.test(code)) out.push("a function body opened with a bare $ (a shell ate the tag)");
  if (/^\s*\$\s*;\s*$/m.test(code) || /\bEND\s+\$\s*;/i.test(code)) out.push("a function body closed with a bare $ (a shell ate the tag)");
  const tags = new Map<string, number>();
  for (const m of code.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)?\$/g)) tags.set(m[0], (tags.get(m[0]) ?? 0) + 1);
  for (const [tag, n] of tags) if (n % 2) out.push(`${tag} appears ${n} times (unpaired)`);
  return out;
}

describe("migration dollar quoting", () => {
  it("finds a damaged migration (the guard itself works)", () => {
    expect(dollarQuoteProblems("DO 514\nBEGIN\n  PERFORM 1;\nEND 514;")).toHaveLength(2);
    expect(dollarQuoteProblems("CREATE FUNCTION f() RETURNS int LANGUAGE sql AS $\n  SELECT 1\n$;")).toHaveLength(2);
    expect(dollarQuoteProblems("CREATE FUNCTION f() RETURNS int LANGUAGE sql AS $fn$ SELECT 1 $fn$;\nDO $$ BEGIN END $$;")).toEqual([]);
    expect(dollarQuoteProblems("SELECT 1; -- a $ and DO 514 in a comment")).toEqual([]);
  });

  it("finds the migrations", () => expect(files.length).toBeGreaterThan(100));

  it.each(files)("%s", (f) => {
    expect(dollarQuoteProblems(readFileSync(join(MIGRATIONS, f), "utf8"))).toEqual([]);
  });
});
