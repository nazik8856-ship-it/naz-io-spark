// Two-step sign-in (docs/two-step-sign-in.md): the helpers the screens use, and the database rule that makes the owner/admin roles need
// the code once a person has turned it on.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanCode, cleanRecoveryInput, isCompleteCode, isCompleteRecoveryCode, mfaErrorText, mfaStep, recoveryErrorText, unverifiedFactors, verifiedTotp } from "@/lib/mfa";

const ROOT = join(__dirname, "../..");
const sql = readFileSync(join(ROOT, "supabase/migrations/20261111063801_two_step_sign_in_for_admin_roles.sql"), "utf8");
const caller = readFileSync(join(ROOT, "supabase/functions/_shared/caller.ts"), "utf8");
const rows = readFileSync(join(ROOT, "supabase/migrations/20261113025529_two_step_for_customers.sql"), "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const fn = readFileSync(join(ROOT, "supabase/functions/mfa-recovery/index.ts"), "utf8");
const card = readFileSync(join(ROOT, "src/components/account/MfaCard.tsx"), "utf8");
const challenge = readFileSync(join(ROOT, "src/components/MfaChallenge.tsx"), "utf8");
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

describe("customers' own data rows", () => {
  it("one condition: visitors, the server key, aal2 sessions and people without a confirmed app pass; only a first-step session of a person with one fails", () => {
    const m = /FUNCTION public\.session_mfa_ok\(\)[\s\S]*?\$fn\$;/.exec(rows)![0];
    expect(m).toContain("coalesce(auth.role(), '') <> 'authenticated'");
    expect(m).toContain("auth.jwt() ->> 'aal'");
    expect(m).toContain("= 'aal2'");
    expect(m).toContain("NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = auth.uid() AND f.status = 'verified')");
    expect(m).toMatch(/SECURITY DEFINER SET search_path = public, pg_temp/);
  });

  it("every account-data table gets a restrictive rule from the register; public-by-link tables keep public reading", () => {
    expect(rows).toContain("WHERE i.access IN ('owner', 'team', 'self', 'membership', 'public_by_link')");
    expect(rows).toContain("AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.session_mfa_ok())) WITH CHECK ((SELECT public.session_mfa_ok()))");
    for (const cmd of ["INSERT", "UPDATE", "DELETE"]) expect(rows).toContain(`AS RESTRICTIVE FOR ${cmd} TO authenticated`);
    expect(rows).not.toMatch(/public_by_link[\s\S]{0,200}FOR SELECT/);
  });

  it("the weekly isolation check fails on a table that has no two-step rule", () => {
    expect(rows).toContain("'two_step_missing'");
    expect(rows).toContain("p.polname LIKE 'two\\_step\\_required%'");
  });
});

describe("recovery codes (database)", () => {
  it("the tables are reachable only through the functions, and registered", () => {
    expect(rows).toContain("REVOKE ALL ON public.mfa_recovery_codes FROM PUBLIC, anon, authenticated, service_role");
    expect(rows).toContain("REVOKE ALL ON public.mfa_recovery_attempts FROM PUBLIC, anon, authenticated, service_role");
    expect(rows).toContain("('mfa_recovery_codes', 'system_only'");
    expect(rows).toContain("('mfa_recovery_attempts', 'system_only'");
    expect(rows).toContain("code_hash text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$')");
    expect(rows).toContain("REFERENCES auth.users(id) ON DELETE CASCADE");
  });

  it("the four functions are for the server key only, and check it again inside", () => {
    for (const f of ["replace_mfa_recovery_codes(uuid, text[])", "mfa_recovery_codes_left(uuid)", "use_mfa_recovery_code(uuid, text)", "support_remove_two_step(uuid, uuid, text)"]) {
      expect(rows).toContain(`REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated`);
      expect(rows).toContain(`GRANT EXECUTE ON FUNCTION public.${f} TO service_role`);
    }
    expect(rows.match(/coalesce\(auth\.role\(\), ''\) <> 'service_role'/g)?.length).toBe(4);
  });

  it("a code works once, five wrong tries in fifteen minutes lock the door, a good code removes the app and the other codes", () => {
    expect(rows).toContain("AND used_at IS NULL");
    expect(rows).toContain("interval '15 minutes'");
    expect(rows).toContain(">= 5");
    expect(rows).toContain("DELETE FROM auth.mfa_factors WHERE user_id = _user_id");
    expect(rows).toContain("DELETE FROM public.mfa_recovery_codes WHERE user_id = _user_id");
    expect(rows).toContain("'removed_by_recovery_code'");
  });

  it("every step is written to the signed security record, and a reset needs an owner who is not the target", () => {
    expect(rows.match(/record_evidence\(/g)?.length).toBeGreaterThanOrEqual(4);
    expect(rows).toContain("_kind => 'access_refused'");
    expect(rows).toContain("'removed_by_support'");
    expect(rows).toContain("_by = _target");
    expect(rows).toContain("r.role::text = 'owner'");
  });
});

describe("recovery codes (server function and screens)", () => {
  it("only 'use' is open to a first-step session; the others need the code", () => {
    expect(fn).toContain('requireCaller(req, makeClient, { allowFirstStep: action === "use" })');
    expect(fn.match(/allowFirstStep/g)?.length).toBe(1);
    expect(caller).toContain("opts.allowFirstStep");
  });

  it("codes are hashed before they reach the database and are never returned except right after they are made", () => {
    expect(fn).toContain("hashRecoveryCode(userId");
    expect(fn).toContain("_hashes: hashes");
    expect(fn).toContain("codes: codes.map(formatRecoveryCode)");
    expect(fn.match(/codes:/g)?.length).toBe(1);
    expect(fn).toContain("Cache-Control");
  });

  it("the sign-in screen offers 'Lost your phone?' and the settings card shows the codes once", () => {
    expect(challenge).toContain("Lost your phone? Use a recovery code");
    expect(challenge).toContain('callRecovery("use"');
    expect(card).toContain('callRecovery<{ codes: string[] }>("generate")');
    expect(card).toContain("shown only once");
    expect(card).toContain("I saved them");
  });

  it("input and wording helpers", () => {
    expect(cleanRecoveryInput("abcd efgh-jkmn pqrs extra")).toBe("ABCD-EFGH-JKMN-PQRS");
    expect(cleanRecoveryInput("ab")).toBe("AB");
    expect(isCompleteRecoveryCode("abcd-efgh-jkmn-pqrs")).toBe(true);
    expect(isCompleteRecoveryCode("abcd-efgh-jkmn-pqr0")).toBe(false);
    expect(isCompleteRecoveryCode("abcd-efgh-jkmn")).toBe(false);
    expect(recoveryErrorText("locked")).toMatch(/15 minutes/);
    expect(recoveryErrorText("weird 10.0.0.4")).toBe("Something went wrong. Try again.");
  });
});
