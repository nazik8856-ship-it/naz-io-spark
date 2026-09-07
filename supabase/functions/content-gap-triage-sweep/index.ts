// "Own decision-making machine" plan, items 179-180 (Phase 3): scheduled
// (pg_cron, every 30 min) sweep that closes the loop on content gaps
// (item 169) two independent ways -- resolving ones a newly-added
// context entry now covers, and clustering the rest so recurring ones
// surface as one ranked to-do item instead of many raw rows. Combined
// into one sweep, not two, since both phases need the same free local
// embedding of the gap's own message -- no reason to pay for it twice
// in two separate cron jobs.
//
// Platform-wide (not per-account, unlike precedent-pipeline-health-
// sweep) -- both candidate queries already scope by row, not by caller,
// so there's nothing to loop over per org the way audit-integrity-sweep
// does.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateLocalEmbedding } from "../_shared/local-embeddings.ts";
import { formatEmbeddingLiteral } from "../_shared/decision-embeddings.ts";
import { findRelevantContext } from "../_shared/response-context.ts";
import { pickMatchingCluster, MAX_GAPS_PER_SWEEP_PHASE, type GapClusterCandidate } from "../_shared/content-gap-triage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type ResolvableCandidate = { id: string; api_key_id: string; message: string };
type ClusterableCandidate = { id: string; user_id: string; api_key_id: string; message: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  // ---- Phase A: resolution -------------------------------------------
  // Only gaps whose key has gained a genuinely new embedded context
  // entry since the gap was recorded (see the RPC's own comment) --
  // re-embeds the gap's message fresh (free, local) and re-runs the
  // exact same retrieval /respond itself uses; a qualifying match means
  // this question is no longer a real gap.
  let resolved = 0;
  {
    const { data: rows, error } = await admin.rpc("list_resolvable_gap_candidates", { _limit: MAX_GAPS_PER_SWEEP_PHASE });
    if (error) console.error(`[CONTENT GAP TRIAGE] list_resolvable_gap_candidates failed: ${error.message}`);
    const candidates = (rows ?? []) as ResolvableCandidate[];

    for (const gap of candidates) {
      try {
        const embedding = await generateLocalEmbedding(gap.message);
        if (!embedding) continue;
        const literal = formatEmbeddingLiteral(embedding);
        const contextEntries = await findRelevantContext(admin, gap.api_key_id, literal);
        if (!contextEntries.length) continue;

        const { error: updateErr } = await admin
          .from("api_response_generations")
          .update({ resolved_at: new Date().toISOString(), resolved_by_entry_id: contextEntries[0].id })
          .eq("id", gap.id);
        if (updateErr) console.error(`[CONTENT GAP TRIAGE] failed to mark ${gap.id} resolved: ${updateErr.message}`);
        else resolved++;
      } catch (e) {
        console.error(`[CONTENT GAP TRIAGE] resolution check failed for ${gap.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // ---- Phase B: clustering --------------------------------------------
  // Every real gap not yet assigned to a cluster, regardless of
  // resolution status -- a gap resolved by phase A above (or later)
  // simply never counts toward its cluster's live "unresolved
  // occurrences" total (list_gap_clusters_ranked's own join filters on
  // resolved_at IS NULL), so assigning it a cluster anyway is harmless
  // and keeps this phase's own query simple.
  let clustered = 0;
  let newClusters = 0;
  {
    const { data: rows, error } = await admin
      .from("api_response_generations")
      .select("id, user_id, api_key_id, message")
      .eq("grounding_check_intervened", true)
      .eq("is_test", false)
      .is("content_gap_cluster_id", null)
      .order("created_at", { ascending: true })
      .limit(MAX_GAPS_PER_SWEEP_PHASE);
    if (error) console.error(`[CONTENT GAP TRIAGE] fetching clusterable gaps failed: ${error.message}`);
    const candidates = (rows ?? []) as ClusterableCandidate[];

    for (const gap of candidates) {
      try {
        const embedding = await generateLocalEmbedding(gap.message);
        if (!embedding) continue;
        const literal = formatEmbeddingLiteral(embedding);

        const { data: clusterRows, error: rpcErr } = await admin.rpc("search_gap_clusters", {
          _api_key_id: gap.api_key_id, _embedding: literal, _limit: 1,
        });
        if (rpcErr) { console.error(`[CONTENT GAP TRIAGE] search_gap_clusters failed for ${gap.id}: ${rpcErr.message}`); continue; }

        const match = pickMatchingCluster((clusterRows ?? []) as GapClusterCandidate[]);
        let clusterId = match?.id ?? null;

        if (!clusterId) {
          const { data: newCluster, error: insertErr } = await admin
            .from("content_gap_clusters")
            .insert({
              user_id: gap.user_id,
              api_key_id: gap.api_key_id,
              representative_message: gap.message,
              embedding: literal,
            })
            .select("id")
            .maybeSingle();
          if (insertErr || !newCluster?.id) {
            console.error(`[CONTENT GAP TRIAGE] failed to create cluster for ${gap.id}: ${insertErr?.message}`);
            continue;
          }
          clusterId = newCluster.id;
          newClusters++;
        }

        const { error: updateErr } = await admin
          .from("api_response_generations")
          .update({ content_gap_cluster_id: clusterId })
          .eq("id", gap.id);
        if (updateErr) console.error(`[CONTENT GAP TRIAGE] failed to assign cluster for ${gap.id}: ${updateErr.message}`);
        else clustered++;
      } catch (e) {
        console.error(`[CONTENT GAP TRIAGE] clustering failed for ${gap.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return json({ ok: true, resolved, clustered, newClusters });
});
