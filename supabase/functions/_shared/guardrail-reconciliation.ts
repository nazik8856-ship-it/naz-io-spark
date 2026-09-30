// Task #48: turns a manifest guardrail that says it requires approval into a
// REAL, agent-scoped hard_rules row -- the table control-gate.ts's
// runControlGateInner actually enforces. Every generated agent's manifest
// ships with 2-6 guardrails ("Never send outbound emails without explicit
// approval", "Never charge customers or move funds without approval"),
// shown proudly on the agent's own dashboard (GeneratedAgentDashboard.tsx's
// guardrails widget) -- but purely cosmetic until this runs: nothing else
// ever inserted a matching hard_rules row, so an account could see a
// guardrail listed and reasonably believe it was a real protection when it
// never was.
//
// Catch-all action_type_pattern ("*") is the deliberate, safe default: free
// text like "Never charge customers or move funds without approval" can't
// be reliably mapped to a specific real action_type without guessing, and
// guessing wrong risks EITHER under-protecting (a narrower pattern than
// intended) or blocking unrelated actions outright -- "this agent's actions
// need approval" is over-cautious, never under-protective, the correct
// failure direction for something a user was already told exists as a
// protection.
//
// Idempotent by (user_id, agent_id, rule_text): re-running on every
// manifest edit only ever ADDS a newly-appeared guardrail's rule, never
// removes or duplicates one -- a rule the user has since edited or deleted
// via HardRulesPanel stays exactly as they left it, the same "escalate,
// never silently de-escalate" posture policy-downgrade.ts already holds to
// elsewhere. requiresApproval:false guardrails (soft, informational --
// "flag anomalies", "stay within brand tone") are deliberately left as
// prompt-level guidance only, since they don't map to a deterministic
// block/approval decision at all.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function reconcileGuardrailsToHardRules(
  admin: SupabaseClient,
  userId: string,
  agentId: string,
  guardrails: { rule: string; requiresApproval: boolean }[],
): Promise<void> {
  const enforceable = guardrails.filter((g) => g.requiresApproval && g.rule.trim());
  if (!enforceable.length) return;
  try {
    const { data: existing } = await admin
      .from("hard_rules")
      .select("rule_text")
      .eq("user_id", userId)
      .eq("agent_id", agentId);
    const existingTexts = new Set(((existing ?? []) as { rule_text: string }[]).map((r) => r.rule_text));
    const toInsert = enforceable
      .filter((g) => !existingTexts.has(g.rule))
      .map((g) => ({
        user_id: userId,
        agent_id: agentId,
        rule_text: g.rule,
        action_type_pattern: "*",
        effect: "always_require_approval" as const,
        provider: null,
        enabled: true,
        shadow_mode: false,
        rationale: "Generated automatically from this agent's own manifest guardrails — edit or delete like any other rule.",
      }));
    if (toInsert.length) await admin.from("hard_rules").insert(toInsert);
  } catch {
    // Reconciliation is a best-effort safety net, not the primary save --
    // a hiccup here must never fail agent creation/update itself.
  }
}
