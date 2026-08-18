import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, X, Clock, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

type Approval = {
  id: string;
  decision_id: string | null;
  agent_id: string | null;
  run_id: string | null;
  action_type: string;
  provider: string;
  description: string;
  reason: string;
  risk_tier: string;
  origin: string;
  required_approvals: number;
  approvals: unknown;
  status: "pending" | "approved" | "rejected";
  comment: string | null;
  created_at: string;
  resolved_at: string | null;
  executed_at: string | null;
  escalated_at: string | null;
};

const RISK_STYLE: Record<string, string> = {
  high: "text-rose-300 border-rose-500/40 bg-rose-500/10",
  medium: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  low: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
};

/**
 * APPROVAL QUEUE — the human escape hatch for escalated actions.
 * Every escalation from the unified control gate lands here, whether it came
 * from the Control System chat or an autonomous agent run.
 */
export default function ControlApprovals() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [items, setItems] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("pending_approvals")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    setItems((data ?? []) as unknown as Approval[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const resolve = async (row: Approval, status: "approved" | "rejected") => {
    if (!user) return;
    setBusy(row.id);
    // Quorum is enforced server-side: the RPC appends one DISTINCT sign-off and
    // only flips the row to "approved" once required_approvals is reached.
    const { data, error } = await supabase.rpc("record_approval_signoff", {
      _approval_id: row.id,
      _vote: status === "approved" ? "approve" : "reject",
      _comment: comments[row.id]?.slice(0, 800) || null,
    });
    setBusy(null);
    if (error) {
      toast({ title: "Couldn't save that", description: error.message, variant: "destructive" });
      return;
    }
    const res = (data ?? {}) as { status?: string; approvals?: number; required?: number; remaining?: number };
    const met = res.status === "approved" || res.status === "rejected";
    toast({
      title: met ? (res.status === "approved" ? "Approved" : "Rejected") : "Sign-off recorded",
      description: met
        ? `${row.action_type} was ${res.status}.`
        : `${res.approvals ?? 0} of ${res.required ?? 1} approvals — still needs ${res.remaining ?? 1} more.`,
    });
    load();
  };

  const execute = async (row: Approval) => {
    setBusy(row.id);
    const { data, error } = await supabase.functions.invoke(
      `control-engine/approvals/${row.id}/execute`,
      { body: {} },
    );
    setBusy(null);
    const res = (data ?? {}) as { message?: string; summary?: string; executed?: boolean; already_executed?: boolean };
    if (error && !res.message) {
      toast({ title: "Couldn't run it", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: res.executed ? "Action carried out" : res.already_executed ? "Already done" : "Nothing ran",
      description: res.summary || res.message || "",
      variant: res.executed || res.already_executed ? undefined : "destructive",
    });
    load();
  };


  // Distinct human sign-offs recorded on a row (source of truth for quorum).
  const signOffCount = (row: Approval) =>
    new Set(
      (Array.isArray(row.approvals) ? (row.approvals as { by?: string }[]) : [])
        .map((s) => String(s?.by ?? ""))
        .filter(Boolean),
    ).size;

  const pending = items.filter((i) => i.status === "pending");
  const resolved = items.filter((i) => i.status !== "pending");


  const Card = ({ row }: { row: Approval }) => (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs uppercase tracking-wider text-cyan-300">{row.action_type}</span>
        <span className="text-xs text-zinc-500">· {row.provider}</span>
        <span className={`ml-auto rounded border px-2 py-0.5 text-[10px] font-mono uppercase ${RISK_STYLE[row.risk_tier] ?? RISK_STYLE.medium}`}>
          {row.risk_tier} risk
        </span>
        <span className="rounded border border-white/10 px-2 py-0.5 text-[10px] font-mono uppercase text-zinc-400">
          {row.origin === "agent-runtime" ? "agent run" : "chat"}
        </span>
        {row.escalated_at && (
          <span
            title={`Escalated ${new Date(row.escalated_at).toLocaleString()} — waited too long for a response`}
            className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono uppercase text-amber-300"
          >
            <Clock className="mr-1 inline h-3 w-3" /> escalated
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-zinc-200">{row.description || "No description supplied."}</p>
      <p className="mt-1 text-xs text-zinc-400">{row.reason}</p>
      {row.status === "pending" ? (
        <>
          <textarea
            value={comments[row.id] ?? ""}
            onChange={(e) => setComments((c) => ({ ...c, [row.id]: e.target.value }))}
            placeholder="Optional note for the record…"
            className="mt-3 w-full resize-none rounded border border-white/10 bg-black/40 p-2 text-xs text-zinc-200 outline-none focus:border-cyan-500/50"
            rows={2}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              disabled={busy === row.id}
              onClick={() => resolve(row, "approved")}
              className="flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-mono uppercase text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" /> Approve
            </button>
            <button
              disabled={busy === row.id}
              onClick={() => resolve(row, "rejected")}
              className="flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-mono uppercase text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" /> Reject
            </button>
            {(row.required_approvals || 1) > 1 && (
              <span className="text-[10px] font-mono uppercase text-amber-300">
                {signOffCount(row)} of {row.required_approvals} sign-offs
              </span>
            )}
            {row.decision_id && (
              <a
                href={`/control-system?decision=${row.decision_id}`}
                className="ml-auto text-[10px] font-mono uppercase text-zinc-400 underline hover:text-white"
              >
                decision record
              </a>
            )}
          </div>
        </>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-mono uppercase">
          <span className={row.status === "approved" ? "text-emerald-300" : "text-rose-300"}>{row.status}</span>
          <span className="text-zinc-500">· {signOffCount(row)}/{row.required_approvals || 1} approvals</span>
          {row.comment && <span className="text-zinc-500">· {row.comment}</span>}
          {row.executed_at && <span className="text-zinc-500">· ran {new Date(row.executed_at).toLocaleString()}</span>}
          {row.status === "approved" && !row.executed_at && (
            <button
              disabled={busy === row.id}
              onClick={() => execute(row)}
              className="ml-auto rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-[10px] font-mono uppercase text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
            >
              Run it
            </button>
          )}
        </div>
      )}

    </div>
  );

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

      <main className="mx-auto w-full max-w-3xl px-6 py-8">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <ShieldAlert className="h-5 w-5 text-amber-300" /> Approval queue
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Actions the control gate stopped for a human decision. Nothing here has run.
        </p>

        {loading ? (
          <p className="mt-8 font-mono text-xs uppercase text-zinc-500">Loading…</p>
        ) : (
          <>
            <section className="mt-6 space-y-3">
              <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-zinc-400">
                <Clock className="h-3.5 w-3.5" /> Pending ({pending.length})
              </h2>
              {pending.length === 0 ? (
                <p className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-500">
                  Nothing is waiting on you.
                </p>
              ) : pending.map((row) => <Card key={row.id} row={row} />)}
            </section>

            {resolved.length > 0 && (
              <section className="mt-8 space-y-3">
                <h2 className="font-mono text-xs uppercase tracking-wider text-zinc-400">
                  Resolved ({resolved.length})
                </h2>
                {resolved.map((row) => <Card key={row.id} row={row} />)}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
