import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

// The AI Control System's own governance/audit tables -- decisions,
// rules, incidents, spend history, audit trail, webhooks. Deliberately
// does NOT include `agents`, `account_members`, or other broader-product
// tables (business profiles, generated content, etc.) -- this page is
// scoped to Control System data specifically, matching what it exports
// and what data-deletion-sweep actually deletes.
const GOVERNANCE_TABLES = [
  "agent_decisions", "pending_approvals", "pending_approval_events", "incidents",
  "hard_rules", "safety_rules", "agent_strictness_overrides", "ai_spend_caps",
  "ai_spend_daily", "config_changes", "control_test_runs", "critical_alerts",
  "webhooks", "webhook_deliveries", "hard_rule_shadow_hits",
] as const;

type DeletionRequest = { id: string; requested_at: string; execute_at: string; status: string };

/**
 * ACCOUNT DATA — self-service export and deletion of everything this
 * account has in the AI Control System. Export is instant (a JSON
 * download, this account's own RLS-scoped rows). Deletion goes through a
 * 7-day, cancellable grace period rather than instant, irreversible
 * deletion on a single click, the same way real SaaS (GitHub, Stripe)
 * handles account data removal. Owner-only -- not delegable to an
 * invited team owner, unlike every other per-account setting this
 * session.
 */
export default function ControlAccountData() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [pending, setPending] = useState<DeletionRequest | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [requesting, setRequesting] = useState(false);

  const loadPending = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("data_deletion_requests")
      .select("id, requested_at, execute_at, status")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .maybeSingle();
    setPending((data as DeletionRequest | null) ?? null);
  }, [user]);

  useEffect(() => { void loadPending(); }, [loadPending]);

  const exportData = async () => {
    if (!user) return;
    setExporting(true);
    const results = await Promise.all(
      GOVERNANCE_TABLES.map((table) => supabase.from(table).select("*").eq("user_id", user.id)),
    );
    setExporting(false);
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      toast({ title: "Export failed", description: failed.error.message, variant: "destructive" });
      return;
    }
    const bundle = {
      exported_at: new Date().toISOString(),
      account: user.id,
      tables: Object.fromEntries(GOVERNANCE_TABLES.map((table, i) => [table, results[i].data ?? []])),
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nazai-control-system-data_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast({ title: "Export downloaded", description: "Every Control System table scoped to your account, as one JSON file." });
  };

  const requestDeletion = async () => {
    if (!user || confirmText !== "DELETE") return;
    setRequesting(true);
    const { data, error } = await supabase.rpc("request_data_deletion");
    setRequesting(false);
    if (error) {
      toast({ title: "Couldn't schedule deletion", description: error.message, variant: "destructive" });
      return;
    }
    setPending(data as DeletionRequest);
    setConfirmText("");
    toast({ title: "Deletion scheduled", description: "Your Control System data will be deleted in 7 days unless you cancel." });
  };

  const cancel = async () => {
    if (!pending) return;
    const { error } = await supabase.rpc("cancel_data_deletion", { _request_id: pending.id });
    if (error) {
      toast({ title: "Couldn't cancel", description: error.message, variant: "destructive" });
      return;
    }
    setPending(null);
    toast({ title: "Deletion cancelled" });
  };

  if (!user) return null;

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
      </header>

      <main className="mx-auto w-full max-w-2xl px-6 py-8">
        <h1 className="text-xl font-semibold">Account data</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Export or delete everything this account has in the AI Control System — decisions, rules,
          incidents, spend history, and audit trail. Doesn't include your agents or team, which are a
          separate, bigger action.
        </p>

        <section className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="font-mono text-xs uppercase tracking-wider text-zinc-400">Export</h2>
          <p className="mt-1 text-[11px] text-zinc-500">Everything above, as one JSON file, right now.</p>
          <button
            onClick={exportData}
            disabled={exporting}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 px-3 py-1.5 text-xs font-semibold text-cyan-300 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> {exporting ? "Exporting…" : "Export my data (.json)"}
          </button>
        </section>

        <section className="mt-6 rounded-xl border border-rose-500/25 bg-rose-500/[0.03] p-4">
          <h2 className="font-mono text-xs uppercase tracking-wider text-rose-300">Delete</h2>

          {pending ? (
            <div className="mt-2 space-y-2">
              <p className="text-sm text-zinc-300">
                Deletion scheduled for <span className="font-semibold text-rose-300">{new Date(pending.execute_at).toLocaleString()}</span>.
              </p>
              <button
                onClick={cancel}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-white/10"
              >
                <X className="h-3.5 w-3.5" /> Cancel deletion
              </button>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              <p className="text-[11px] text-zinc-500">
                Schedules permanent deletion of everything above, 7 days from now. You can cancel any time
                before then. Type <span className="font-mono text-zinc-300">DELETE</span> to confirm.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="DELETE"
                  className="w-32 rounded border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-xs text-zinc-200"
                />
                <button
                  onClick={requestDeletion}
                  disabled={confirmText !== "DELETE" || requesting}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-semibold text-rose-300 disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" /> {requesting ? "Scheduling…" : "Schedule deletion"}
                </button>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
