import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Users, UserPlus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
// Stale generated types: control-system tables aren't in types.ts yet.
const anyDb = supabase as any;
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

type Role = "owner" | "approver" | "viewer";
type MemberRow = {
  id: string;
  member_id: string | null;
  email: string;
  role: Role;
  status: "pending" | "active" | "revoked";
  invited_at: string;
  accepted_at: string | null;
  ooo_until: string | null;
  ooo_fallback_member_id: string | null;
};

const ROLE_LABEL: Record<Role, string> = { owner: "Owner", approver: "Approver", viewer: "Viewer" };

/**
 * TEAM — invite people to this account with a role (owner/approver/
 * viewer). Active members can view this account's decisions, incidents,
 * agents and rules; approvers/owners can also co-sign pending approvals;
 * owners can flip the kill switch. Write access to rules/spend caps stays
 * owner-account-only for now (a deliberate, separate follow-up).
 */
export default function ControlTeam() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("account_members")
      .select("id, member_id, email, role, status, invited_at, accepted_at, ooo_until, ooo_fallback_member_id")
      .eq("account_owner_id", user.id)
      .order("invited_at", { ascending: false });
    if (error) toast({ title: "Couldn't load your team", description: error.message, variant: "destructive" });
    setMembers((data ?? []) as unknown as MemberRow[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const invite = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: "Enter a valid email", variant: "destructive" });
      return;
    }
    setInviting(true);
    const { data, error } = await supabase.functions.invoke("account-invite", { body: { email, role } });
    setInviting(false);
    const res = (data ?? {}) as { ok?: boolean; error?: string };
    if (error || !res.ok) {
      toast({ title: "Couldn't send the invite", description: res.error || error?.message, variant: "destructive" });
      return;
    }
    setEmail("");
    toast({ title: "Invite sent", description: `${email} was invited as ${ROLE_LABEL[role].toLowerCase()}.` });
    load();
  };

  const revoke = async (id: string) => {
    const { error } = await anyDb.from("account_members").update({ status: "revoked" }).eq("id", id);
    if (error) { toast({ title: "Couldn't revoke it", description: error.message, variant: "destructive" }); return; }
    load();
  };

  // Out-of-office: closes the "approver is on vacation, nothing gets
  // unblocked" gap. Set by the account owner from here (this member's own
  // self-service OOO page is a possible future follow-up, not built yet).
  const setOoo = async (id: string, oooUntil: string | null, fallbackMemberId: string | null) => {
    const { error } = await supabase
      .from("account_members")
      .update({ ooo_until: oooUntil, ooo_fallback_member_id: fallbackMemberId })
      .eq("id", id);
    if (error) { toast({ title: "Couldn't update out-of-office", description: error.message, variant: "destructive" }); return; }
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
      </header>

      <main className="mx-auto w-full max-w-2xl px-6 py-8">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Users className="h-5 w-5 text-cyan-400" /> Team
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Invite people to this account. Viewers can see this account's decisions, incidents, agents and
          rules; Approvers can also co-sign pending approvals; Owners can additionally flip the kill switch.
        </p>

        <div className="mt-6 flex flex-wrap items-end gap-2 rounded border border-white/10 bg-white/[0.02] p-3">
          <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            Email
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@example.com"
              className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-200"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            Role
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-200"
            >
              <option value="viewer">Viewer</option>
              <option value="approver">Approver</option>
              <option value="owner">Owner</option>
            </select>
          </label>
          <button
            disabled={inviting}
            onClick={invite}
            className="flex items-center gap-1.5 rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 font-mono text-[11px] uppercase text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
          >
            <UserPlus className="h-3.5 w-3.5" /> {inviting ? "Sending…" : "Invite"}
          </button>
        </div>

        {loading ? (
          <p className="mt-8 font-mono text-xs uppercase text-zinc-500">Loading…</p>
        ) : members.length === 0 ? (
          <p className="mt-6 rounded border border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-500">
            Nobody invited yet.
          </p>
        ) : (
          <ul className="mt-6 space-y-2">
            {members.map((m) => {
              const isOoo = !!m.ooo_until && new Date(m.ooo_until).getTime() > Date.now();
              const fallbackCandidates = members.filter((o) => o.id !== m.id && o.status === "active" && o.member_id);
              return (
              <li key={m.id} className="rounded border border-white/10 bg-white/[0.02] p-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-zinc-200">{m.email}</span>
                  <span className="rounded border border-white/10 px-2 py-0.5 text-[10px] font-mono uppercase text-zinc-400">{ROLE_LABEL[m.role]}</span>
                  <span className={`rounded border px-2 py-0.5 text-[10px] font-mono uppercase ${
                    m.status === "active" ? "border-emerald-500/40 text-emerald-300" :
                    m.status === "pending" ? "border-amber-500/40 text-amber-300" : "border-white/15 text-zinc-500"
                  }`}>
                    {m.status}
                  </span>
                  {isOoo && (
                    <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono uppercase text-amber-300">
                      OOO until {new Date(m.ooo_until!).toLocaleDateString()}
                    </span>
                  )}
                  {m.status !== "revoked" && (
                    <button onClick={() => revoke(m.id)} className="ml-auto rounded border border-rose-500/30 p-1.5 text-rose-300 hover:bg-rose-500/10">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {m.status === "active" && (m.role === "approver" || m.role === "owner") && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-white/5 pt-2">
                    <label className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                      Out of office until
                      <input
                        type="date"
                        value={m.ooo_until ? m.ooo_until.slice(0, 10) : ""}
                        onChange={(e) => {
                          const iso = e.target.value ? new Date(`${e.target.value}T23:59:59Z`).toISOString() : null;
                          setOoo(m.id, iso, m.ooo_fallback_member_id);
                        }}
                        className="rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-zinc-200"
                      />
                    </label>
                    {isOoo && (
                      <label className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                        Fallback
                        <select
                          value={m.ooo_fallback_member_id ?? ""}
                          onChange={(e) => setOoo(m.id, m.ooo_until, e.target.value || null)}
                          className="rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-zinc-200"
                        >
                          <option value="">None — approvals stay with them</option>
                          {fallbackCandidates.map((f) => (
                            <option key={f.id} value={f.member_id!}>{f.email}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    {m.ooo_until && (
                      <button
                        onClick={() => setOoo(m.id, null, null)}
                        className="rounded border border-white/15 px-2 py-1 text-[10px] font-mono uppercase text-zinc-400 hover:bg-white/10"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                )}
              </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
