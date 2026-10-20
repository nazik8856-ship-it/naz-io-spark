// Counts the time a person spends on a project. While the project's page is open, in front and focused, it reports a few seconds
// at a time; the server adds them up. A failure to report is ignored: the time just is not counted.
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PROJECT_TIME_TICK_SECONDS, type ProjectKind } from "@/lib/inner-projects";

export function useProjectTimeTracker(kind: ProjectKind | undefined, id: string | undefined) {
  useEffect(() => {
    if (!kind || !id) return;
    const timer = setInterval(() => {
      if (typeof document !== "undefined") {
        if (document.visibilityState !== "visible") return;
        if (typeof document.hasFocus === "function" && !document.hasFocus()) return;
      }
      try {
        const r = supabase.rpc("add_project_time" as never, { p_kind: kind, p_id: id, p_seconds: PROJECT_TIME_TICK_SECONDS } as never) as unknown as Promise<unknown> | undefined;
        void Promise.resolve(r).catch(() => undefined);
      } catch { /* not counted */ }
    }, PROJECT_TIME_TICK_SECONDS * 1000);
    return () => clearInterval(timer);
  }, [kind, id]);
}
