// Scheduled (pg_cron, every 30 min): checks whether recently-run scheduled
// jobs actually got a successful HTTP response, not just that pg_cron
// queued the request. This exists because pg_cron's own job_run_details
// only records whether the `net.http_post(...)` SQL call executed --
// net.http_post is fire-and-forget, so pg_cron reports "succeeded" even
// when the target function 401s or times out. That gap is exactly how the
// cron-auth vault-secret mismatch went undetected for every affected job.
//
// Each tracked cron job now also INSERTs its own net.http_post() request_id
// into scheduled_job_requests (see the migration). This function joins
// those rows against net._http_response and opens a platform_incidents row
// for any job whose latest run didn't come back 2xx -- deliberately a
// PLATFORM-level incident (not scoped to a NazAI customer's account), since
// these are NazAI's own operational jobs, not any one customer's data.
// Visible only to platform staff (has_role 'admin'/'owner'), same audience
// the pre-existing global RBAC system already serves.
//
// Assumes net._http_response retains rows for longer than this job's own
// LOOKBACK_MINUTES window (pg_net's default TTL is several hours) -- verify
// this holds on the real project once DB access is available; if pg_net's
// retention were shorter than the lookback, a genuinely healthy job could
// look like "no_response" purely because its response row already aged out.
//
// Second, unrelated check bolted onto this same 30-minute cadence rather
// than its own new cron job: every pgvector search RPC's search_path
// actually includes the `extensions` schema pgvector lives in on this
// project. See vector-rpc-search-path-health.ts for the real incident
// (search_decision_precedent/search_response_context/search_response_cache
// all silently failing) this exists to catch on day one of any future
// regression, instead of an unknown period of silent failure again.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { findUnhealthyJobs, jobsNeedingNewIncident, summarizeUnhealthyJob, type JobRequestOutcome } from "../_shared/cron-health.ts";
import { findBrokenVectorRpcs, vectorRpcIncidentKind, summarizeBrokenVectorRpc, type VectorRpcSearchPathRow } from "../_shared/vector-rpc-search-path-health.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const LOOKBACK_MINUTES = 90;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  // net._http_response lives in the `net` schema, which isn't exposed to
  // PostgREST -- get_job_health_outcomes() is a SECURITY DEFINER function
  // in `public` that does the join server-side and returns just this shape.
  const since = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000).toISOString();
  const { data: rows, error: rpcErr } = await admin.rpc("get_job_health_outcomes", { _since: since });
  if (rpcErr) return json({ error: rpcErr.message }, 500);

  const outcomes: JobRequestOutcome[] = ((rows ?? []) as {
    job_name: string; request_id: number; status_code: number | null; timed_out: boolean | null;
  }[]).map((r) => ({
    jobName: r.job_name,
    requestId: r.request_id,
    statusCode: r.status_code,
    timedOut: r.timed_out ?? false,
  }));

  const unhealthy = findUnhealthyJobs(outcomes);

  const { data: openIncidents } = await admin
    .from("platform_incidents")
    .select("kind")
    .is("resolved_at", null);
  const openKinds = (openIncidents ?? []).map((i) => i.kind as string);

  const toOpen = jobsNeedingNewIncident(unhealthy, openKinds);
  const opened: string[] = [];
  for (const u of toOpen) {
    const { error } = await admin.from("platform_incidents").insert({
      kind: u.jobName,
      summary: summarizeUnhealthyJob(u),
      detail: { reason: u.reason, request_id: u.requestId },
    });
    if (!error) opened.push(u.jobName);
    else console.error(`[CRON HEALTH] failed to open incident for ${u.jobName}: ${error.message}`);
  }

  if (opened.length > 0) {
    console.error(`[CRON HEALTH] opened ${opened.length} incident(s): ${opened.join(", ")}`);
  }

  // Second, independent check: does every pgvector search RPC's own
  // search_path actually include the schema pgvector lives in? A
  // metadata check, not a query -- calling the RPC itself can't be
  // trusted to catch this (Postgres never evaluates the `<=>` operator
  // against zero matching rows, so a fresh/quiet account would look
  // "healthy" even when genuinely broken). See
  // vector-rpc-search-path-health.ts for the real incident this exists
  // to prevent from recurring silently.
  const { data: vectorRpcRows, error: vectorRpcErr } = await admin.rpc("check_vector_rpc_search_paths");
  const vectorRpcOutcomes: VectorRpcSearchPathRow[] = vectorRpcErr
    ? []
    : ((vectorRpcRows ?? []) as { function_name: string; search_path_ok: boolean }[]).map((r) => ({
        functionName: r.function_name,
        searchPathOk: r.search_path_ok,
      }));
  if (vectorRpcErr) console.error(`[CRON HEALTH] check_vector_rpc_search_paths failed: ${vectorRpcErr.message}`);

  const brokenVectorRpcs = findBrokenVectorRpcs(vectorRpcOutcomes);
  const vectorRpcIncidentsOpened: string[] = [];
  for (const functionName of brokenVectorRpcs) {
    const kind = vectorRpcIncidentKind(functionName);
    if (openKinds.includes(kind)) continue;
    const { error } = await admin.from("platform_incidents").insert({
      kind,
      summary: summarizeBrokenVectorRpc(functionName),
      detail: { function_name: functionName },
    });
    if (!error) vectorRpcIncidentsOpened.push(functionName);
    else console.error(`[CRON HEALTH] failed to open incident for ${kind}: ${error.message}`);
  }
  if (vectorRpcIncidentsOpened.length > 0) {
    console.error(`[CRON HEALTH] opened ${vectorRpcIncidentsOpened.length} vector-rpc incident(s): ${vectorRpcIncidentsOpened.join(", ")}`);
  }

  return json({
    ok: true,
    checkedJobs: [...new Set(outcomes.map((o) => o.jobName))].length,
    unhealthy: unhealthy.map((u) => ({ job: u.jobName, reason: u.reason })),
    incidentsOpened: opened,
    vectorRpcsChecked: vectorRpcOutcomes.length,
    vectorRpcsBroken: brokenVectorRpcs,
    vectorRpcIncidentsOpened,
  });
});
