import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { normalizeChecks, type QualityCheck } from "@/lib/site-structures";

/**
 * Polls the owner-scoped generation_progress row for one request: the same real
 * stage and quality checks compile-website-manifest reports while it works.
 * Polling one tiny row is far cheaper than a streamed response and gives the
 * same real forward motion. Stops when `active` is false or the id is missing.
 */
export function useGenerationProgress(requestId: string | null, active: boolean, intervalMs = 1300) {
  const [stage, setStage] = useState<string | null>(null);
  const [checks, setChecks] = useState<QualityCheck[] | null>(null);

  useEffect(() => {
    if (!active || !requestId) {
      setStage(null);
      setChecks(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const { data } = await supabase
          .from("generation_progress")
          .select("stage, updated_at, checks" as "stage, updated_at")
          .eq("request_id", requestId)
          .maybeSingle();
        if (cancelled || !data?.stage) return;
        setStage(data.stage as string);
        const raw = (data as unknown as { checks?: unknown }).checks;
        if (raw) setChecks(normalizeChecks(raw));
      } catch {
        /* progress is a nicety: a failed poll must never affect the edit itself */
      }
    };
    poll();
    const t = setInterval(poll, intervalMs);
    return () => { cancelled = true; clearInterval(t); };
  }, [requestId, active, intervalMs]);

  return { stage, checks };
}
