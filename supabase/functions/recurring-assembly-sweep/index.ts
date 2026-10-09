// GAP 1 (Persistent Ongoing Enforcement, 2026-10-09): checkAgentAssembly and
// checkWebsiteAssembly (_shared/final-assembly-check.ts) already re-validate
// a delivered agent/website against the account's CURRENT rule set -- but
// before this, each was wired into exactly ONE one-time checkpoint:
// checkAgentAssembly only ever ran from agent-runtime's first-deploy gate
// (confirmed: no other caller in supabase/functions), checkWebsiteAssembly
// only ever ran from the manual publish button (final-assembly-check/
// index.ts, called by GeneratedDashboard.tsx). A hard/safety rule added or
// changed AFTER that one checkpoint already passed is never re-enforced
// against an already-delivered artifact until someone happens to republish
// or re-deploy it. This sweep makes that re-validation PERSISTENT: it calls
// the exact same two functions, with zero new validation logic, against
// every agent and every website for every account, on a schedule (see the
// accompanying migration for the cron registration).
//
// Deliberately NOT paginated across invocations -- same "pull everything
// the sweep's own filter matches, loop" shape every other sweep in this
// codebase already uses (stuck-approval-sweep, retention-sweep, etc.). If
// account volume ever makes a single run too slow, that's a real, separate
// performance problem to solve when it happens, not a reason to add
// cursor/batching complexity nothing here needs yet.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkAgentAssembly, checkWebsiteAssembly } from "../_shared/final-assembly-check.ts";
import { areConsequentialSweepsPaused } from "../_shared/consequential-sweep-pause.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  // Same opt-out every other consequential sweep in this codebase already
  // respects -- this sweep redacts content and strips tools, same class of
  // real, state-changing action as the sweeps that already check this.
  if (await areConsequentialSweepsPaused(admin)) {
    return json({ ok: true, skipped: true, reason: "consequential sweeps are paused" });
  }

  let agentsChecked = 0, agentsRepaired = 0, agentErrors = 0;
  let websitesChecked = 0, websitesRepaired = 0, websitesBlocked = 0, websiteErrors = 0;

  const { data: agentRows, error: agentErr } = await admin.from("agents").select("id, user_id");
  if (agentErr) return json({ error: agentErr.message }, 500);
  for (const row of (agentRows ?? []) as { id: string; user_id: string }[]) {
    agentsChecked++;
    try {
      const report = await checkAgentAssembly(admin, row.user_id, row.id);
      if (report.repaired) agentsRepaired++;
    } catch (e) {
      agentErrors++;
      console.error("recurring-assembly-sweep: checkAgentAssembly failed", { agentId: row.id, error: e });
    }
  }

  const { data: websiteRows, error: websiteErr } = await admin.from("websites").select("id, user_id, generation_notes");
  if (websiteErr) return json({ error: websiteErr.message }, 500);
  for (const row of (websiteRows ?? []) as { id: string; user_id: string; generation_notes: string[] | null }[]) {
    websitesChecked++;
    try {
      const report = await checkWebsiteAssembly(admin, row.user_id, row.id);
      if (report.repaired) websitesRepaired++;
      // A sweep-discovered block (content that passed its last check but
      // now matches a block-severity rule with nothing redactable) can't
      // un-publish a live site -- that decision needs a human, same as any
      // other escalation. Surfacing it as a note on the row itself is this
      // sweep's job; GAP 3's control-report work is what makes a human
      // actually see it without being told separately. Merges onto the
      // existing notes array (same read-merge-write pattern GeneratedDashboard.tsx's
      // own publish flow already uses) rather than overwriting whatever
      // history was already there.
      if (report.blocked) {
        websitesBlocked++;
        const note = `This site was flagged at a recurring assembly check on ${new Date().toISOString().slice(0, 10)}: ${report.blockReason}`;
        const existingNotes = Array.isArray(row.generation_notes) ? row.generation_notes : [];
        if (!existingNotes.includes(note)) {
          await admin.from("websites").update({ generation_notes: [...existingNotes, note] }).eq("id", row.id);
        }
      }
    } catch (e) {
      websiteErrors++;
      console.error("recurring-assembly-sweep: checkWebsiteAssembly failed", { websiteId: row.id, error: e });
    }
  }

  return json({
    ok: true,
    agents: { checked: agentsChecked, repaired: agentsRepaired, errors: agentErrors },
    websites: { checked: websitesChecked, repaired: websitesRepaired, blocked: websitesBlocked, errors: websiteErrors },
  });
});
