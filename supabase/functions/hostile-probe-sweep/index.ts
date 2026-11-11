// Safe input & output handling, front 6: the standing live probe.
//
// Once a day this sends the hostile set (_shared/hostile-corpus.ts) to every public and API-key function of the live project, and an
// empty request with only the public key to every function that needs a signed-in user or the server key (the "stranger" check that
// used to be run by hand after each deploy). A 500, a time-out, a stack trace or a key in an answer, a public function accepting a
// request it must refuse, or a protected function answering a stranger opens one platform incident ("hostile_probe") naming each
// failure; a clean run closes it. Nothing it sends can start paid work (see the corpus), and it changes no data.
// Server key only. A full probe is several hundred calls, more than one request may make to other functions (see PROBE_BATCHES in the
// corpus), so it runs in PROBE_BATCHES batches: { "batch": 0 } ... { "batch": 17 }, all started together by the scheduler at 04:17 UTC,
// each as its own request (job "hostile-probe-daily", logged per batch as "hostile-probe-daily:<n>"; see docs/safe-input-output.md).
// Each batch keeps its own incident ("hostile_probe:<n>of<total>"). { "only": ["nazai-chat"], "batch": 0, "batches": 1 } limits a run
// (and records no incident). A run that would make more than MAX_CALLS_PER_RUN calls is refused.
import "../_shared/redact-console.ts"; // first: secrets never reach the function logs
import "../_shared/outbound-guard.ts"; // second: no request carries a NazAI credential to a host it does not belong to
import { readJson } from "../_shared/input.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";
import { timingSafeEqual } from "../_shared/timing-safe.ts";
import { FUNCTION_ACCESS } from "../_shared/function-access.ts";
import { MAX_CALLS_PER_RUN, PROBE_BATCHES, PROBE_SKIP, batchOf, describeFetchError, judge, p95, probeJobs, withRetry, type Attempt, type ProbeResult } from "../_shared/hostile-corpus.ts";
import { openIncidentOnce, resolveIncidents } from "../_shared/provider-health.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const TIMEOUT_MS = 15_000;
const CONCURRENCY = 3;
const INCIDENT = "hostile_probe";
async function sendOnce(url: string, anonKey: string, body: string): Promise<Attempt> {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { method: "POST", body, headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${anonKey}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = (await r.text().catch(() => "")).slice(0, 20_000);
    return { status: r.status, text, ms: Date.now() - t0 };
  } catch (e) {
    return { status: null, text: "", ms: Date.now() - t0, error: describeFetchError(e), budget: e instanceof Error && e.name === "RateLimitError" };
  }
}

// A request that got no answer at all is tried once more before it counts as a failure; a time-out or the call budget running out is not.
const send = (url: string, anonKey: string, body: string) => withRetry(() => sendOnce(url, anonKey, body), TIMEOUT_MS);

async function pool<T>(jobs: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => { while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); } }));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!serviceKey || !timingSafeEqual(token, serviceKey)) return json({ error: "unauthorized" }, 401);
  const inputRead = await readJson(req, { headers: corsHeaders, maxBytes: 16 * 1024 });
  if (!inputRead.ok) return inputRead.response;
  const input = inputRead.value as Record<string, unknown>;
  const only = Array.isArray(input.only) ? new Set((input.only as unknown[]).filter((x): x is string => typeof x === "string")) : null;
  const batches = input.batches ?? (only ? 1 : PROBE_BATCHES);
  const batch = input.batch ?? (only ? 0 : undefined);
  if (!Number.isInteger(batches) || (batches as number) < 1 || (batches as number) > 100) return json({ error: "batches must be a whole number from 1 to 100" }, 400);
  if (!Number.isInteger(batch) || (batch as number) < 0 || (batch as number) >= (batches as number)) return json({ error: `batch must be a whole number from 0 to ${(batches as number) - 1}` }, 400);

  const base = `${Deno.env.get("SUPABASE_URL")}/functions/v1/`;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const access = only ? Object.fromEntries(Object.entries(FUNCTION_ACCESS).filter(([fn]) => only.has(fn))) : FUNCTION_ACCESS;
  const all = probeJobs(access, PROBE_SKIP);
  const mine = batchOf(all, batch as number, batches as number);
  if (mine.length > MAX_CALLS_PER_RUN) {
    return json({ error: `this run would make ${mine.length} calls; one run may make ${MAX_CALLS_PER_RUN}. Use at least ${Math.ceil(all.length / MAX_CALLS_PER_RUN)} batches.` }, 400);
  }

  const budgetNote = "the probe ran out of its call budget before reaching this function (not a failure of the function)";
  const jobs: (() => Promise<ProbeResult>)[] = mine.map((j) => async () => {
    const body = j.hostile ? j.hostile.body : "{}";
    const r = await send(base + j.fn, anonKey, body);
    if (r.budget) return { fn: j.fn, case: j.hostile?.name ?? "stranger (public key only)", status: null, ms: r.ms, problem: budgetNote, error: r.error };
    if (j.hostile) return { fn: j.fn, case: j.hostile.name, status: r.status, ms: r.ms, problem: judge(j.hostile, r.status, r.text, r.ms, TIMEOUT_MS), error: r.error };
    const refused = r.status !== null && [400, 401, 403, 404, 405, 429].includes(r.status);
    const problem = refused ? judge({ name: "stranger", body: "{}", mustRefuse: true, readerStatus: null }, r.status, r.text, r.ms, TIMEOUT_MS)
      : r.status === null ? (r.ms >= TIMEOUT_MS ? "no answer within the time limit" : "the request failed (network)") : `answered a stranger with ${r.status}`;
    return { fn: j.fn, case: "stranger (public key only)", status: r.status, ms: r.ms, problem, error: r.error };
  });
  const results = await pool(jobs, CONCURRENCY);
  const failures = results.filter((r) => r.problem);
  const summary = {
    ok: failures.length === 0,
    checked: results.length,
    batch: `${(batch as number) + 1} of ${batches}`,
    functions: new Set(mine.map((j) => j.fn)).size,
    p95_ms: p95(results.map((r) => r.ms)),
    failures: failures.slice(0, 50).map((f) => ({ fn: f.fn, case: f.case, status: f.status, problem: f.problem, ...(f.error ? { error: f.error } : {}) })),
  };

  const incident = `${INCIDENT}:${(batch as number) + 1}of${batches}`;
  if (!only && batches === PROBE_BATCHES) {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
    if (failures.length) {
      const names = [...new Set(failures.map((f) => f.fn))];
      await openIncidentOnce(admin, incident, `The daily hostile-input probe (batch ${(batch as number) + 1} of ${batches}) found ${failures.length} problem(s) in ${names.length} function(s): ${names.slice(0, 6).join(", ")}${names.length > 6 ? ", …" : ""}.`, { failures: summary.failures, checked: summary.checked });
    } else {
      await resolveIncidents(admin, [incident], "This batch of the daily hostile-input probe ran clean.");
    }
  }
  console.log(`[hostile-probe] batch ${summary.batch}: checked ${summary.checked}, failures ${failures.length}, p95 ${summary.p95_ms} ms`);
  return json(summary);
});
