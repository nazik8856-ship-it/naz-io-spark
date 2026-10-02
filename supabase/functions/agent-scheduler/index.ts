// Cron-triggered fanout: find agents due for a run and invoke agent-runtime.
// Called by pg_cron every minute via net.http_post.
// Uses the service role to bypass RLS for the scheduler scan.
//
// Blueprint task #72: every dispatch to agent-runtime used to be pure
// fire-and-forget -- the fetch() promise was never awaited, its result
// array entry was pushed as `ok: true` unconditionally (before the promise
// even settled), and a `.catch()` only produced a console.warn no one
// reads. A network failure, timeout, or non-2xx response from agent-runtime
// left ZERO trace anywhere: for a cron-scheduled agent, next_run_at had
// already moved on to the next cycle as if the run happened; for a
// schedule_followup/"run once at" run, the agent_runs row sat at
// "dispatched" forever with nothing to ever flip it to a terminal status.
// Confirmed live: agent_runs is completely empty and zero agents currently
// have an active schedule configured, so this hasn't bitten a real
// customer yet -- but it's a dormant trap for the first one who sets up a
// scheduled agent, with no error message to even start debugging from.
//
// Fix: each dispatch now runs via runInBackground (EdgeRuntime.waitUntil)
// so the scheduler's own response still isn't blocked on the full agent
// run completing, but the eventual outcome is no longer discarded --
// a non-2xx/thrown dispatch fires scheduled_dispatch_failed (owner-facing,
// same posture as agent_clarification_needed: alerts immediately, no
// incident), and a schedule_followup run's tracking row is updated to a
// real terminal status (completed/failed) instead of staying "dispatched".
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendCriticalAlert } from "../_shared/critical-alerts.ts";
import { runInBackground } from "../_shared/background.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const nowIso = new Date().toISOString();
    const { data: due, error } = await supabase
      .from("agents")
      .select("id, user_id, schedule_cron, next_run_at")
      .eq("status", "active")
      .lte("next_run_at", nowIso)
      .not("next_run_at", "is", null)
      .limit(50);
    if (error) return json({ error: error.message }, 500);

    const fnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/agent-runtime`;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const results: { id: string; dispatched: boolean }[] = [];
    for (const a of due || []) {
      const agentId = a.id as string;
      const userId = a.user_id as string;
      const next = computeNextRun(a.schedule_cron as string | null);
      await supabase.from("agents").update({ next_run_at: next }).eq("id", agentId);
      // Dispatch runs in the background (not awaited here) so one slow agent
      // run can't block the other 49 in this batch or this function's own
      // response -- but its outcome is no longer discarded, see module doc.
      const dispatch = fetch(fnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
          "x-scheduler-user-id": userId,
        },
        body: JSON.stringify({ agentId, trigger: "cron" }),
      }).then(async (res) => {
        if (!res.ok) {
          const bodyText = await res.text().catch(() => "");
          await reportDispatchFailure(supabase, agentId, userId, `agent-runtime responded ${res.status}${bodyText ? `: ${bodyText.slice(0, 300)}` : ""}`);
        }
      }).catch(async (e) => {
        await reportDispatchFailure(supabase, agentId, userId, `request failed: ${e instanceof Error ? e.message : String(e)}`);
        throw e; // let runInBackground's own catch still log it
      });
      runInBackground(dispatch, `agent-scheduler:cron:${agentId}`);
      results.push({ id: agentId, dispatched: true });
    }
    // ------------------------------------------------------------------
    // Also poll scheduled follow-up runs (from schedule_followup tool or
    // "Run once at…" UI). Each due row is claimed via an atomic conditional
    // update so concurrent scheduler ticks can't double-fire it.
    // ------------------------------------------------------------------
    const scheduledResults: { id: string; dispatched: boolean }[] = [];
    const { data: dueRuns } = await supabase
      .from("agent_runs")
      .select("id, agent_id, user_id, instruction")
      .eq("status", "scheduled")
      .lte("scheduled_for", nowIso)
      .not("scheduled_for", "is", null)
      .limit(50);

    for (const r of dueRuns || []) {
      const trackingId = r.id as string;
      const agentId = r.agent_id as string;
      const userId = r.user_id as string;
      // Atomic claim — only one tick's update will affect the row.
      const { data: claimed, error: claimErr } = await supabase
        .from("agent_runs")
        .update({ status: "dispatched" })
        .eq("id", trackingId).eq("status", "scheduled")
        .select("id").maybeSingle();
      if (claimErr || !claimed) continue;

      // This tracking row (created by the "Run once at…" UI / schedule_followup
      // tool) is entirely separate from the real agent_runs row agent-runtime
      // inserts for its own run -- nothing ever linked the two, so it used to
      // sit at "dispatched" forever regardless of whether the run succeeded,
      // failed, or never started at all. Now resolved to a real terminal
      // status from the dispatch's own outcome.
      const dispatch = fetch(fnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
          "x-scheduler-user-id": userId,
        },
        body: JSON.stringify({
          agentId,
          trigger: "scheduled",
          userInstruction: (r.instruction as string | null) ?? undefined,
        }),
      }).then(async (res) => {
        const bodyJson = await res.json().catch(() => null) as { summary?: string; outcome?: string; skipped?: boolean; reason?: string } | null;
        if (res.ok && bodyJson && !bodyJson.skipped) {
          await supabase.from("agent_runs").update({
            status: "completed",
            finished_at: new Date().toISOString(),
            summary: bodyJson.summary ?? "Dispatched successfully.",
            outcome: bodyJson.outcome ?? "Completed",
          }).eq("id", trackingId);
          return;
        }
        const reason = !res.ok
          ? `agent-runtime responded ${res.status}`
          : bodyJson?.skipped
            ? `skipped: ${bodyJson.reason ?? "agent was already running"}`
            : "agent-runtime returned an unexpected response";
        await supabase.from("agent_runs").update({
          status: "failed",
          finished_at: new Date().toISOString(),
          summary: `[Failed to start] ${reason}`,
          outcome: "Failed",
        }).eq("id", trackingId);
        await reportDispatchFailure(supabase, agentId, userId, reason, trackingId);
      }).catch(async (e) => {
        const reason = `request failed: ${e instanceof Error ? e.message : String(e)}`;
        await supabase.from("agent_runs").update({
          status: "failed",
          finished_at: new Date().toISOString(),
          summary: `[Failed to start] ${reason}`,
          outcome: "Failed",
        }).eq("id", trackingId);
        await reportDispatchFailure(supabase, agentId, userId, reason, trackingId);
        throw e;
      });
      runInBackground(dispatch, `agent-scheduler:followup:${trackingId}`);
      scheduledResults.push({ id: trackingId, dispatched: true });
    }

    return json({
      ranAt: nowIso,
      dispatched: results.length,
      results,
      scheduledDispatched: scheduledResults.length,
      scheduledResults,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

/** Owner-facing alert for a dispatch that never actually started the agent -- see module doc comment. Never throws. */
async function reportDispatchFailure(
  supabase: SupabaseClient,
  agentId: string,
  userId: string,
  reason: string,
  followupRunId?: string,
): Promise<void> {
  try {
    const { data: agent } = await supabase.from("agents").select("name").eq("id", agentId).maybeSingle();
    const agentName = (agent as { name?: string } | null)?.name ?? "An agent";
    await sendCriticalAlert(supabase, userId, {
      event: "scheduled_dispatch_failed",
      summary: `${agentName}'s scheduled run failed to start: ${reason}`,
      actionType: null,
      provider: null,
    });
  } catch (e) {
    console.error("agent-scheduler: reportDispatchFailure itself failed", { agentId, followupRunId, reason, error: e });
  }
}

