// Complete account erasure (docs/account-erasure.md): the request, the sweep, the database function and the screen.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ERASE_CONFIRM_WORD, ERASE_KEEPS, ERASE_REMOVES, canRequestErasure, daysUntil, erasureErrorText } from "@/lib/account-erasure";

const ROOT = join(__dirname, "../..");
const code = (p: string) => readFileSync(join(ROOT, p), "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const erasure = code("supabase/migrations/20261113031435_account_erasure.sql");
const order = code("supabase/migrations/20261113031559_account_erasure_delete_order.sql");
const defs = code("supabase/migrations/20261113031304_two_step_for_database_functions.sql");
const sweep = readFileSync(join(ROOT, "supabase/functions/data-deletion-sweep/index.ts"), "utf8");
const helper = readFileSync(join(ROOT, "supabase/functions/_shared/account-erasure.ts"), "utf8");
const card = readFileSync(join(ROOT, "src/components/account/DeleteAccountCard.tsx"), "utf8");
const settings = readFileSync(join(ROOT, "src/pages/AccountSettings.tsx"), "utf8");
const governancePage = readFileSync(join(ROOT, "src/pages/ControlAccountData.tsx"), "utf8");

describe("the database function", () => {
  const fn = /FUNCTION public\.erase_account\(_user_id uuid\)[\s\S]*?END \$fn\$;/.exec(order)![0];

  it("is for the server key only, refuses platform staff, and says so when the account does not exist", () => {
    expect(fn).toContain("coalesce(auth.role(), '') <> 'service_role'");
    expect(fn).toContain("r.role::text IN ('owner', 'admin')");
    expect(fn).toContain("P0002");
    expect(erasure).toContain("REVOKE ALL ON FUNCTION public.erase_account(uuid) FROM PUBLIC, anon, authenticated");
    expect(erasure).toContain("GRANT EXECUTE ON FUNCTION public.erase_account(uuid) TO service_role");
  });

  it("works from the register, not from a list of table names, so a new owner table can not be forgotten", () => {
    expect(fn).toContain("public.erasure_plan()");
    expect(fn).toContain("FOR t IN SELECT * FROM _erase_todo");
    expect(fn).not.toMatch(/DELETE FROM public\.(projects|websites|agents|missions)\b/);
  });

  it("deletes the change log last, the login after the secrets, and the signed record only after the login", () => {
    const at = (s: string) => fn.indexOf(s);
    expect(at("DELETE FROM vault.secrets")).toBeGreaterThan(0);
    expect(at("DELETE FROM public.config_changes")).toBeGreaterThan(at("DELETE FROM vault.secrets"));
    expect(at("DELETE FROM auth.users")).toBeGreaterThan(at("DELETE FROM public.config_changes"));
    expect(at("DELETE FROM public.security_evidence WHERE")).toBeGreaterThan(at("DELETE FROM auth.users"));
  });

  it("checks its own work: any row left in any owner table undoes the whole erasure", () => {
    expect(fn).toMatch(/RAISE EXCEPTION 'rows left in %: %'/);
    expect(fn).toMatch(/RAISE EXCEPTION 'could not erase: %'/);
  });

  it("leaves a record with nothing that names the person", () => {
    expect(fn).toContain("INSERT INTO public.account_erasures (user_hash, counts)");
    expect(fn).toContain("extensions.digest(_user_id::text, 'sha256')");
    expect(erasure).toContain("REVOKE ALL ON public.account_erasures FROM PUBLIC, anon, authenticated, service_role");
  });

  it("keeps the do-not-email list", () => {
    expect(fn).not.toContain("suppressed_emails");
  });
});

describe("a table nobody decided about is found", () => {
  it("erasure_gaps() is part of the weekly isolation check", () => {
    expect(erasure).toContain("FUNCTION public.erasure_gaps()");
    expect(erasure).toContain("'erasure_missing'");
    expect(erasure).toContain("'person_not_erased'");
    expect(erasure).toContain("'broken_register'");
  });

  it("every database function a signed-in person can call and that acts for them asks for the two-step code", () => {
    expect(erasure).toContain("'two_step_missing_function'");
    expect(defs).toContain("session_mfa_ok()");
    for (const f of ["get_business_context", "request_data_deletion", "rotate_webhook_secret", "my_security_activity", "record_approval_signoff"]) expect(defs).toContain(`'${f}'`);
  });
});

describe("the request", () => {
  const req = /FUNCTION public\.request_account_erasure\(\)[\s\S]*?END \$fn\$;/.exec(erasure)![0];
  it("needs a signed-in person who passed the code, refuses staff, and waits 7 days", () => {
    expect(req).toContain("auth.uid()");
    expect(req).toContain("public.session_mfa_ok()");
    expect(req).toContain("IN ('owner', 'admin')");
    expect(req).toContain("interval '7 days'");
    expect(req).toContain("'account'");
  });

  it("the older governance-only request keeps its own scope", () => {
    expect(erasure).toContain("scope = 'governance'");
    expect(erasure).toContain("CHECK (scope IN ('governance', 'account'))");
    expect(governancePage).toContain('.eq("scope", "governance")');
  });
});

describe("the sweep", () => {
  it("runs an account request through the helper and leaves it pending when it fails", () => {
    expect(sweep).toContain('dueReq.scope === "account"');
    expect(sweep).toContain("eraseAccount(admin, dueReq.user_id)");
    expect(sweep).toMatch(/stays pending/);
    expect(sweep).toContain("Bearer ${serviceKey}");
  });

  it("cancels each connected service at its provider before the data goes", () => {
    expect(helper).toContain("disconnectIntegration");
    expect(helper.indexOf("disconnect(")).toBeLessThan(helper.indexOf('rpc("erase_account"'));
    expect(helper).toContain("never stops the erasure");
  });
});

describe("the screen", () => {
  it("asks for the typed phrase, shows what goes and what stays, and offers cancel", () => {
    expect(settings).toContain("<DeleteAccountCard />");
    expect(card).toContain('rpc("request_account_erasure")');
    expect(card).toContain('rpc("cancel_data_deletion"');
    expect(card).toContain("ERASE_REMOVES");
    expect(card).toContain("ERASE_KEEPS");
    expect(ERASE_REMOVES.length).toBeGreaterThanOrEqual(5);
    expect(ERASE_KEEPS.join(" ")).toMatch(/30 days/);
  });

  it("helpers", () => {
    expect(canRequestErasure("delete my account")).toBe(true);
    expect(canRequestErasure("  DELETE MY ACCOUNT ")).toBe(true);
    expect(canRequestErasure("DELETE")).toBe(false);
    expect(ERASE_CONFIRM_WORD).toBe("DELETE MY ACCOUNT");
    const now = new Date("2026-11-13T12:00:00Z");
    expect(daysUntil("2026-11-20T12:00:00Z", now)).toBe(7);
    expect(daysUntil("2026-11-13T13:00:00Z", now)).toBe(1);
    expect(daysUntil("2026-11-01T00:00:00Z", now)).toBe(0);
    expect(erasureErrorText("two-step sign-in required")).toMatch(/authenticator/);
    expect(erasureErrorText("Platform staff accounts are not deleted here")).toMatch(/NazAI itself/);
    expect(erasureErrorText("boom 10.0.0.4")).toBe("Something went wrong. Try again.");
  });
});

describe("migrations", () => {
  it("are named with the version the database recorded", () => {
    const names = readdirSync(join(ROOT, "supabase/migrations"));
    for (const n of ["20261113031304_two_step_for_database_functions.sql", "20261113031435_account_erasure.sql", "20261113031559_account_erasure_delete_order.sql"]) expect(names).toContain(n);
  });
});
