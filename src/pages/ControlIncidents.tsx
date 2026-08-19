import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { filterBySearch } from "@/lib/search-filter";

type IncidentKind = "kill_switch_auto" | "circuit_breaker_trip" | "gate_error" | "self_audit_regression";
type IncidentStatus = "open" | "resolved";

type Incident = {
  id: string;
  kind: IncidentKind;
  status: IncidentStatus;
  summary: string;
  action_type: string | null;
  provider: string | null;
  decision_id: string | null;
  opened_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
};

const KIND_LABEL: Record<IncidentKind, string> = {
  kill_switch_auto: "Kill switch auto-tripped",
  circuit_breaker_trip: "Circuit breaker tripped",
  gate_error: "Control gate failed closed",
  self_audit_regression: "Self-audit regression",
};

/**
 * INCIDENTS — every automatic/abnormal safety event (not a deliberate human
 * toggle, not a rule doing its job) promoted from "a decision row plus an
 * alert" into a real object with a timeline and a resolution note.
 */
export default function ControlIncidents() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [busy, setBusy] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const visibleIncidents = filterBySearch(incidents, search, ["summary", "kind", "action_type", "provider"]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    let query = supabase
      .from("incidents")
      .select("id, kind, status, summary, action_type, provider, decision_id, opened_at, resolved_at, resolved_by, resolution_note")
      .eq("user_id", user.id)
      .order("opened_at", { ascending: false });
    if (filter === "open") query = query.eq("status", "open");
    const { data, error } = await query;
    if (error) toast({ title: "Couldn't load incidents", description: error.message, variant: "destructive" });
    setIncidents((data ?? []) as unknown as Incident[]);
    setLoading(false);
  }, [user, filter]);

  useEffect(() => { load(); }, [load]);

  const resolve = async (incident: Incident) => {
    setBusy(incident.id);
    const { data, error } = await supabase.functions.invoke(
      `control-incidents/${incident.id}/resolve`,
      { body: { note: noteDrafts[incident.id] || "" } },
    );
    setBusy(null);
    const res = (data ?? {}) as { ok?: boolean; already_resolved?: boolean };
    if (error && !res.ok) {
      toast({ title: "Couldn't resolve it", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: res.already_resolved ? "Already resolved" : "Resolved", description: incident.summary.slice(0, 120) });
    load();
  };

  return (
    <div className="min-h-screen w-full text-white" style={{ backgroundColor: "#020617" }}>
      <header className="flex items-center gap-3 border-b border-white/5 px-6 py-4">
        <button
          onClick={() => navigate("/control-system")}
          className="flex items-center gap-2 text-zinc-400 transition-colors hover:text-white"
          aria-label="Back to Control System"
        >
          <ArrowLeft className="h-5 w-5" />
          <span className="font-mono text-sm uppercase tracking-wider">Control System</span>
        </button>
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

      <main className="mx-auto w-full max-w-4xl px-6 py-8">
        <h1 className="text-xl font-semibold">Incidents</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Automatic kill-switch trips, circuit-breaker trips, gate errors, and self-audit regressions —
          the events that mean something actually went wrong, not a deliberate toggle or a rule working as intended.
        </p>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search summary, kind, action, or provider…"
          className="mt-3 w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600"
        />

        {loading ? (
          <p className="mt-8 font-mono text-xs uppercase text-zinc-500">Loading…</p>
        ) : visibleIncidents.length === 0 ? (
          <p className="mt-6 rounded border border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-500">
            {incidents.length === 0 ? (filter === "open" ? "No open incidents." : "No incidents recorded yet.") : "No incidents match that search."}
          </p>
        ) : (
          <ul className="mt-6 space-y-3">
            {visibleIncidents.map((incident) => (
              <li key={incident.id} className="rounded border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2">
                    {incident.status === "open" ? (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                    ) : (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    )}
                    <div>
                      <div className="font-mono text-[11px] uppercase tracking-wider text-zinc-300">
                        {KIND_LABEL[incident.kind]}
                        {incident.action_type && (
                          <span className="text-zinc-500"> · {incident.action_type}{incident.provider ? ` (${incident.provider})` : ""}</span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-zinc-300">{incident.summary}</p>
                      <div className="mt-1 font-mono text-[10px] text-zinc-500">
                        Opened {new Date(incident.opened_at).toLocaleString()}
                        {incident.status === "resolved" && incident.resolved_at &&
                          ` · resolved ${new Date(incident.resolved_at).toLocaleString()}`}
                      </div>
                      {incident.resolution_note && (
                        <p className="mt-1 text-xs text-zinc-400">Note: {incident.resolution_note}</p>
                      )}
                    </div>
                  </div>
                </div>

                {incident.status === "open" && (
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
