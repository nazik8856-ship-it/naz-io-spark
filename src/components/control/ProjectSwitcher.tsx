import { ChevronDown, Briefcase } from "lucide-react";
import { useActiveAccount } from "@/hooks/useActiveAccount";

/**
 * Blueprint "10 tasks" round, item 9 (simple version, explicitly chosen over
 * a real multi-business data model): previously this was AccountSwitcher --
 * a dropdown that rendered NOTHING for a solo user (the common case), so
 * there was no persistent indication of which project you were even
 * looking at. Now it always shows the current project's real name (falling
 * back through profile display name -> email -> "My account"), and only
 * grows a working dropdown toggle when there's actually more than one
 * project to switch between -- same underlying account-membership data,
 * just shown project-first instead of switcher-first.
 */
export default function ProjectSwitcher() {
  const { accountId, accounts, setAccountId, loading } = useActiveAccount();
  if (loading || accounts.length === 0) return null;

  const current = accounts.find((a) => a.accountId === accountId);
  const currentLabel = current?.label ?? "My account";

  if (accounts.length === 1) {
    return (
      <div className="flex items-center gap-1.5 rounded border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-wider text-zinc-300">
        <Briefcase className="h-3.5 w-3.5 text-cyan-300" />
        <span className="max-w-[160px] truncate normal-case tracking-normal">{currentLabel}</span>
      </div>
    );
  }

  return (
    <label className="relative flex items-center gap-1.5 rounded border border-white/15 bg-white/5 px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-wider text-zinc-300">
      <Briefcase className="h-3.5 w-3.5 text-cyan-300" />
      <select
        value={accountId}
        onChange={(e) => setAccountId(e.target.value)}
        className="max-w-[160px] appearance-none bg-transparent pr-4 normal-case tracking-normal text-zinc-200 outline-none [&>option]:bg-[#020617]"
        aria-label="Switch project"
        title="Switch project"
      >
        {accounts.map((a) => (
          <option key={a.accountId} value={a.accountId}>
            {a.label}{a.role !== "self" ? ` (${a.role})` : ""}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3 w-3 opacity-60" />
    </label>
  );
}
