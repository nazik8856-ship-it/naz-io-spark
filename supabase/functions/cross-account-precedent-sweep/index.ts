// Scheduled (pg_cron, daily): "policy autonomy" plan item 13 -- recomputes
// the coarse, anonymized cross-account precedent aggregate from every
// currently opted-in account's recent real decisions. See
// _shared/cross-account-precedent.ts for the aggregation logic and its
// documented anonymity safeguard (a shape's stats are only ever shared
// once at least MIN_CONTRIBUTING_ACCOUNTS distinct accounts contributed
// to it, enforced at READ time in control-api/index.ts).
//
// Recomputed fresh every run, never incrementally added to -- an account
// that opts out simply stops contributing to the NEXT computed total,
// rather than leaving a stale trace of its own past contribution behind
// forever.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { aggregateCrossAccountStats, type CrossAccountDecisionRow } from "../_shared/cross-account-precedent.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Same order of magnitude as the other periodic sweeps in this codebase
// that judge "recent, real behavior" (calibrate-confidence, rule-auto-
// draft-sweep) -- wide enough to gather a real pattern, short enough to
// reflect current behavior rather than ancient history.
const LOOKBACK_DAYS = 90;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  const runStartedAt = new Date().toISOString();

  const { data: optedInRows, error: optErr } = await admin
    .from("profiles")
    .select("id")
    .eq("share_anonymized_precedent_stats", true);
  if (optErr) return json({ error: optErr.message }, 500);
  const optedInIds = ((optedInRows ?? []) as { id: string }[]).map((r) => r.id);

  if (!optedInIds.length) {
    // Nobody opted in right now -- clear any stale aggregate left over
    // from a prior run so a since-opted-out account's numbers don't
    // linger forever with nobody actively contributing to them.
    await admin.from("cross_account_precedent_stats").delete().lt("updated_at", runStartedAt);
    return json({ ok: true, opted_in_accounts: 0, shapes_computed: 0 });
  }

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString();
  const { data: rows, error } = await admin
    .from("agent_decisions")
    .select("user_id, action_type, provider, decision")
    .in("user_id", optedInIds)
    // "Knowledge & autonomy" plan, item 7: unlike the per-api-key signals
    // above, this aggregates by user_id ACROSS every key an account has --
    // a real key and a sandbox key share the same user_id, so without this
    // filter a test key's traffic would immediately blend into this
    // account's contribution to the shared cross-account aggregate.
    .eq("is_test", false)
    .gte("created_at", since)
    .limit(50000);
  if (error) return json({ error: error.message }, 500);

  const stats = aggregateCrossAccountStats((rows ?? []) as CrossAccountDecisionRow[]);

  for (const s of stats) {
    await admin.from("cross_account_precedent_stats").upsert(
      {
        action_type: s.action_type,
        provider: s.provider ?? "",
        total_count: s.total_count,
        non_allow_count: s.non_allow_count,
        contributing_account_count: s.contributing_account_count,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "action_type,provider" },
    );
  }

  // Shapes no longer backed by any currently opted-in account's recent
  // activity are removed rather than left to quietly rot with numbers
  // nobody is contributing to anymore.
  await admin.from("cross_account_precedent_stats").delete().lt("updated_at", runStartedAt);

  return json({ ok: true, opted_in_accounts: optedInIds.length, shapes_computed: stats.length });
});
