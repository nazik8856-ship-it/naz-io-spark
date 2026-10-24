// All projects of the active account as one list: imported projects (not archived), agents and websites. After an import,
// archive or rename, announceProjectsChanged() makes every open list load again, so the Projects card appears without a reload.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { PROJECT_COLS, type ImportedProject, type ProjectItem } from "@/lib/projects";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any; // the tables are new and not in the generated types

const EVENT = "nazai:projects-changed";
export const announceProjectsChanged = () => { try { window.dispatchEvent(new Event(EVENT)); } catch { /* not in a browser */ } };

export function toItems(imported: ImportedProject[], agents: { id: string; name?: string | null; created_at?: string; updated_at?: string }[], websites: { id: string; name?: string | null; title?: string | null; created_at?: string; updated_at?: string }[]): ProjectItem[] {
  const items: ProjectItem[] = [
    ...imported.map((p) => ({ key: `imported:${p.id}`, id: p.id, name: p.name, origin: "imported" as const, kind: "imported" as const, updated_at: p.updated_at, href: `/projects/${p.id}`, imported: p })),
    ...agents.map((a) => ({ key: `agent:${a.id}`, id: a.id, name: a.name || "Untitled agent", origin: "generated" as const, kind: "agent" as const, updated_at: a.updated_at ?? a.created_at ?? "", href: `/generated/agent/${a.id}` })),
    ...websites.map((w) => ({ key: `website:${w.id}`, id: w.id, name: w.name || w.title || "Untitled website", origin: "generated" as const, kind: "website" as const, updated_at: w.updated_at ?? w.created_at ?? "", href: `/generated/website/${w.id}` })),
  ];
  return items.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

export function useProjectList() {
  const { accountId, loading: accountLoading } = useActiveAccount();
  const [items, setItems] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // Until the account is known the list is still loading: an empty list then would wrongly mean "no projects".
    if (!accountId) { setItems([]); setLoading(!!accountLoading); return; }
    try {
      const [i, a, w] = await Promise.all([
        anyDb.from("imported_projects").select(PROJECT_COLS).eq("user_id", accountId).is("archived_at", null).order("updated_at", { ascending: false }),
        anyDb.from("agents").select("id, name, created_at").eq("user_id", accountId),
        anyDb.from("websites").select("id, name, title, created_at").eq("user_id", accountId),
      ]);
      // Before the imported projects table exists the generated ones still show.
      setItems(toItems(i?.error ? [] : (i?.data ?? []), a?.data ?? [], w?.data ?? []));
    } catch { /* keep what is shown */ }
    setLoading(false);
  }, [accountId, accountLoading]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const on = () => { void load(); };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [load]);

  return { items, count: items.length, loading, reload: load };
}
