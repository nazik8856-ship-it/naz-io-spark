import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ShieldCheck, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { canWriteAsOwner } from "@/lib/account-switcher";
import { friendlyErrorMessage } from "@/lib/friendly-errors";
import { toast } from "@/hooks/use-toast";
import { actorName, buildActorNameMap } from "@/lib/actor-names";

type Request = {
  id: string;
  requested_by: string;
  change_type: string;
  description: string;
  status: "pending" | "rejected" | "executed";
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
};

/**
 * POLICY CHANGE REQUESTS — dual control on policy changes themselves.
 * When an account requires it (toggle on Hard rules), promoting a hard or
 * safety rule to live, raising a spend cap, or changing strictness all
 * create a request here instead of applying immediately. A DIFFERENT
 * owner-tier person than whoever requested it must approve — requesting
 * your own change never counts as the second confirmation.
 */
export default function ControlPolicyChangeRequests() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { accountId, role } = useActiveAccount();
  const canWrite = canWriteAsOwner(role);
  const [requests, setRequests] = useState<Request[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !accountId) return;
    const [{ data }, { data: members }] = await Promise.all([
      supabase
        .from("policy_change_requests")
        .select("id, requested_by, change_type, description, status, approved_by, approved_at, created_at")
        .eq("user_id", accountId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("account_members").select("member_id, email").eq("account_owner_id", accountId).eq("status", "active"),
    ]);
    setRequests((data ?? []) as Request[]);
    setNames(buildActorNameMap(user.id, (members ?? []) as { member_id: string | null; email: string }[]));
  }, [user, accountId]);

  useEffect(() => { void load(); }, [load]);

  const nameFor = (uid: string) => actorName(names, uid);

  const approve = async (id: string) => {
    setBusy(id);
    const { error } = await supabase.rpc("approve_policy_change", { _request_id: id });
    setBusy(null);
    if (error) {
      toast({ title: "Couldn't approve", description: friendlyErrorMessage(error.message), variant: "destructive" });
      return;
    }
    toast({ title: "Approved and applied", description: "This change is now in effect." });
    void load();
  };

  const reject = async (id: string) => {
    setBusy(id);
    const { error } = await supabase.rpc("reject_policy_change", { _request_id: id });
    setBusy(null);
    if (error) {
      toast({ title: "Couldn't reject", description: friendlyErrorMessage(error.message), variant: "destructive" });
      return;
    }
    toast({ title: "Rejected" });
    void load();
  };

  const pending = requests.filter((r) => r.status === "pending");
  const resolved = requests.filter((r) => r.status !== "pending");

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
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <ShieldCheck className="h-5 w-5 text-cyan-300" /> Policy change requests
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Rule promotions, spend cap raises, and strictness changes waiting on a second owner's
          approval. Requesting a change yourself never counts as that second confirmation.
        </p>

        <section className="mt-6 space-y-2">
          <h2 className="font-mono text-xs uppercase tracking-wider text-zinc-400">Pending ({pending.length})</h2>
          {pending.length === 0 ? (
            <p className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-500">Nothing waiting.</p>
          ) : pending.map((r) => (
            <div key={r.id} className="rounded-lg border border-amber-500/25 bg-amber-500/[0.04] p-3 text-sm">
              <p className="text-zinc-200">{r.description}</p>
              <p className="mt-1 text-[11px] text-zinc-500">Requested by {nameFor(r.requested_by)} · {new Date(r.created_at).toLocaleString()}</p>
              {canWrite && (
                <div className="mt-2 flex items-center gap-2">
                  <button
                    disabled={busy === r.id || r.requested_by === user.id}
                    onClick={() => approve(r.id)}
                    title={r.requested_by === user.id ? "You requested this — a different owner must approve it" : undefined}
                    className="flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-mono uppercase text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40"
                  >
                    <Check className="h-3.5 w-3.5" /> Approve
                  </button>
                  <button
                    disabled={busy === r.id}
                    onClick={() => reject(r.id)}
                    className="flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-mono uppercase text-rose-300 hover:bg-rose-500/20 disabled:opacity-40"
                  >
                    <X className="h-3.5 w-3.5" /> Reject
                  </button>
                  {r.requested_by === user.id && (
                    <span className="text-[10px] font-mono uppercase text-zinc-500">Waiting on a different owner</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </section>

        {resolved.length > 0 && (
          <section className="mt-8 space-y-2">
            <h2 className="font-mono text-xs uppercase tracking-wider text-zinc-400">Resolved ({resolved.length})</h2>
            {resolved.map((r) => (
              <div key={r.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-sm">
                <p className="text-zinc-300">{r.description}</p>
                <p className="mt-1 text-[11px] font-mono uppercase text-zinc-500">
                  <span className={r.status === "executed" ? "text-emerald-300" : "text-rose-300"}>{r.status}</span>
                  {r.approved_by && ` · by ${nameFor(r.approved_by)}`}
                  {r.approved_at && ` · ${new Date(r.approved_at).toLocaleString()}`}
                </p>
              </div>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
