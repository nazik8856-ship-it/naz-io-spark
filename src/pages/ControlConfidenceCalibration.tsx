import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Gauge } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { toast } from "@/hooks/use-toast";

type CalibrationBucket = {
  id: string;
  bucket_label: string;
  bucket_min: number;
  bucket_max: number;
  decision_count: number;
  success_count: number;
  failure_count: number;
  neutral_count: number;
  success_rate: number | null;
  expected_rate: number | null;
  calibration_gap: number | null;
  miscalibrated: boolean;
  severity: string;
  note: string | null;
  period_start: string;
  period_end: string;
};

const severityColor = (severity: string) =>
  severity === "severe" ? "#ef4444" : severity === "warning" ? "#f59e0b" : "#22c55e";

/**
 * CONFIDENCE CALIBRATION — "when the AI says it's 80% confident, is it
 * right about 80% of the time?" Pure read of `confidence_calibration`,
 * already populated weekly by the calibrate-confidence job (which buckets
 * agent_decisions by confidence range and compares against measured
 * outcomes from decision_outcomes). This is the first UI to ever surface
 * that data — the pipeline has been running since 2026-08-08.
 */
export default function ControlConfidenceCalibration() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { accountId } = useActiveAccount();
  const [loading, setLoading] = useState(true);
  const [buckets, setBuckets] = useState<CalibrationBucket[]>([]);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    // confidence_calibration accumulates one row per bucket per weekly run
    // (a new period_end each time) -- only the most recent run's buckets
    // reflect current calibration, so find that period_end first, then
    // pull just its rows.
    const { data: latest, error: latestErr } = await supabase
      .from("confidence_calibration")
      .select("period_end")
      .eq("user_id", accountId)
      .order("period_end", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestErr) {
      toast({ title: "Couldn't load confidence calibration", description: latestErr.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    if (!latest) {
      setBuckets([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("confidence_calibration")
      .select("id, bucket_label, bucket_min, bucket_max, decision_count, success_count, failure_count, neutral_count, success_rate, expected_rate, calibration_gap, miscalibrated, severity, note, period_start, period_end")
      .eq("user_id", accountId)
      .eq("period_end", (latest as { period_end: string }).period_end)
      .order("bucket_min", { ascending: true });
    if (error) {
      toast({ title: "Couldn't load confidence calibration", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    setBuckets((data ?? []) as CalibrationBucket[]);
    setLoading(false);
  }, [accountId]);

  useEffect(() => { void load(); }, [load]);

  if (!user) return null;

  const flagged = buckets.filter((b) => b.miscalibrated);

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
          <Gauge className="h-5 w-5 text-cyan-400" /> Confidence calibration
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          When the AI says it's 80% confident, is it right about 80% of the time? Real measured outcomes,
          bucketed by the confidence score the model claimed at decision time.
        </p>

        {loading ? (
          <p className="mt-8 font-mono text-xs uppercase text-zinc-500">Loading…</p>
        ) : buckets.length === 0 ? (
          <p className="mt-6 rounded border border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-400">
            No calibration data yet. This fills in automatically once enough decisions have a measured
            outcome (7 and 30 days after the decision) — check back after the weekly calibration run.
          </p>
        ) : (
          <>
            <p className="mt-4 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              Measured {new Date(buckets[0].period_start).toLocaleDateString()} – {new Date(buckets[0].period_end).toLocaleDateString()}
            </p>

            {flagged.length > 0 && (
              <p className="mt-4 rounded border border-amber-500/30 bg-amber-500/[0.04] p-3 text-sm text-amber-300">
                {flagged.length} confidence {flagged.length === 1 ? "range is" : "ranges are"} miscalibrated —
                the model is more confident than it should be in {flagged.length === 1 ? "that range" : "those ranges"}.
              </p>
            )}

            <ul className="mt-6 space-y-3">
              {buckets.map((b) => {
                const color = severityColor(b.severity);
                const decisive = b.success_count + b.failure_count;
                return (
                  <li key={b.id} className="rounded-lg border p-4" style={{ borderColor: `${color}55`, backgroundColor: `${color}0d` }}>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <span className="font-mono text-sm text-zinc-200">{b.bucket_label}% confidence</span>
                      <span className="rounded border px-2 py-0.5 font-mono text-[10px] uppercase" style={{ borderColor: `${color}66`, color }}>
                        {b.miscalibrated ? `Miscalibrated (${b.severity})` : "Calibrated"}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-3 text-xs">
                      <div>
                        <div className="text-zinc-500">Claimed confidence</div>
                        <div className="mt-0.5 font-mono text-zinc-200">{b.expected_rate !== null ? `${b.expected_rate.toFixed(0)}%` : "—"}</div>
                      </div>
                      <div>
                        <div className="text-zinc-500">Actual success rate</div>
                        <div className="mt-0.5 font-mono" style={{ color }}>
                          {b.success_rate !== null ? `${b.success_rate.toFixed(0)}%` : "not enough data"}
                        </div>
                      </div>
                      <div>
                        <div className="text-zinc-500">Gap</div>
                        <div className="mt-0.5 font-mono text-zinc-200">
                          {b.calibration_gap !== null ? `${b.calibration_gap > 0 ? "+" : ""}${b.calibration_gap.toFixed(1)} pts` : "—"}
                        </div>
                      </div>
                    </div>
                    <p className="mt-2 text-[11px] text-zinc-500">
                      {decisive} measured outcome{decisive === 1 ? "" : "s"} ({b.success_count} succeeded, {b.failure_count} failed
                      {b.neutral_count > 0 ? `, ${b.neutral_count} neutral` : ""}) out of {b.decision_count} decision{b.decision_count === 1 ? "" : "s"} in this range.
                    </p>
                    {b.note && <p className="mt-2 text-xs text-zinc-300">{b.note}</p>}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
