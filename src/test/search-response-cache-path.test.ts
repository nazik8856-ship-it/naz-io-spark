// The 4-argument search_response_cache() had no pgvector schema in its search_path (incident since 2026-10-05).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(join(__dirname, "..", "..", "supabase/migrations/20261115030608_fix_search_response_cache_search_path.sql"), "utf8");

describe("search_response_cache search path", () => {
  it("sets the schema pgvector lives in on the exact 4-argument function, and skips a function that is not there", () => {
    expect(sql).toContain("ALTER FUNCTION public.search_response_cache(uuid, extensions.vector, integer, integer) SET search_path = public, extensions, pg_temp");
    expect(sql).toContain("to_regprocedure('public.search_response_cache(uuid, extensions.vector, integer, integer)') IS NOT NULL");
  });
});