// Lightweight cron interpreter for the few presets we use. Falls back to +1h.
//
// This used to be missing the "every N hours" shape ("M */N * * *", e.g. the
// ops_finance role blueprint's default "0 */6 * * *") entirely -- it isn't
// "*/N * * * *" (that's every-N-minutes, matched first), isn't a plain HH:MM
// daily time, and isn't a weekly D field, so it fell all the way through to
// the +1h fallback below. Every agent scheduled for "every N hours" was
// silently re-armed for one hour later on each tick instead, drifting to an
// hourly cadence from its very first run. Matches the same regex already
// used (and test-covered) in ../_shared/agent-schedule.ts's nextRunFromCron.
function computeNextRun(cron: string | null): string {
  const now = new Date();
  if (!cron) { now.setHours(now.getHours() + 1); return now.toISOString(); }
  // "*/N * * * *"
  let m = cron.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (m) { now.setMinutes(now.getMinutes() + parseInt(m[1], 10)); return now.toISOString(); }
  // "M H * * *"  daily at HH:MM
  m = cron.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/);
  if (m) {
    const mm = parseInt(m[1], 10), hh = parseInt(m[2], 10);
    const next = new Date(now);
    next.setUTCHours(hh, mm, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString();
  }
  // "M */N * * *"  every N hours
  m = cron.match(/^(\d+)\s+\*\/(\d+)\s+\*\s+\*\s+\*$/);
  if (m) { now.setHours(now.getHours() + parseInt(m[2], 10)); return now.toISOString(); }
  // "M H * * D"  weekly
  m = cron.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+(\d+)$/);
  if (m) {
    const mm = parseInt(m[1], 10), hh = parseInt(m[2], 10), dow = parseInt(m[3], 10) % 7;
    const next = new Date(now);
    next.setUTCHours(hh, mm, 0, 0);
    const delta = (dow - next.getUTCDay() + 7) % 7;
    next.setUTCDate(next.getUTCDate() + (delta === 0 && next <= now ? 7 : delta));
    return next.toISOString();
  }
  now.setHours(now.getHours() + 1);
  return now.toISOString();
}
