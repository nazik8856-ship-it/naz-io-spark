import { Users } from "lucide-react";
import { useActiveAccount } from "@/hooks/useActiveAccount";

/**
 * Only renders once there's actually something to switch between -- a
 * solo user with no team memberships never sees this at all.
 */
export default function AccountSwitcher() {
  const { accountId, accounts, setAccountId, loading } = useActiveAccount();
  if (loading || accounts.length <= 1) return null;

  return (
    <label className="flex items-center gap-1.5 rounded border border-white/15 bg-white/5 px-2 py-1.5 text-[11px] font-mono uppercase tracking-wider text-zinc-300">
      <Users className="h-3.5 w-3.5 text-cyan-300" />
      <select
        value={accountId}
        onChange={(e) => setAccountId(e.target.value)}
        className="bg-transparent text-zinc-200 outline-none [&>option]:bg-[#020617]"
        aria-label="Viewing account"
      >
        {accounts.map((a) => (
          <option key={a.accountId} value={a.accountId}>
            {a.label}{a.role !== "self" ? ` (${a.role})` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
