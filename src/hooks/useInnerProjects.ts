// The projects Inner Control can show (the agents and websites of the active account), which one is open, and how to change it.
// The page opens on the project the person has spent the most time on; a choice made on the page is kept for this visit only.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { useAuth } from "@/hooks/useAuth";
import { pickProject, projectKey, readChoice, toProjects, writeChoice, type InnerProject } from "@/lib/inner-projects";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

export function useInnerProjects() {
  const { accountId } = useActiveAccount();
  const { user } = useAuth();
  const [projects, setProjects] = useState<InnerProject[]>([]);
  const [seconds, setSeconds] = useState<Record<string, number>>({});
  const [chosen, setChosen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!accountId) { setProjects([]); setLoading(false); return; }
    setLoading(true);
    const [a, w, t] = await Promise.all([
      anyDb.from("agents").select("id, name, created_at").eq("user_id", accountId),
      anyDb.from("websites").select("id, name, title, created_at, generation_notes, trust_score").eq("user_id", accountId),
      user?.id ? anyDb.from("project_time").select("kind, project_id, seconds").eq("user_id", user.id) : Promise.resolve({ data: [] }),
    ]);
    setProjects(toProjects(a.data ?? [], w.data ?? []));
    const map: Record<string, number> = {};
    for (const r of (t.data ?? []) as { kind: "agent" | "website"; project_id: string; seconds: number }[]) map[projectKey(r.kind, r.project_id)] = Number(r.seconds) || 0;
    setSeconds(map);
    setChosen(readChoice(accountId));
    setLoading(false);
  }, [accountId, user?.id]);

  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(() => pickProject({ projects, seconds, chosen }), [projects, seconds, chosen]);

  const select = useCallback((key: string) => {
    setChosen(key);
    if (accountId) writeChoice(accountId, key);
  }, [accountId]);

  return { projects, selected, select, loading, accountId, refetch: load };
}
