import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, AlertTriangle, CheckCircle2, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { canApprove } from "@/lib/account-switcher";
import { friendlyErrorMessage } from "@/lib/friendly-errors";
import { toast } from "@/hooks/use-toast";
import { filterBySearch } from "@/lib/search-filter";
import { actorName, buildActorNameMap } from "@/lib/actor-names";
import { extractFunctionErrorMessage } from "@/lib/supabase-function-error";

// Kept in sync with _shared/incidents.ts's INCIDENT_KINDS by hand -- a
// missing entry here is only ever a silent `undefined` label at render
// time (this Record is keyed by a string union TS can't exhaustively
// check against the real backend list), the exact bug critical-alerts.ts's
// own LABELS map already got bitten by once for "gate_error".
type IncidentKind =
  | "kill_switch_auto" | "circuit_breaker_trip" | "gate_error" | "self_audit_regression"
  | "approval_escalated" | "confidence_miscalibrated" | "break_glass_override"
  | "correlated_breaker_trip" | "audit_integrity_failure" | "webhook_delivery_exhausted"
  | "integration_revoked" | "control_api_abuse" | "gate_error_fail_open"
  | "auto_resolution_share_spike" | "precedent_pipeline_stale" | "control_api_coordinated_abuse"
  | "on_uncertain_auto_downgraded" | "content_gap_backlog_stale";
type IncidentStatus = "open" | "acknowledged" | "resolved";
type RootCauseCategory =
  | "transient_infra" | "configuration_error" | "external_provider_outage"
  | "software_bug" | "expected_behavior_misclassified" | "other";

type Incident = {
  id: string;
  kind: IncidentKind;
  status: IncidentStatus;
  summary: string;
  action_type: string | null;
  provider: string | null;
  decision_id: string | null;
  opened_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  assigned_to: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  root_cause_category: RootCauseCategory | null;
  related_incident_id: string | null;
};

const KIND_LABEL: Record<IncidentKind, string> = {
  kill_switch_auto: "Kill switch auto-tripped",
  circuit_breaker_trip: "Circuit breaker tripped",
  gate_error: "Control gate failed closed",
  self_audit_regression: "Self-audit regression",
  approval_escalated: "Approval waiting too long",
  confidence_miscalibrated: "Model overconfident in a real confidence range",
  break_glass_override: "Break-glass override of a blocked action",
  correlated_breaker_trip: "Correlated breaker trip across agents",
  audit_integrity_failure: "Audit trail integrity check failed",
  webhook_delivery_exhausted: "Webhook endpoint stopped receiving deliveries",
  integration_revoked: "Connected integration revoked or expired",
  control_api_abuse: "Unusual activity on a Control API key",
  gate_error_fail_open: "Control gate failed OPEN",
  auto_resolution_share_spike: "Unusually large share of decisions auto-resolved",
  precedent_pipeline_stale: "Real-precedent memory gone stale",
  control_api_coordinated_abuse: "Unusual activity spread across multiple keys",
  on_uncertain_auto_downgraded: "Auto-resolve policy pulled back to human review",
  content_gap_backlog_stale: "Recurring unanswered question piling up",
};

const ROOT_CAUSE_LABEL: Record<RootCauseCategory, string> = {
  transient_infra: "Transient infrastructure issue",
  configuration_error: "Configuration error",
  external_provider_outage: "External provider outage",
  software_bug: "Software bug",
  expected_behavior_misclassified: "Expected behavior, misclassified",
  other: "Other",
};

/**
 * INCIDENTS — every automatic/abnormal safety event (not a deliberate human
 * toggle, not a rule doing its job) promoted from "a decision row plus an
 * alert" into a real object with a timeline and a resolution note.
 */
