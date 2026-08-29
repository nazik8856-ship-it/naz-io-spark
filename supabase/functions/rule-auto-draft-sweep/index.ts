// Scheduled (pg_cron, daily): "policy autonomy" plan item 9 -- auto-drafts
// a new hard rule, ALWAYS in shadow mode, from a strong recurring
// precedent pattern (a real API key's requests of one exact shape decided
// the exact same way -- blocked -- over and over). See rule-auto-draft.ts
// for the detection logic and its documented scope decision (consistent
// BLOCKs only, never raw escalation frequency).
//
// A drafted rule is a completely normal hard_rules insert -- the exact
// same shape a human's own "add rule" action already writes
// (HardRulesPanel.tsx), with shadow_mode always true, so it changes
// nothing live and needs no dual-control approval (that only gates
// PROMOTING a rule to live or deleting one, never creating a shadow
// draft). The existing log_hard_rules_changes trigger already records
// every insert into config_changes regardless of actor, and this sweep's
// service-role insert has no auth.uid() -- so a drafted rule shows up
// with a null actor_id, distinguishing it from a human-authored one for
// free, no extra column needed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { detectRecurringBlockPatterns, draftRuleFromPattern, type DecisionRow } from "../_shared/rule-auto-draft.ts";
import { triggerWebhooks } from "../_shared/webhooks.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Wide enough to gather a real pattern without dredging up ancient,
// possibly-stale behavior -- same order of magnitude as calibrate-
// confidence's own 90-day lookback, though shorter since a "recurring"
// pattern worth drafting a rule from should be a RECENT habit.
const LOOKBACK_DAYS = 30;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString();
  const { data, error } = await admin
    .from("agent_decisions")
    .select("user_id, api_key_id, action_type, provider")
    .not("api_key_id", "is", null)
    .eq("decision", "block")
    .gte("created_at", since)
    .limit(20000);
  if (error) return json({ error: error.message }, 500);

  type Row = { user_id: string; api_key_id: string; action_type: string; provider: string | null };
  const byUser = new Map<string, DecisionRow[]>();
  for (const r of (data ?? []) as Row[]) {
    if (!r.user_id || !r.api_key_id || !r.action_type) continue;
    const rows = byUser.get(r.user_id) ?? [];
    rows.push({ action_type: r.action_type, provider: r.provider });
    byUser.set(r.user_id, rows);
  }

  const drafted: { user_id: string; action_type: string; provider: string | null; sample_size: number }[] = [];
  const draftedThisRun = new Set<string>();

  for (const [userId, rows] of byUser.entries()) {
    for (const pattern of detectRecurringBlockPatterns(rows)) {
      const dedupeKey = `${userId}::${pattern.action_type}::${pattern.provider ?? ""}`;
      if (draftedThisRun.has(dedupeKey)) continue;

      // Never draft a duplicate of a rule that already covers this exact
      // shape for this account, whether it's already live or already a
      // still-unreviewed shadow draft from an earlier sweep run.
      let existingQuery = admin.from("hard_rules").select("id").eq("user_id", userId).eq("action_type_pattern", pattern.action_type).limit(1);
      existingQuery = pattern.provider ? existingQuery.eq("provider", pattern.provider) : existingQuery.is("provider", null);
      const { data: existing } = await existingQuery;
      if (existing && existing.length) continue;

      const draft = draftRuleFromPattern(pattern);
      const { error: insertErr } = await admin.from("hard_rules").insert({
        user_id: userId,
        rule_text: draft.rule_text,
        action_type_pattern: draft.action_type_pattern,
        effect: draft.effect,
        provider: draft.provider,
        shadow_mode: draft.shadow_mode,
        rationale: draft.rationale,
        agent_id: null,
      });
      if (!insertErr) {
        draftedThisRun.add(dedupeKey);
        drafted.push({ user_id: userId, action_type: pattern.action_type, provider: pattern.provider, sample_size: pattern.sample_size });
        // "Knowledge & autonomy" plan, item 6: tell the account's own
        // systems the moment a new shadow rule is drafted, instead of
        // making them keep polling HardRulesPanel to notice it.
        await triggerWebhooks(admin, userId, "hard_rule_auto_drafted", {
          action_type: pattern.action_type, provider: pattern.provider, sample_size: pattern.sample_size, rule_text: draft.rule_text,
        });
      }
    }
  }

  return json({ ok: true, accounts_scanned: byUser.size, rules_drafted: drafted.length, drafted });
});
