// Two-step sign-in, the way back in (docs/two-step-sign-in.md).
//
//   status         how many recovery codes are left (never the codes)                         needs the code (aal2)
//   generate       new set of single-use recovery codes, shown once; the old set stops working   needs the code (aal2)
//   use            "I lost my phone": a recovery code removes the authenticator app so the person can sign in and set it up again
//                  -- the one door open to a session that has NOT used the code, because that person can not give it
//   support_reset  a platform owner removes another account's two-step sign-in (after confirming the account owner, see
//                  docs/incident-response.md); recorded on that account's signed security record
//
// Codes are 16 characters from a 31-character alphabet (about 79 bits), kept only as SHA-256 hashes with the account id mixed in.
// The database does the rest (use_mfa_recovery_code, replace_mfa_recovery_codes, support_remove_two_step): one code works once,
// five wrong tries in fifteen minutes lock the door, and every step is written to the signed security record.
import "../_shared/redact-console.ts"; // first: secrets never reach the function logs
import "../_shared/outbound-guard.ts"; // second: no request carries a NazAI credential to a host it does not belong to
import { readJson } from "../_shared/input.ts";
import { createClient } from "../_shared/encrypted-client.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { requireCaller } from "../_shared/caller.ts";
import { formatRecoveryCode, generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } from "../_shared/recovery-codes.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const makeClient = (h: string) => createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: h } } });

    const inputRead = await readJson(req, { headers: corsHeaders, maxBytes: 4 * 1024 });
    if (!inputRead.ok) return inputRead.response;
    const body = inputRead.value;
    const action = String(body?.action ?? "");
    if (!["status", "generate", "use", "support_reset"].includes(action)) return json({ error: "bad_action" }, 400);

    // "use" is the one door open to a session that has not used the code: the person has lost the phone. It still needs a valid sign-in.
    const authed = await requireCaller(req, makeClient, { allowFirstStep: action === "use" });
    if (!authed.ok) return json({ error: authed.error === "mfa_required" ? "mfa_required" : "unauthorized" }, 401);
    const userId = authed.caller.userId;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (action === "status") {
      const { data, error } = await admin.rpc("mfa_recovery_codes_left", { _user_id: userId });
      if (error) return json({ error: "failed" }, 500);
      return json({ left: Number(data ?? 0) });
    }

    if (action === "generate") {
      const rate = await checkRateLimit(admin, userId, "mfa-recovery-generate", 5, 3600);
      if (!rate.allowed) return json({ error: "too_many" }, 429);
      const codes = generateRecoveryCodes(8);
      const hashes = await Promise.all(codes.map((c) => hashRecoveryCode(userId, c)));
      const { error } = await admin.rpc("replace_mfa_recovery_codes", { _user_id: userId, _hashes: hashes });
      if (error) return error.message?.includes("not on") ? json({ error: "two_step_off" }, 409) : json({ error: "failed" }, 500);
      return json({ codes: codes.map(formatRecoveryCode) });
    }

    if (action === "use") {
      const rate = await checkRateLimit(admin, userId, "mfa-recovery-use", 20, 3600);
      if (!rate.allowed) return json({ error: "too_many" }, 429);
      const code = normalizeRecoveryCode(String(body?.code ?? ""));
      if (!code) return json({ error: "wrong_code" }, 400);
      const { data, error } = await admin.rpc("use_mfa_recovery_code", { _user_id: userId, _code_hash: await hashRecoveryCode(userId, code) });
      if (error) return json({ error: "failed" }, 500);
      if (data === "ok") return json({ ok: true });
      if (data === "locked") return json({ error: "locked" }, 429);
      if (data === "no_factor") return json({ error: "two_step_off" }, 409);
      return json({ error: "wrong_code" }, 400);
    }

    // support_reset: the caller must be a platform owner (the database checks the role again); they can not reset themselves.
    const target = String(body?.user_id ?? "");
    if (!UUID.test(target)) return json({ error: "bad_request" }, 400);
    const { data, error } = await admin.rpc("support_remove_two_step", { _target: target, _by: userId, _reason: String(body?.reason ?? "other") });
    if (error) return error.code === "42501" ? json({ error: "forbidden" }, 403) : error.code === "P0002" ? json({ error: "not_found" }, 404) : json({ error: "failed" }, 500);
    return json({ removed: Number(data ?? 0) });
  } catch {
    return json({ error: "failed" }, 500);
  }
});
