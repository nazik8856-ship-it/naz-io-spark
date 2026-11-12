// Security sweep of 2026-11-12: the agent panel's "rotate webhook secret" failed for everyone (gen_random_bytes is in the "extensions"
// schema, which the function's search_path did not include), and two functions let a missing role skip the owner check. These checks
// keep the fix in place.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(join(__dirname, "../../supabase/migrations/20261112073112_webhook_secret_rotation_and_search_paths.sql"), "utf8");

describe("webhook secret functions", () => {
  it("rotate calls gen_random_bytes from the extensions schema (it is not on the function's search_path)", () => {
    expect(sql).toContain("extensions.gen_random_bytes(24)");
    expect(sql).not.toMatch(/[^.]gen_random_bytes\(/);
  });

  it("both functions treat a missing role as 'not the server', so the owner check can not be skipped", () => {
    const checks = sql.match(/coalesce\(auth\.role\(\), ''\) <> 'service_role' AND auth\.uid\(\) IS DISTINCT FROM owner/g) ?? [];
    expect(checks).toHaveLength(2);
    expect(sql).not.toMatch(/IF auth\.role\(\) <> 'service_role'/);
  });

  it("the two trigger functions have a fixed search path", () => {
    expect(sql).toContain("ALTER FUNCTION public.guard_outer_control_completed() SET search_path = public, pg_temp");
    expect(sql).toContain("ALTER FUNCTION public.guard_outer_control_task_completed() SET search_path = public, pg_temp");
  });
});
