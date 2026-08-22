import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, X, Clock, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
// Stale generated types: control-system tables aren't in types.ts yet.
const anyDb = supabase as any;
import { useAuth } from "@/hooks/useAuth";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { canApprove } from "@/lib/account-switcher";
import { friendlyErrorMessage } from "@/lib/friendly-errors";
import { toast } from "@/hooks/use-toast";
import { filterBySearch } from "@/lib/search-filter";
import { actorName, buildActorNameMap } from "@/lib/actor-names";
import { suggestAssignee, isOutOfOffice } from "@/lib/approval-assignment";

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
  resolved_by: string | null;
  executed_at: string | null;
  escalated_at: string | null;
  assigned_to: string | null;
};

type MemberForAssignment = { member_id: string | null; email: string; ooo_until: string | null };
type ApprovalEvent = { approval_id: string; event_type: "assigned" | "escalated"; actor_id: string | null; target_id: string | null; note: string | null; created_at: string };

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
  const { accountId, role } = useActiveAccount();
  const canSignOff = canApprove(role);
  const [items, setItems] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [queueFilter, setQueueFilter] = useState<"all" | "mine">("all");
  // Resolves a signoff/resolved_by auth uid to something readable: "You",
  // an invited teammate's email, or a short id fallback for anyone else
  // (e.g. a global admin/owner via the platform-staff role, who isn't in
  // account_members).
  const [names, setNames] = useState<Record<string, string>>({});
  const [assignable, setAssignable] = useState<MemberForAssignment[]>([]);
  const [events, setEvents] = useState<Record<string, ApprovalEvent[]>>({});
  const [reassigning, setReassigning] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !accountId) return;
    const [{ data }, { data: members }] = await Promise.all([
      supabase
        .from("pending_approvals")
        .select("*")
        .eq("user_id", accountId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("account_members")
        .select("member_id, email, role, ooo_until")
        .eq("account_owner_id", accountId)
        .eq("status", "active")
        .in("role", ["approver", "owner"]),
    ]);
    const rows = (data ?? []) as unknown as Approval[];
    setItems(rows);
    setNames(buildActorNameMap(user.id, (members ?? []) as { member_id: string | null; email: string }[]));
    setAssignable((members ?? []) as MemberForAssignment[]);

    const ids = rows.map((r) => r.id);
    if (ids.length) {
      const { data: evs } = await supabase
        .from("pending_approval_events")
        .select("approval_id, event_type, actor_id, target_id, note, created_at")
        .in("approval_id", ids)
        .order("created_at", { ascending: true });
      const grouped: Record<string, ApprovalEvent[]> = {};
      for (const e of (evs ?? []) as ApprovalEvent[]) (grouped[e.approval_id] ??= []).push(e);
      setEvents(grouped);
    }
    setLoading(false);
  }, [user, accountId]);

  useEffect(() => { load(); }, [load]);

  const nameFor = (uid: string) => actorName(names, uid);

  const reassign = async (row: Approval, target: string | null) => {
    setReassigning(row.id);
    const { data, error } = await anyDb.rpc("reassign_pending_approval", {
      _approval_id: row.id,
      _assigned_to: target,
    });
    setReassigning(null);
    if (error) {
      toast({ title: "Couldn't reassign", description: friendlyErrorMessage(error.message), variant: "destructive" });
      return;
    }
    const res = (data ?? {}) as { assigned_to?: string | null; redirected?: boolean };
    toast({
      title: res.assigned_to ? `Assigned to ${nameFor(res.assigned_to)}` : "Unassigned",
      description: res.redirected ? "The original assignee is out of office — routed to their fallback instead." : undefined,
    });
    load();
  };

  // Least-loaded active approver/owner, skipping anyone currently OOO —
  // a suggestion only; the server enforces the real OOO redirect
  // regardless of what gets picked here.
  const suggestFor = () => {
    const openCounts: Record<string, number> = {};
    for (const it of items) {
      if (it.status === "pending" && it.assigned_to) openCounts[it.assigned_to] = (openCounts[it.assigned_to] ?? 0) + 1;
    }
    const candidates = assignable.filter((m) => m.member_id).map((m) => ({
      memberId: m.member_id!,
      openCount: openCounts[m.member_id!] ?? 0,
      oooUntil: m.ooo_until,
    }));
    return suggestAssignee(candidates);
  };

  const resolve = async (row: Approval, status: "approved" | "rejected") => {
    if (!user || !canSignOff) return;
    setBusy(row.id);
    // Quorum is enforced server-side: the RPC appends one DISTINCT sign-off and
    // only flips the row to "approved" once required_approvals is reached.
    const { data, error } = await anyDb.rpc("record_approval_signoff", {
      _approval_id: row.id,
      _vote: status === "approved" ? "approve" : "reject",
      _comment: comments[row.id]?.slice(0, 800) || null,
    });
    setBusy(null);
    if (error) {
      toast({ title: "Couldn't save that", description: friendlyErrorMessage(error.message), variant: "destructive" });
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

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const bulkResolve = async (status: "approved" | "rejected") => {
    const ids = [...selected];
    if (!ids.length || !canSignOff) return;
    setBusy("bulk");
    const results = await Promise.allSettled(
      ids.map((id) =>
        anyDb.rpc("record_approval_signoff", {
          _approval_id: id,
          _vote: status === "approved" ? "approve" : "reject",
          _comment: null,
        }),
      ),
    );
    setBusy(null);
    const failed = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && r.value.error)).length;
    toast({
      title: failed ? `${ids.length - failed} of ${ids.length} done` : `${ids.length} ${status}`,
      description: failed ? "Some items didn't go through — check them individually." : undefined,
      variant: failed ? "destructive" : undefined,
    });
    setSelected(new Set());
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
      toast({ title: "Couldn't run it", description: friendlyErrorMessage(error.message), variant: "destructive" });
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
  const signOffIds = (row: Approval) =>
    [...new Set(
      (Array.isArray(row.approvals) ? (row.approvals as { by?: string }[]) : [])
        .map((s) => String(s?.by ?? ""))
        .filter(Boolean),
    )];
  const signOffCount = (row: Approval) => signOffIds(row).length;

  const searched = filterBySearch(items, search, ["action_type", "provider", "description", "reason"]);
  const scoped = queueFilter === "mine" ? searched.filter((i) => i.assigned_to === user?.id) : searched;
  const pending = scoped.filter((i) => i.status === "pending");
  const resolved = scoped.filter((i) => i.status !== "pending");


  const Card = ({ row }: { row: Approval }) => (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center gap-2">
        {row.status === "pending" && canSignOff && (
          <input
            type="checkbox"
            checked={selected.has(row.id)}
            onChange={() => toggleSelect(row.id)}
            className="h-3.5 w-3.5 shrink-0 accent-cyan-500"
            aria-label={`Select ${row.action_type} for bulk action`}
          />
        )}
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

      {row.status === "pending" && canSignOff && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="font-mono uppercase tracking-wider text-zinc-500">Assigned to</span>
          <select
            value={row.assigned_to ?? ""}
            disabled={reassigning === row.id}
            onChange={(e) => reassign(row, e.target.value || null)}
            className="rounded border border-white/10 bg-black/40 px-2 py-1 text-zinc-200"
          >
            <option value="">Unassigned</option>
            <option value={user?.id ?? ""}>You</option>
            {assignable.filter((m) => m.member_id && m.member_id !== user?.id).map((m) => (
              <option key={m.member_id} value={m.member_id!}>
                {m.email}{isOutOfOffice(m.ooo_until) ? " (OOO)" : ""}
              </option>
            ))}
          </select>
          {(() => {
            const suggestion = suggestFor();
            return suggestion && suggestion !== row.assigned_to ? (
              <button
                onClick={() => reassign(row, suggestion)}
                className="rounded border border-cyan-500/30 px-2 py-0.5 text-cyan-300 hover:bg-cyan-500/10"
              >
                Suggest: {nameFor(suggestion)}
              </button>
            ) : null;
          })()}
        </div>
      )}
      {row.assigned_to && !canSignOff && (
        <p className="mt-2 text-[11px] text-zinc-500">Assigned to {nameFor(row.assigned_to)}</p>
      )}

      {(() => {
        const rowEvents = events[row.id] ?? [];
        if (!rowEvents.length) return null;
        return (
          <ul className="mt-2 space-y-1 border-l border-white/10 pl-2">
            {rowEvents.map((e, i) => (
              <li key={i} className="text-[10px] text-zinc-500">
                {new Date(e.created_at).toLocaleString()} —{" "}
                {e.event_type === "assigned"
                  ? `${e.actor_id ? nameFor(e.actor_id) : "Someone"} assigned this to ${e.target_id ? nameFor(e.target_id) : "nobody"}${e.note ? ` (${e.note})` : ""}`
                  : `Escalated${e.note ? ` — ${e.note}` : ""}`}
              </li>
            ))}
          </ul>
        );
      })()}

      {row.status === "pending" ? (
        <>
          {canSignOff && (
          <textarea
            value={comments[row.id] ?? ""}
            onChange={(e) => setComments((c) => ({ ...c, [row.id]: e.target.value }))}
            placeholder="Optional note for the record…"
            className="mt-3 w-full resize-none rounded border border-white/10 bg-black/40 p-2 text-xs text-zinc-200 outline-none focus:border-cyan-500/50"
            rows={2}
          />
          )}
          <div className="mt-2 flex items-center gap-2">
            {canSignOff ? (
            <>
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
            </>
            ) : (
              <span className="text-[10px] font-mono uppercase text-zinc-500">View-only — you can't sign off on this account.</span>
            )}
            {(row.required_approvals || 1) > 1 && (
              <span className="text-[10px] font-mono uppercase text-amber-300" title={signOffIds(row).map(nameFor).join(", ") || undefined}>
                {signOffCount(row)} of {row.required_approvals} sign-offs
                {signOffIds(row).length > 0 && ` (${signOffIds(row).map(nameFor).join(", ")})`}
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
          {row.resolved_by && <span className="text-zinc-500">· by {nameFor(row.resolved_by)}</span>}
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

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search action, provider, description, or reason…"
          className="mt-3 w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600"
        />

        <div className="mt-2 flex gap-2">
          <button
            onClick={() => setQueueFilter("all")}
            className={`rounded border px-3 py-1 text-[11px] font-mono uppercase tracking-wider ${
              queueFilter === "all" ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300" : "border-white/10 text-zinc-400 hover:bg-white/10"
            }`}
          >
            Team queue
          </button>
          <button
            onClick={() => setQueueFilter("mine")}
            className={`rounded border px-3 py-1 text-[11px] font-mono uppercase tracking-wider ${
              queueFilter === "mine" ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300" : "border-white/10 text-zinc-400 hover:bg-white/10"
            }`}
          >
            My queue
          </button>
        </div>

        {loading ? (
          <p className="mt-8 font-mono text-xs uppercase text-zinc-500">Loading…</p>
        ) : (
          <>
            <section className="mt-6 space-y-3">
              <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-zinc-400">
                <Clock className="h-3.5 w-3.5" /> Pending ({pending.length})
              </h2>
              {selected.size > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/[0.05] px-3 py-2">
                  <span className="text-xs text-cyan-200">{selected.size} selected</span>
                  <button
                    disabled={busy === "bulk"}
                    onClick={() => bulkResolve("approved")}
                    className="ml-auto flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-mono uppercase text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" /> Approve all
                  </button>
                  <button
                    disabled={busy === "bulk"}
                    onClick={() => bulkResolve("rejected")}
                    className="flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-mono uppercase text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" /> Reject all
                  </button>
                  <button
                    onClick={() => setSelected(new Set())}
                    className="rounded border border-white/15 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/10"
                  >
                    Clear
                  </button>
                </div>
              )}
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
