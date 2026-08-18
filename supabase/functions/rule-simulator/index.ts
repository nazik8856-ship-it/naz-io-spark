// Rule simulator — paste a hypothetical action, see what a DRAFT hard rule
// (and/or the account's current live rules + the deterministic safety
// scanner) would do, without needing a full 30-scenario control-test-suite
// replay and without touching anything real: no DB write, no model call, no
// execution. Reuses the exact same pure matching/scanning logic the real
// gate enforces with (ruleMatchesAction, scanWithRules) so the simulator
// can never drift from what actually decides.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ruleMatchesAction } from "../_shared/rule-matching.ts";
import { scanWithRules, BUILTIN_SAFETY_RULES, type SafetyRule } from "../_shared/safety-scanner.ts";
import { projectVerdict } from "../_shared/rule-simulator-logic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type DraftRule = {
  rule_text?: string;
  action_type_pattern: string;
  effect: "always_block" | "always_require_approval";
  provider?: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const userId = userData.user.id;

  const body = await req.json().catch(() => ({}));
  const actionType = String(body?.action_type || "").trim();
  const provider = String(body?.provider || "unknown").trim() || "unknown";
  const description = String(body?.description || "").trim();
  const params = body?.params ?? {};
  const draftRule = (body?.draft_rule ?? null) as DraftRule | null;

  if (!actionType) return json({ error: "action_type required" }, 400);
  if (!description) return json({ error: "description required" }, 400);
  if (draftRule && (!draftRule.action_type_pattern || !draftRule.effect)) {
    return json({ error: "draft_rule needs action_type_pattern and effect" }, 400);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // ---- 1: the account's CURRENT live hard rules — what would actually
  // happen right now, for comparison against the draft.
  const { data: liveRulesRaw } = await admin
    .from("hard_rules")
    .select("id, rule_text, action_type_pattern, effect, provider, enabled, shadow_mode")
    .eq("user_id", userId);
  const liveRules = ((liveRulesRaw ?? []) as {
    id: string; rule_text: string; action_type_pattern: string; effect: string; provider: string | null;
    enabled?: boolean; shadow_mode?: boolean;
  }[]).filter((r) => r.enabled !== false);
  const liveMatch = liveRules.find((r) => !r.shadow_mode && ruleMatchesAction(r, actionType, provider));
  const liveShadowMatches = liveRules.filter((r) => r.shadow_mode && ruleMatchesAction(r, actionType, provider));

  // ---- 2: the draft rule under test, if one was given.
  const draftMatches = draftRule ? ruleMatchesAction(draftRule, actionType, provider) : null;

  // ---- 3: the deterministic safety scanner (same builtin rules + this
  // account's custom ones — read-only, no snapshot pinning needed for a
  // what-if check).
  const { data: customSafetyRaw } = await admin
    .from("safety_rules")
    .select("id, name, category, pattern, severity, enabled")
    .eq("user_id", userId)
    .eq("enabled", true);
  const customSafety = ((customSafetyRaw ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    name: String(r.name ?? "Custom rule"),
    category: String(r.category ?? "custom"),
    pattern: String(r.pattern ?? ""),
    severity: (r.severity === "block" ? "block" : "require_approval") as "block" | "require_approval",
    enabled: true,
    builtin: false,
  })).filter((r) => r.pattern);
  const safetyScan = scanWithRules(
    [...BUILTIN_SAFETY_RULES.filter((r: SafetyRule) => r.enabled), ...customSafety],
    params,
    description,
  );

  return json({
    input: { action_type: actionType, provider, description },
    live_rules: {
      matched: liveMatch
        ? { id: liveMatch.id, rule_text: liveMatch.rule_text, effect: liveMatch.effect }
        : null,
      shadow_matches: liveShadowMatches.map((r) => ({ id: r.id, rule_text: r.rule_text, would_have: r.effect })),
    },
    draft_rule: draftRule
      ? {
        matches: draftMatches,
        would_result_in: draftMatches ? draftRule.effect : null,
      }
      : null,
    safety_scan: safetyScan,
    // A rough combined read: what would this action's verdict be right now,
    // factoring in live hard rules + the draft rule under test + the safety
    // scanner. This does NOT include spend cap / kill switch / circuit
    // breaker / anomaly detector — those depend on live account state at
    // the moment of a real action, not a hypothetical.
    projected_verdict: projectVerdict({
      liveRuleEffect: (liveMatch?.effect as "always_block" | "always_require_approval" | undefined) ?? null,
      draftRuleMatches: draftMatches ?? false,
      draftRuleEffect: draftRule?.effect ?? null,
      safetyMatched: safetyScan.matched,
      safetySeverity: safetyScan.severity,
    }),
    note: "Does not include spend cap, kill switch, circuit breaker, or the anomaly detector — those depend on live account state at the moment of a real action, not a hypothetical.",
  });
});
