// Two-step sign-in (docs/two-step-sign-in.md): the helpers the screens use, and the database rule that makes the owner/admin roles need
// the code once a person has turned it on.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanCode, isCompleteCode, mfaErrorText, mfaStep, unverifiedFactors, verifiedTotp } from "@/lib/mfa";

const ROOT = join(__dirname, "../..");
const sql = readFileSync(join(ROOT, "supabase/migrations/20261116010000_two_step_sign_in_for_admin_roles.sql"), "utf8");
const caller = readFileSync(join(ROOT, "supabase/functions/_shared/caller.ts"), "utf8");
const guard = readFileSync(join(ROOT, "src/components/AuthGuard.tsx"), "utf8");

describe("mfaStep", () => {
  it("asks for the code only when a factor exists and this sign-in has not used it", () => {
    expect(mfaStep({ currentLevel: "aal1", nextLevel: "aal2" })).toBe("challenge");
    expect(mfaStep({ currentLevel: "aal2", nextLevel: "aal2" })).toBe("ok");
    expect(mfaStep({ currentLevel: "aal1", nextLevel: "aal1" })).toBe("ok");
    expect(mfaStep(null)).toBe("ok");
    expect(mfaStep(undefined)).toBe("ok");
    expect(mfaStep({ currentLevel: null, nextLevel: null })).toBe("ok");
  });
});

describe("code input", () => {
  it("keeps digits only, at most 6", () => {
    expect(cleanCode("123 456")).toBe("123456");
    expect(cleanCode("12-34-56-78")).toBe("123456");
    expect(cleanCode("abc")).toBe("");
    expect(isCompleteCode("123456")).toBe(true);
    expect(isCompleteCode("12345")).toBe(false);
  });
});

describe("factors", () => {
  const list = [
    { id: "a", status: "verified", factor_type: "totp" },
    { id: "b", status: "unverified", factor_type: "totp" },
    { id: "c", status: "verified", factor_type: "phone" },
  ];
  it("only a confirmed authenticator app counts as protection", () => {
    expect(verifiedTotp(list).map((f) => f.id)).toEqual(["a"]);
    expect(unverifiedFactors(list).map((f) => f.id)).toEqual(["b"]);
    expect(verifiedTotp(null)).toEqual([]);
  });
});

describe("error wording", () => {
  it("never passes the raw provider text through", () => {
    expect(mfaErrorText("Invalid TOTP code entered")).toMatch(/not right/);
    expect(mfaErrorText("weird internal failure at 10.0.0.4")).toBe("Something went wrong. Try again.");
    expect(mfaErrorText(undefined)).toBe("Something went wrong. Try again.");
  });
});

describe("the page gate", () => {
  it("shows the challenge instead of the page, and does not lock people out if the check itself fails", () => {
    expect(guard).toContain("getAuthenticatorAssuranceLevel");
    expect(guard).toContain("<MfaChallenge");
    expect(guard).toMatch(/error \? "ok"/);
  });
});

describe("database rule", () => {
  it("owner and admin need an aal2 session once a verified factor exists; other roles and the server key are unchanged", () => {
    expect(sql).toContain("_role::text NOT IN ('owner', 'admin')");
    expect(sql).toContain("coalesce(auth.role(), '') <> 'authenticated'");
    expect(sql).toContain("auth.jwt() ->> 'aal'");
    expect(sql).toContain("= 'aal2'");
    expect(sql).toContain("auth.mfa_factors");
    expect(sql).toContain("status = 'verified'");
  });

  it("keeps the earlier caller check", () => {
    expect(sql).toContain("auth.uid() = _user_id");
    expect(sql).toMatch(/SECURITY DEFINER SET search_path = public, pg_temp/);
  });
});

describe("server functions", () => {
  it("requireCaller refuses an aal1 session for a person with a confirmed authenticator app", () => {
    expect(caller).toContain("mfaSatisfied(authHeader, data.user.factors)");
    expect(caller).toContain('error: "mfa_required"');
    expect(caller).toContain('=== "aal2"');
    expect(caller).toContain('f?.status === "verified"');
  });
});
