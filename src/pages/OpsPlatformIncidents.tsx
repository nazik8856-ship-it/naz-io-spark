import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
// Stale generated types: control-system tables aren't in types.ts yet.
const anyDb = supabase as any;
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

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
