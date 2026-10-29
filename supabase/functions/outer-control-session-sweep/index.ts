// Outer Control (active): keeps sessions moving without anyone watching.
// Every minute (pg_cron, service role): resume sessions whose approval has been
// resolved, advance sessions that are mid-run (a driver was cut off or a retry is
// due), end sessions that have waited for a person too long, and re-test the connection of tools that are in use.
import "../_shared/redact-console.ts"; // first: secrets never reach the function logs
import { createClient, createPlainClient } from "../_shared/encrypted-client.ts"; // encrypts Outer Control content (data encryption, front 3)
import { areConsequentialSweepsPaused } from "../_shared/consequential-sweep-pause.ts";
import { contactRuleStopping, resumeSession } from "../_shared/outer-control-session.ts";
import { liveTest, runKeepAlive } from "../_shared/outer-control-keepalive.ts";
import { checkKillSwitches } from "../_shared/control-gate.ts";
import { validateOutboundUrl } from "../_shared/url-safety.ts";
import { sendCriticalAlert } from "../_shared/critical-alerts.ts";
import { driveSession, progressWorkflow } from "../_shared/outer-control-workflow.ts";
import { refingerprintProjects, reencryptProjects, sealLegacyProjects } from "../_shared/projects.ts";
import { dataKeysFromEnv } from "../_shared/field-crypto.ts";
import { sweepEncryptedColumns } from "../_shared/encrypted-db.ts";
import { projectKeysFromEnv } from "../_shared/project-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BATCH = 10;
const WAIT_LIMIT_MS = 7 * 24 * 60 * 60 * 1000; // a person has a week to answer

const dataKeys = dataKeysFromEnv();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if ((req.headers.get("Authorization") ?? "") !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  // Not a consequential step, so it runs even while those are paused: imported projects saved before encryption get encrypted,
  // during a key rotation the ones still on the previous key are re-encrypted with the new one, and fingerprints made before
  // keyed ones (or with a previous DATA_KEY) are made again. Without DATA_KEY that last part waits; nothing else depends on it.
  let sealed = 0;
  let projectKey = { moved: 0, left: 0 };
  let fingerprints = { moved: 0, left: 0 };
  try {
    const keys = await projectKeysFromEnv();
    sealed = await sealLegacyProjects(admin, keys);
    projectKey = await reencryptProjects(admin, keys);
    fingerprints = await refingerprintProjects(admin, keys, await dataKeys);
  } catch (e) { console.error("sealing projects failed:", e instanceof Error ? e.message : e); }

  // Outer Control content written before encryption (or by a path that does not encrypt) is encrypted, and during a DATA_KEY
  // rotation values on the previous key are moved, a batch per column every five minutes. Not consequential either.
  let encryption: Record<string, number> | null = null;
  if (new Date().getUTCMinutes() % 5 === 0) {
    try { encryption = await sweepEncryptedColumns(createPlainClient(Deno.env.get("SUPABASE_URL")!, serviceKey), await dataKeys); }
    catch (e) { console.error("encrypting stored content failed:", e instanceof Error ? e.message : e); }
  }

  if (await areConsequentialSweepsPaused(admin)) return json({ ok: true, skipped: true, reason: "consequential sweeps are paused" });

  const now = Date.now();
  const out = { sealed, project_key: projectKey, project_fingerprints: fingerprints, encryption, resumed: 0, advanced: 0, expired: 0, workflows: 0, errors: 0, keepalive: { tested: 0, failed: 0, skipped: 0, broke: 0 } };

  // 1. Paused sessions: resume or end them if what they waited for has happened.
  const { data: waiting } = await admin.from("outer_control_sessions")
    .select("id, updated_at").eq("status", "awaiting_human").order("updated_at", { ascending: true }).limit(BATCH * 3);
  for (const s of (waiting ?? []) as { id: string; updated_at: string }[]) {
    try {
      if (now - Date.parse(s.updated_at) > WAIT_LIMIT_MS) {
        await admin.from("outer_control_sessions").update({
          status: "stopped", stop_reason: "Nobody answered within 7 days.", finished_at: new Date(now).toISOString(),
          updated_at: new Date(now).toISOString(), pending_kind: null, pending_approval_id: null,
        }).eq("id", s.id).eq("status", "awaiting_human");
        out.expired++;
        continue;
      }
      const r = await resumeSession(admin, s.id);
      if (r.resumed) out.resumed++;
    } catch (e) { out.errors++; console.error("session-sweep resume failed:", s.id, e instanceof Error ? e.message : e); }
  }

  // 2. Running sessions nobody is driving (lease expired or never taken).
  const { data: running } = await admin.from("outer_control_sessions")
    .select("id").eq("status", "running")
    .or(`lease_until.is.null,lease_until.lt.${new Date(now).toISOString()}`)
    .order("updated_at", { ascending: true }).limit(BATCH);
  for (const s of (running ?? []) as { id: string }[]) {
    try { await driveSession(admin, s.id); out.advanced++; }
    catch (e) { out.errors++; console.error("session-sweep advance failed:", s.id, e instanceof Error ? e.message : e); }
  }

  // 3. Workflows: start legs whose dependencies finished, cancel legs that can never run,
  //    keep each workflow's status current.
  const { data: open } = await admin.from("outer_control_workflows")
    .select("id").in("status", ["running", "awaiting_human"]).order("updated_at", { ascending: true }).limit(BATCH);
  for (const w of (open ?? []) as { id: string }[]) {
    try {
      const started = await progressWorkflow(admin, w.id);
      await Promise.all(started.map((id) => driveSession(admin, id)));
      out.workflows++;
    } catch (e) { out.errors++; console.error("session-sweep workflow failed:", w.id, e instanceof Error ? e.message : e); }
  }

  // 4. Keep-alive: the same real connection test as the Test button, for tools in use that have not been checked for 12 hours.
  try {
    out.keepalive = await runKeepAlive(admin, {
      now: Date.now,
      test: liveTest(admin, { fetchImpl: fetch, validateUrl: validateOutboundUrl, now: Date.now, timeoutMs: 20_000 }),
      gate: async (tool) => {
        const kill = await checkKillSwitches(admin as never, tool.user_id, null);
        if (kill.killed) return "skip";
        return await contactRuleStopping(admin, tool.user_id, tool.name);
      },
      onBroke: async (tool, reason) => {
        await sendCriticalAlert(admin as never, tool.user_id, { event: "outer_control_tool_down", skipIncident: true, summary: `"${tool.name}" stopped working: ${reason.slice(0, 200)} Open Outer Control to test it again or update its key.` });
      },
    });
  } catch (e) { out.errors++; console.error("session-sweep keep-alive failed:", e instanceof Error ? e.message : e); }
  return json({ ok: true, ...out });
});
