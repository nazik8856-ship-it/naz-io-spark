// Safe input & output handling, front 6: the standing live probe.
//
// Once a day this sends the hostile set (_shared/hostile-corpus.ts) to every public and API-key function of the live project, and an
// empty request with only the public key to every function that needs a signed-in user or the server key (the "stranger" check that
// used to be run by hand after each deploy). A 500, a time-out, a stack trace or a key in an answer, a public function accepting a
// request it must refuse, or a protected function answering a stranger opens one platform incident ("hostile_probe") naming each
// failure; a clean run closes it. Nothing it sends can start paid work (see the corpus), and it changes no data.
// Server key only. Daily at 04:17 UTC (scheduled after deploy, like the other sweeps). { "only": ["nazai-chat"] } limits a run.
import "../_shared/redact-console.ts"; // first: secrets never reach the function logs
import { readJson } from "../_shared/input.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/timing-safe.ts";
import { FUNCTION_ACCESS } from "../_shared/function-access.ts";
import { HOSTILE_CASES, describeFetchError, judge, p95, withRetry, type Attempt, type ProbeResult } from "../_shared/hostile-corpus.ts";
import { openIncidentOnce, resolveIncidents } from "../_shared/provider-health.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const TIMEOUT_MS = 15_000;
// Few requests at a time: a burst of parallel calls from one function to the same project drops connections before they reach the
// target (seen on the first live run), which would read as a broken function.
const CONCURRENCY = 3;
const INCIDENT = "hostile_probe";
// Signing in is optional for these: a stranger gets an answer with only what a stranger may see, so the stranger check does not apply,
// and their valid requests start a generation, so the hostile set is not sent either.
const SKIP = new Set(["analyze-inputs", "compile-agent-manifest", "compile-website-manifest", "hostile-probe-sweep"]);
// The generated MCP bundle speaks the MCP protocol, not JSON bodies; it has its own tests.
const NOT_DEPLOYED = new Set(["mcp"]);

async function sendOnce(url: string, anonKey: string, body: string): Promise<Attempt> {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { method: "POST", body, headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${anonKey}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = (await r.text().catch(() => "")).slice(0, 20_000);
    return { status: r.status, text, ms: Date.now() - t0 };
  } catch (e) {
    return { status: null, text: "", ms: Date.now() - t0, error: describeFetchError(e) };
  }
}

// A request that got no answer at all is tried again (up to 3 times) before it counts as a failure; a time-out is not.
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
  const only = Array.isArray(inputRead.value.only) ? new Set((inputRead.value.only as unknown[]).filter((x): x is string => typeof x === "string")) : null;

  const base = `${Deno.env.get("SUPABASE_URL")}/functions/v1/`;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const entries = Object.entries(FUNCTION_ACCESS).filter(([fn]) => !SKIP.has(fn) && !NOT_DEPLOYED.has(fn) && (!only || only.has(fn)));
  const hostileTargets = entries.filter(([, a]) => a.access === "public" || a.access === "api_key").map(([fn]) => fn);
  const strangerTargets = entries.filter(([, a]) => a.access === "user" || a.access === "system").map(([fn]) => fn);

  const jobs: (() => Promise<ProbeResult>)[] = [];
  for (const fn of hostileTargets) for (const c of HOSTILE_CASES) {
    jobs.push(async () => { const r = await send(base + fn, anonKey, c.body); return { fn, case: c.name, status: r.status, ms: r.ms, problem: judge(c, r.status, r.text, r.ms, TIMEOUT_MS), error: r.error }; });
  }
  for (const fn of strangerTargets) {
    jobs.push(async () => {
      const r = await send(base + fn, anonKey, "{}");
      const refused = r.status !== null && [400, 401, 403, 404, 405, 429].includes(r.status);
      const problem = refused ? judge({ name: "stranger", body: "{}", mustRefuse: true, readerStatus: null }, r.status, r.text, r.ms, TIMEOUT_MS)
        : r.status === null ? (r.ms >= TIMEOUT_MS ? "no answer within the time limit" : "the request failed (network)") : `answered a stranger with ${r.status}`;
      return { fn, case: "stranger (public key only)", status: r.status, ms: r.ms, problem, error: r.error };
    });
  }
  const results = await pool(jobs, CONCURRENCY);
  const failures = results.filter((r) => r.problem);
  const summary = {
    ok: failures.length === 0,
    checked: results.length,
    functions: { hostile: hostileTargets.length, stranger: strangerTargets.length },
    p95_ms: p95(results.map((r) => r.ms)),
    failures: failures.slice(0, 50).map((f) => ({ fn: f.fn, case: f.case, status: f.status, problem: f.problem, ...(f.error ? { error: f.error } : {}) })),
  };

  if (!only) {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
    if (failures.length) {
      const names = [...new Set(failures.map((f) => f.fn))];
      await openIncidentOnce(admin, INCIDENT, `The daily hostile-input probe found ${failures.length} problem(s) in ${names.length} function(s): ${names.slice(0, 6).join(", ")}${names.length > 6 ? ", …" : ""}.`, { failures: summary.failures, checked: summary.checked });
    } else {
      await resolveIncidents(admin, [INCIDENT], "The daily hostile-input probe ran clean.");
    }
  }
  console.log(`[hostile-probe] checked ${summary.checked}, failures ${failures.length}, p95 ${summary.p95_ms} ms`);
  return json(summary);
});
