// Shared per-user credit gate for the Generator's actual generation entry
// points (compile-website-manifest, compile-agent-manifest). Mirrors the
// existing process-mission function's check-then-deduct pattern, backed by
// the same atomic `deduct_credit` RPC already used there (SELECT ... FOR
// UPDATE + decrement in one transaction, so two concurrent requests can't
// both pass a stale check). That RPC is SECURITY DEFINER and revoked from
// anon/authenticated, so it must be called with a service-role client, not
// the caller's own user-scoped one.
//
// Before this, compile-website-manifest and compile-agent-manifest were the
// only real AI-cost-incurring actions in the Generator with no credit check
// at all -- a signed-in user with zero credits (or none purchased, ever)
// could create unlimited websites and agents for free, while purchase-credits
// and process-mission both treat credits as a real, enforced resource.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const NO_CREDITS_MESSAGE =
  "You're out of credits. Add credits or upgrade your plan to create a new one — editing what you've already built is still free.";

// Consumes exactly one credit for a brand-new website/agent creation. Returns
// ok:false (without throwing) on insufficient credits so the caller can
// return a normal 402 response instead of a 500. Fails OPEN on infra errors
// talking to Supabase itself (a transient RPC failure should never block
// someone from using a product they're already paying for) but fails CLOSED
// on an explicit "no credits" result from the RPC.
export async function consumeGenerationCredit(userId: string): Promise<{ ok: boolean }> {
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data, error } = await admin.rpc("deduct_credit", { user_id: userId });
    if (error) {
      console.error("consumeGenerationCredit: deduct_credit RPC failed", error);
      return { ok: true };
    }
    return { ok: data === true };
  } catch (e) {
    console.error("consumeGenerationCredit: unexpected failure", e);
    return { ok: true };
  }
}
