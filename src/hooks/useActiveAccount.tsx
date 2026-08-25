import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { buildAccountOptions, resolveActiveAccountId, roleForAccount, permissionsForAccount, type AccountOption, type AccountRole } from "@/lib/account-switcher";

// account_members.permissions (2026-08-27) isn't in the generated Supabase
// types yet -- same established workaround as every other page touching a
// recent column this sandbox can't regenerate types for.
const anyDb = supabase as any;

const STORAGE_KEY = "nazai_active_account_id";

type ActiveAccountContextValue = {
  accountId: string;
  role: AccountRole;
  // null = this member has unrestricted owner access (the default);
  // irrelevant for "self"/"approver"/"viewer".
  permissions: string[] | null;
  accounts: AccountOption[];
  setAccountId: (id: string) => void;
  loading: boolean;
};

const ActiveAccountContext = createContext<ActiveAccountContextValue | null>(null);

/**
 * Provides "which account am I currently viewing/acting on" -- the user's
 * own account by default, or one they've been invited into as a team
 * member (account_members). Every Control System page/panel should read
 * accountId from this instead of user.id directly, so RBAC Phase 2/3's
 * granted permissions are actually reachable through the UI.
 */
export function ActiveAccountProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountIdState] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setAccounts([]);
      setAccountIdState("");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    anyDb
      .from("account_members")
      .select("account_owner_id, role, permissions")
      .eq("member_id", user.id)
      .eq("status", "active")
      .then(async ({ data }: { data: unknown }) => {
        const memberships = (data ?? []) as { account_owner_id: string; role: "owner" | "approver" | "viewer"; permissions: string[] | null }[];
        let ownerNames: Record<string, string> = {};
        if (memberships.length > 0) {
          const { data: owners } = await supabase
            .from("profiles")
            .select("id, display_name")
            .in("id", memberships.map((m) => m.account_owner_id));
          for (const o of (owners ?? []) as { id: string; display_name: string | null }[]) {
            if (o.display_name) ownerNames[o.id] = o.display_name;
          }
        }
        if (cancelled) return;
        const opts = buildAccountOptions(user.id, memberships, ownerNames);
        setAccounts(opts);
        const stored = sessionStorage.getItem(STORAGE_KEY);
        setAccountIdState(resolveActiveAccountId(stored, opts, user.id));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user]);

  const setAccountId = (id: string) => {
    setAccountIdState(id);
    sessionStorage.setItem(STORAGE_KEY, id);
  };

  const role = useMemo(() => roleForAccount(accounts, accountId), [accounts, accountId]);
  const permissions = useMemo(() => permissionsForAccount(accounts, accountId), [accounts, accountId]);

  return (
    <ActiveAccountContext.Provider value={{ accountId: accountId || user?.id || "", role, permissions, accounts, setAccountId, loading }}>
      {children}
    </ActiveAccountContext.Provider>
  );
}

export function useActiveAccount(): ActiveAccountContextValue {
  const ctx = useContext(ActiveAccountContext);
  if (!ctx) throw new Error("useActiveAccount must be used within an ActiveAccountProvider");
  return ctx;
}
