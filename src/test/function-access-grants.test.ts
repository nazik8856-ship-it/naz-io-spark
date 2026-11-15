// Release check: 20261115040000_close_function_access.sql takes the visitor / signed-in door away from database functions that only the
// server needs. This keeps it honest: nothing the browser or a signed-in-person client calls may be on the server-only list, and every
// function on either list is named once and spelled the way the advisor spells it.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const migration = readFileSync(join(root, "supabase/migrations/20261115040000_close_function_access.sql"), "utf8");

function listOf(name: string): string[] {
  const block = new RegExp(`${name} text\\[\\] := ARRAY\\[([\\s\\S]*?)\\];`).exec(migration);
  if (!block) throw new Error(`no ${name} list in the migration`);
  return [...block[1].matchAll(/'public\.([a-z_]+)\(([^)]*)\)'/g)].map((m) => m[1]);
}
const systemOnly = [...new Set(listOf("system_only"))];
const signedInOnly = [...new Set(listOf("signed_in_only"))];

function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== "node_modules" && f !== "__preview") files(p, out); }
    else if (/\.(ts|tsx)$/.test(f) && !/\.test\.|_test\.|\.d\.ts$/.test(f) && !p.includes("/test/")) out.push(p);
  }
  return out;
}
const callers = (fn: string, dir: string) =>
  files(join(root, dir)).flatMap((p) => [...readFileSync(p, "utf8").matchAll(new RegExp(`(\\w+)\\s*\\.rpc\\(\\s*["']${fn}["']`, "g"))].map((m) => ({ file: p.replace(root + "/", ""), receiver: m[1] })));

describe("function access: what is closed to everyone but the server", () => {
  it("names the expected functions", () => {
    expect(systemOnly).toHaveLength(16);
    expect(systemOnly).toEqual(expect.arrayContaining(["consume_canva_oauth_transaction", "consume_slack_oauth_transaction", "sign_agent_decision", "guard_kill_switch", "get_business_context", "verify_decision_signature"]));
    expect(signedInOnly).toEqual(expect.arrayContaining(["read_webhook_secret", "rotate_webhook_secret", "record_approval_signoff", "verify_decision_signatures_batch"]));
  });

  it("a function is on one list only", () => {
    expect(systemOnly.filter((n) => signedInOnly.includes(n))).toEqual([]);
  });

  it("the browser never calls a server-only function", () => {
    for (const fn of systemOnly) expect(callers(fn, "src"), `${fn} is called from the browser`).toEqual([]);
  });

  it("an edge function calls a server-only function only with the service-role client", () => {
    const userClients = /^(authed|userClient|user|anonClient|callerClient|client)$/;
    for (const fn of systemOnly) {
      for (const c of callers(fn, "supabase/functions")) expect(userClients.test(c.receiver), `${c.file} calls ${fn} through ${c.receiver}`).toBe(false);
    }
  });

  it("the rules that call a function for whoever is asking are left alone", () => {
    for (const keep of ["has_role", "is_account_member", "session_mfa_ok", "can_access", "get_public_site"]) {
      expect(systemOnly).not.toContain(keep);
      expect(signedInOnly).not.toContain(keep);
    }
  });

  it("the migration checks its own result and tolerates a missing function", () => {
    expect(migration).toContain("to_regprocedure(sig) IS NOT NULL");
    expect(migration).toContain("can still be executed by a visitor or a signed-in person");
    expect(migration).toContain("can still be executed by a visitor'");
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon'/);
  });
});