export default function ControlIncidents() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { accountId, role } = useActiveAccount();
  const canResolve = canApprove(role);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"open" | "acknowledged" | "resolved" | "all">("open");
  const [mineOnly, setMineOnly] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, RootCauseCategory | "">>({});
  const [search, setSearch] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const [assignableMembers, setAssignableMembers] = useState<{ id: string; label: string }[]>([]);
  const searchedIncidents = filterBySearch(incidents, search, ["summary", "kind", "action_type", "provider"]);
  const visibleIncidents = mineOnly ? searchedIncidents.filter((i) => i.assigned_to === user?.id) : searchedIncidents;
  const nameFor = (uid: string) => actorName(names, uid);

  const load = useCallback(async () => {
    if (!user || !accountId) return;
    setLoading(true);
    let query = supabase
      .from("incidents")
      .select("id, kind, status, summary, action_type, provider, decision_id, opened_at, acknowledged_at, acknowledged_by, assigned_to, resolved_at, resolved_by, resolution_note, root_cause_category, related_incident_id")
      .eq("user_id", accountId)
      .order("opened_at", { ascending: false });
    if (filter !== "all") query = query.eq("status", filter);
    const [{ data, error }, { data: members }, { data: ownerContact }] = await Promise.all([
      query,
      supabase.from("account_members").select("member_id, email, role").eq("account_owner_id", accountId).eq("status", "active"),
      supabase.rpc("get_account_owner_contact", { _account_owner_id: accountId }).maybeSingle(),
    ]);
    if (error) toast({ title: "Couldn't load incidents", description: friendlyErrorMessage(error.message), variant: "destructive" });
    setIncidents((data ?? []) as unknown as Incident[]);
    const memberRows = (members ?? []) as { member_id: string | null; email: string; role: string }[];
    const ownerRow = ownerContact as { email?: string; display_name?: string } | null;
    const ownerLabel = ownerRow?.display_name || ownerRow?.email;
    const nameMap = buildActorNameMap(user.id, memberRows, ownerLabel ? { id: accountId, label: ownerLabel } : null);
    setNames(nameMap);
    // Same eligibility the assign endpoint itself enforces (approver/owner,
    // active) -- the account owner is always eligible too, per the same
    // "resolving/acting is an action, not just viewing" tier as resolve.
    const eligible = memberRows.filter((m) => m.member_id && (m.role === "approver" || m.role === "owner"));
    setAssignableMembers([
      { id: accountId, label: `${actorName(nameMap, accountId)} (owner)` },
      ...eligible.map((m) => ({ id: m.member_id as string, label: m.email })),
    ]);
    setLoading(false);
  }, [user, accountId, filter]);

  useEffect(() => { load(); }, [load]);

  const resolve = async (incident: Incident) => {
    if (!canResolve) return;
    setBusy(incident.id);
    const category = categoryDrafts[incident.id];
    const { data, error } = await supabase.functions.invoke(
      `control-incidents/${incident.id}/resolve`,
      { body: { note: noteDrafts[incident.id] || "", root_cause_category: category || null } },
    );
    setBusy(null);
    const res = (data ?? {}) as { ok?: boolean; already_resolved?: boolean };
    if (error && !res.ok) {
      const detail = (await extractFunctionErrorMessage(error)) ?? friendlyErrorMessage(error.message);
      toast({ title: "Couldn't resolve it", description: detail, variant: "destructive" });
      return;
    }
    toast({ title: res.already_resolved ? "Already resolved" : "Resolved", description: incident.summary.slice(0, 120) });
    load();
  };

  const acknowledge = async (incident: Incident) => {
    if (!canResolve) return;
    setBusy(incident.id);
    const { data, error } = await supabase.functions.invoke(`control-incidents/${incident.id}/acknowledge`, { body: {} });
    setBusy(null);
    const res = (data ?? {}) as { ok?: boolean };
    if (error && !res.ok) {
      const detail = (await extractFunctionErrorMessage(error)) ?? friendlyErrorMessage(error.message);
      toast({ title: "Couldn't acknowledge it", description: detail, variant: "destructive" });
      return;
    }
    toast({ title: "Acknowledged", description: incident.summary.slice(0, 120) });
    load();
  };

  const assign = async (incident: Incident, assigneeId: string | null) => {
    if (!canResolve) return;
    setBusy(incident.id);
    const { data, error } = await supabase.functions.invoke(
      `control-incidents/${incident.id}/assign`,
      { body: { assignee_id: assigneeId } },
    );
    setBusy(null);
    const res = (data ?? {}) as { ok?: boolean };
    if (error && !res.ok) {
      const detail = (await extractFunctionErrorMessage(error)) ?? friendlyErrorMessage(error.message);
      toast({ title: "Couldn't update the assignment", description: detail, variant: "destructive" });
      return;
    }
    toast({ title: assigneeId ? "Assigned" : "Unassigned", description: incident.summary.slice(0, 120) });
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
          {(["open", "acknowledged", "resolved", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded border px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider ${
                filter === f
                  ? f === "open" ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                    : f === "acknowledged" ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                    : f === "resolved" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-white/40 bg-white/10 text-white"
                  : "border-white/15 bg-white/5 text-zinc-300 hover:bg-white/10"
              }`}
            >
              {f === "acknowledged" ? "Investigating" : f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
          <button
            onClick={() => setMineOnly((v) => !v)}
            aria-pressed={mineOnly}
            className={`rounded border px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider ${
              mineOnly
                ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                : "border-white/15 bg-white/5 text-zinc-300 hover:bg-white/10"
            }`}
          >
            Mine
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
            {incidents.length === 0
              ? (filter === "all" ? "No incidents recorded yet." : `No ${filter === "acknowledged" ? "incidents being investigated" : filter} incidents.`)
              : searchedIncidents.length === 0
              ? "No incidents match that search."
              : "No incidents assigned to you in this view."}
          </p>
        ) : (
          <ul className="mt-6 space-y-3">
            {visibleIncidents.map((incident) => (
              <li key={incident.id} className="rounded border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2">
                    {incident.status === "open" ? (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                    ) : incident.status === "acknowledged" ? (
                      <Eye className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
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
                        {incident.acknowledged_at &&
                          ` · investigating since ${new Date(incident.acknowledged_at).toLocaleString()}${incident.acknowledged_by ? ` (${nameFor(incident.acknowledged_by)})` : ""}`}
                        {incident.status === "resolved" && incident.resolved_at &&
                          ` · resolved ${new Date(incident.resolved_at).toLocaleString()}${incident.resolved_by ? ` by ${nameFor(incident.resolved_by)}` : ""}`}
                      </div>
                      {incident.assigned_to && (
                        <div className="mt-1 font-mono text-[10px] text-cyan-400">Assigned to {nameFor(incident.assigned_to)}</div>
                      )}
                      {incident.resolution_note && (
                        <p className="mt-1 text-xs text-zinc-400">Note: {incident.resolution_note}</p>
                      )}
                      {incident.root_cause_category && (
                        <p className="mt-1 text-xs text-zinc-500">Root cause: {ROOT_CAUSE_LABEL[incident.root_cause_category]}</p>
                      )}
                    </div>
                  </div>
                </div>

                {incident.status !== "resolved" && canResolve && (
                  <div className="mt-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {incident.status === "open" && (
                        <button
                          disabled={busy === incident.id}
                          onClick={() => acknowledge(incident)}
                          className="flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 font-mono text-[11px] uppercase text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
                        >
                          <Eye className="h-3.5 w-3.5" /> Acknowledge
                        </button>
                      )}
                      {incident.assigned_to ? (
                        <button
                          disabled={busy === incident.id}
                          onClick={() => assign(incident, null)}
                          className="rounded border border-white/15 bg-white/5 px-3 py-1.5 font-mono text-[11px] uppercase text-zinc-300 hover:bg-white/10 disabled:opacity-50"
                        >
                          Unassign
                        </button>
                      ) : (
                        <button
                          disabled={busy === incident.id}
                          onClick={() => assign(incident, user!.id)}
                          className="rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 font-mono text-[11px] uppercase text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
                        >
                          Claim
                        </button>
                      )}
                      {assignableMembers.length > 0 && (
                        <select
                          value=""
                          disabled={busy === incident.id}
                          onChange={(e) => { if (e.target.value) assign(incident, e.target.value); }}
                          className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-300"
                        >
                          <option value="">Reassign to…</option>
                          {assignableMembers.filter((m) => m.id !== incident.assigned_to).map((m) => (
                            <option key={m.id} value={m.id}>{m.label}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={categoryDrafts[incident.id] || ""}
                        onChange={(e) => setCategoryDrafts((d) => ({ ...d, [incident.id]: e.target.value as RootCauseCategory }))}
                        className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-300"
                      >
                        <option value="">Root cause (optional)</option>
                        {(Object.entries(ROOT_CAUSE_LABEL) as [RootCauseCategory, string][]).map(([k, label]) => (
                          <option key={k} value={k}>{label}</option>
                        ))}
                      </select>
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
