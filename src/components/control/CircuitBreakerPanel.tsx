import { useEffect, useState, useCallback } from "react";
import { ZapOff, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type Breaker = {
  id: string;
  action_type: string;
  tripped: boolean;
  failure_rate: number;
  attempts: number;
  failures: number;
  trip_count: number;
  tripped_at: string | null;
};

/**
 * Per-action circuit breakers. Automatic: when more than half of the last 10
 * attempts of an action type fail or get blocked, the engine trips it and
 * auto-blocks that action type until it's reset here.
 */
export default function CircuitBreakerPanel() {
  const [rows, setRows] = useState<Breaker[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("circuit_breakers")
      .select("id, action_type, tripped, failure_rate, attempts, failures, trip_count, tripped_at")
      .order("tripped", { ascending: false })
      .order("failure_rate", { ascending: false });
    setRows((data as Breaker[]) ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const reset = async (b: Breaker) => {
    setBusy(b.id);
    const { error } = await supabase
      .from("circuit_breakers")
      .update({ tripped: false, tripped_at: null, recent_outcomes: [], attempts: 0, failures: 0, failure_rate: 0 })
      .eq("id", b.id);
    setBusy(null);
    if (error) {
      toast({ title: "Reset failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Breaker reset", description: `${b.action_type} can run again.` });
    load();
  };

  const shown = rows.filter((r) => r.tripped || r.failures > 0);
  if (!shown.length) return null;

  return (
    <div className="px-6 py-3 border-b border-white/5 space-y-2">
      <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-zinc-500">
        <ZapOff className="h-3.5 w-3.5" />
        Circuit breakers
      </div>
      <div className="flex flex-wrap gap-2">
        {shown.map((b) => {
          const pct = Math.round((b.failure_rate ?? 0) * 100);
          return (
            <div
              key={b.id}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"
              style={{
                borderColor: b.tripped ? "#ef444455" : "#ffffff14",
                backgroundColor: b.tripped ? "#ef44440d" : "#ffffff08",
              }}
            >
              <span className="font-mono" style={{ color: b.tripped ? "#ef4444" : "#a1a1aa" }}>
                {b.action_type}
              </span>
              <span className="text-zinc-500">
                {b.failures}/{b.attempts} failed ({pct}%)
                {b.tripped ? " — tripped" : ""}
              </span>
              {b.tripped && (
                <button
                  onClick={() => reset(b)}
                  disabled={busy === b.id}
                  className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-zinc-200 hover:bg-white/10 disabled:opacity-50"
                >
                  <RotateCcw className="h-3 w-3" />
                  {busy === b.id ? "Resetting…" : "Reset"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
