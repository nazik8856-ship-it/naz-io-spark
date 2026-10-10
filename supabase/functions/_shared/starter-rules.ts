// LOOP 2 (Low/Zero Rule Coverage, 2026-10-10): safety-scanner.ts's
// BUILTIN_SAFETY_RULES give every account real, automatic, always-on
// content-pattern protection (secrets, PII, destructive wording, financial/
// mass-audience/recipient risk) with zero setup -- but hard_rules has no
// such builtin. A brand-new agent whose guardrails don't happen to require
// approval (reconcileGuardrailsToHardRules above inserts nothing for one)
// and a brand-new API key (which has no guardrails concept at all) both
// start with literally zero hard_rules protecting them, and nothing ever
// prompts an account to add one -- confirmed live: 0 enabled hard_rules
// existed account-wide in production before this fix. This closes that
// specific asymmetry: whichever entity ends up with no real rule at all
// gets exactly one starter hard_rule, safe-by-default (escalate, never
// silently permissive), fully visible/editable/deletable like any other
// rule a human created.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function seedStarterHardRuleIfNone(
  admin: SupabaseClient,
  userId: string,
  entity: { agentId?: string | null; apiKeyId?: string | null },
): Promise<void> {
  const agentId = entity.agentId ?? null;
  const apiKeyId = entity.apiKeyId ?? null;
  // Always scoped to one specific entity -- never seeds an account-wide
  // rule, which would apply far beyond what this call site has any basis
  // to judge safe.
  if (!agentId && !apiKeyId) return;
  try {
    let query = admin.from("hard_rules").select("id", { count: "exact", head: true }).eq("user_id", userId);
    query = agentId ? query.eq("agent_id", agentId) : query.eq("api_key_id", apiKeyId as string);
    const { count } = await query;
    // Idempotent and non-destructive: if this entity already has ANY real
    // rule -- whether reconciled from guardrails just above, created by
    // the account itself, or a previous call to this same function -- it
    // is left completely alone.
    if ((count ?? 0) > 0) return;
    await admin.from("hard_rules").insert({
      user_id: userId,
      agent_id: agentId,
      api_key_id: apiKeyId,
      rule_text: agentId
        ? "Require approval before this agent takes any action, until its own rules are tuned"
        : "Require approval before any action this key is told about, until this key's own rules are tuned",
      action_type_pattern: "*",
      effect: "always_require_approval",
      provider: null,
      enabled: true,
      shadow_mode: false,
      rationale: "Starter rule added automatically because nothing else protected this yet -- edit or delete like any other rule.",
    });
  } catch {
    // Best-effort safety net, same posture as reconcileGuardrailsToHardRules
    // just above -- a hiccup here must never fail agent/key creation itself.
  }
}
