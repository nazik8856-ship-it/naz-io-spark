// Cron-triggered fanout: find agents due for a run and invoke agent-runtime.
// Called by pg_cron every minute via net.http_post.
// Uses the service role to bypass RLS for the scheduler scan.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const results: { id: string; ok: boolean }[] = [];
    for (const a of due || []) {
      const next = computeNextRun(a.schedule_cron as string | null);
      await supabase.from("agents").update({ next_run_at: next }).eq("id", a.id);
      try {
        // Fire and forget — runtime is service-role authenticated via header
        fetch(fnUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
            "x-scheduler-user-id": a.user_id as string,
          },
          body: JSON.stringify({ agentId: a.id, trigger: "cron" }),
        }).catch((e) => console.warn("scheduler invoke failed", a.id, e));
        results.push({ id: a.id as string, ok: true });
      } catch (e) {
        results.push({ id: a.id as string, ok: false });
        console.warn("scheduler error", e);
      }
    }
    return json({ ranAt: nowIso, dispatched: results.length, results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

// Lightweight cron interpreter for the few presets we use. Falls back to +1h.
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
