import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldAlert, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
// Stale generated types: control-system tables aren't in types.ts yet.
const anyDb = supabase as any;
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

type SweepJobLastRun = { job_name: string; last_run_at: string | null; last_status: string | null };
type ConsequentialSweepActivity = {
  keys_paused: number;
  keys_downgraded_abuse: number;
  keys_downgraded_outcome: number;
  approvals_auto_resolved: number;
  coordinated_abuse_flagged: number;
};

const CONSEQUENTIAL_SWEEP_JOB_NAMES = new Set([
  "control-api-abuse-sweep-every-15min",
  "outcome-quality-sweep-daily",
  "stuck-approval-sweep-every-30min",
]);

type PlatformIncident = {
  id: string;
  kind: string;
  summary: string;
  detail: Record<string, unknown> | null;
  created_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
};

/**
 * PLATFORM INCIDENTS — hidden operator page, not linked in the customer
 * nav. Lists platform_incidents (NazAI's own scheduled-job failures, not
 * scoped to any customer account) opened by cron-health-check. Gated
 * client-side by the same global admin/owner role check KillSwitchPanel
 * uses; RLS is the real enforcement either way.
 */
export default function OpsPlatformIncidents() {
  const { user } = useAuth();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [incidents, setIncidents] = useState<PlatformIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [busy, setBusy] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [sweepJobs, setSweepJobs] = useState<SweepJobLastRun[]>([]);
  const [sweepActivity, setSweepActivity] = useState<ConsequentialSweepActivity | null>(null);
  const [sweepLoading, setSweepLoading] = useState(true);

  useEffect(() => {
    if (!user) { setAuthorized(false); return; }
    anyDb
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .in("role", ["admin", "owner"])
      .maybeSingle()
      .then(({ data }) => setAuthorized(Boolean(data)));
  }, [user]);

  const load = useCallback(async () => {
    if (!authorized) return;
    setLoading(true);
    let query = anyDb
      .from("platform_incidents")
      .select("id, kind, summary, detail, created_at, resolved_at, resolution_note")
      .order("created_at", { ascending: false });
    if (filter === "open") query = query.is("resolved_at", null);
    const { data, error } = await query;
    if (error) toast({ title: "Couldn't load platform incidents", description: error.message, variant: "destructive" });
    setIncidents((data ?? []) as unknown as PlatformIncident[]);
    setLoading(false);
  }, [authorized, filter]);

  useEffect(() => { load(); }, [load]);

  // "Sweep safety & observability" plan, items 1+2: last-run status for
  // every sweep-shaped cron job (cron.job_run_details -- proves the SQL
  // command ran, not that the target function returned 2xx) plus a
  // real 24h blast-radius count for the 3 sweeps that take hard-to-reverse
  // account-state action (pauses, downgrades, auto-resolutions). Both RPCs
  // are admin/owner-gated server-side (see the migration), same audience
  // as platform_incidents above.
  const loadSweepActivity = useCallback(async () => {
    if (!authorized) return;
    setSweepLoading(true);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [jobsRes, activityRes] = await Promise.all([
      anyDb.rpc("get_sweep_job_last_runs"),
      anyDb.rpc("get_consequential_sweep_activity", { _since: since }),
    ]);
    if (jobsRes.error) toast({ title: "Couldn't load sweep job status", description: jobsRes.error.message, variant: "destructive" });
    if (activityRes.error) toast({ title: "Couldn't load sweep blast-radius", description: activityRes.error.message, variant: "destructive" });
    setSweepJobs((jobsRes.data ?? []) as SweepJobLastRun[]);
    const activityRow = (activityRes.data ?? [])[0] as ConsequentialSweepActivity | undefined;
    setSweepActivity(activityRow ?? null);
    setSweepLoading(false);
  }, [authorized]);

  useEffect(() => { loadSweepActivity(); }, [loadSweepActivity]);

  const resolve = async (incident: PlatformIncident) => {
    setBusy(incident.id);
    const { error } = await anyDb
      .from("platform_incidents")
      .update({ resolved_at: new Date().toISOString(), resolution_note: noteDrafts[incident.id] || null })
      .eq("id", incident.id)
      .is("resolved_at", null);
    setBusy(null);
    if (error) {
      toast({ title: "Couldn't resolve it", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Resolved", description: incident.kind });
    load();
  };

  if (authorized === null) {
    return <div className="flex min-h-screen items-center justify-center text-zinc-500" style={{ backgroundColor: "#020617" }}>Loading…</div>;
  }
  if (!authorized) {
    return (
      <div className="flex min-h-screen items-center justify-center text-zinc-500" style={{ backgroundColor: "#020617" }}>
        Not authorized.
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full text-white" style={{ backgroundColor: "#020617" }}>
      <header className="flex items-center gap-3 border-b border-white/5 px-6 py-4">
        <ShieldAlert className="h-5 w-5 text-amber-300" />
        <h1 className="text-lg font-semibold">Platform incidents</h1>
        <nav className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setFilter("open")}
            className={`rounded border px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider ${
              filter === "open" ? "border-rose-500/40 bg-rose-500/10 text-rose-300" : "border-white/15 bg-white/5 text-zinc-300 hover:bg-white/10"
            }`}
          >
            Open
          </button>
          <button
            onClick={() => setFilter("all")}
            className={`rounded border px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider ${
              filter === "all" ? "border-white/40 bg-white/10 text-white" : "border-white/15 bg-white/5 text-zinc-300 hover:bg-white/10"
            }`}
          >
            All
          </button>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-8">
        <p className="text-sm text-zinc-400">
          NazAI's own scheduled jobs (cron-triggered edge functions), not scoped to any customer account.
          Opened automatically by cron-health-check when a job's HTTP response isn't 2xx.
        </p>

        <section className="mt-6 rounded border border-white/10 bg-white/[0.02] p-4">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            <Activity className="h-3.5 w-3.5 text-cyan-400" /> Sweep activity (last 24h)
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Real blast-radius counts for the 3 sweeps that take hard-to-reverse account-state action. Use the
            hidden kill-switch panel's "Consequential sweeps" toggle to pause all 3 immediately if these look wrong.
          </p>
          {sweepLoading ? (
            <p className="mt-4 font-mono text-xs uppercase text-zinc-500">Loading…</p>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                { label: "Keys paused", value: sweepActivity?.keys_paused ?? 0, tone: (sweepActivity?.keys_paused ?? 0) > 0 },
                { label: "Downgraded (abuse)", value: sweepActivity?.keys_downgraded_abuse ?? 0, tone: (sweepActivity?.keys_downgraded_abuse ?? 0) > 0 },
                { label: "Downgraded (outcomes)", value: sweepActivity?.keys_downgraded_outcome ?? 0, tone: (sweepActivity?.keys_downgraded_outcome ?? 0) > 0 },
                { label: "Approvals auto-resolved", value: sweepActivity?.approvals_auto_resolved ?? 0, tone: (sweepActivity?.approvals_auto_resolved ?? 0) > 0 },
                { label: "Coordinated-abuse flags", value: sweepActivity?.coordinated_abuse_flagged ?? 0, tone: (sweepActivity?.coordinated_abuse_flagged ?? 0) > 0 },
              ].map((s) => (
                <div key={s.label} className={`rounded border p-3 ${s.tone ? "border-amber-500/30 bg-amber-500/[0.04]" : "border-white/10 bg-white/[0.02]"}`}>
                  <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">{s.label}</div>
                  <div className="mt-1 text-xl font-semibold text-white">{s.value}</div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">Sweep job last runs</div>
          {sweepLoading ? (
            <p className="mt-2 font-mono text-xs uppercase text-zinc-500">Loading…</p>
          ) : sweepJobs.length === 0 ? (
            <p className="mt-2 text-xs text-zinc-500">No sweep-shaped cron jobs found.</p>
          ) : (
            <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto text-xs text-zinc-300">
              {sweepJobs.map((j) => {
                const isConsequential = CONSEQUENTIAL_SWEEP_JOB_NAMES.has(j.job_name);
                const failed = j.last_status != null && j.last_status !== "succeeded";
                return (
                  <li key={j.job_name} className="flex items-center gap-2">
                    {failed ? (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                    ) : j.last_run_at ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                    )}
                    <span className={`truncate font-mono ${isConsequential ? "text-amber-300" : "text-zinc-300"}`}>{j.job_name}</span>
                    <span className="ml-auto shrink-0 text-zinc-500">
                      {j.last_run_at ? new Date(j.last_run_at).toLocaleString() : "never run"}
                      {j.last_status && ` · ${j.last_status}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {loading ? (
          <p className="mt-8 font-mono text-xs uppercase text-zinc-500">Loading…</p>
        ) : incidents.length === 0 ? (
          <p className="mt-6 rounded border border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-500">
            {filter === "open" ? "No open platform incidents." : "No platform incidents recorded yet."}
          </p>
        ) : (
          <ul className="mt-6 space-y-3">
            {incidents.map((incident) => (
              <li key={incident.id} className="rounded border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-start gap-2">
                  {incident.resolved_at ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[11px] uppercase tracking-wider text-zinc-300">{incident.kind}</div>
                    <p className="mt-1 text-sm text-zinc-300">{incident.summary}</p>
                    <div className="mt-1 font-mono text-[10px] text-zinc-500">
                      Opened {new Date(incident.created_at).toLocaleString()}
                      {incident.resolved_at && ` · resolved ${new Date(incident.resolved_at).toLocaleString()}`}
                    </div>
                    {incident.resolution_note && <p className="mt-1 text-xs text-zinc-400">Note: {incident.resolution_note}</p>}
                  </div>
                </div>
                {!incident.resolved_at && (
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Resolution note (optional)"
                      value={noteDrafts[incident.id] || ""}
                      onChange={(e) => setNoteDrafts((d) => ({ ...d, [incident.id]: e.target.value }))}
                      className="flex-1 rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600"
                    />
                    <button
                      disabled={busy === incident.id}
                      onClick={() => resolve(incident)}
                      className="flex items-center gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 font-mono text-[11px] uppercase text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
