import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, FileText, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { buildComplianceReport } from "@/lib/compliance-report";

const todayIso = () => new Date().toISOString().slice(0, 10);
const daysAgoIso = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * COMPLIANCE REPORT — bundles a date range's self-audit results,
 * incidents (with resolutions), and settings changes into one exportable
 * document. The first thing an auditor or a customer's security team
 * asks for.
 */
export default function ControlComplianceReport() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [from, setFrom] = useState(daysAgoIso(30));
  const [to, setTo] = useState(todayIso());
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const generate = async () => {
    if (!user) return;
    setGenerating(true);
    const fromIso = new Date(`${from}T00:00:00.000Z`).toISOString();
    const toIso = new Date(`${to}T23:59:59.999Z`).toISOString();

    const [runs, incidents, changes] = await Promise.all([
      supabase.from("control_test_runs").select("created_at, pass_rate_pct, regressions")
        .eq("user_id", user.id).gte("created_at", fromIso).lte("created_at", toIso)
        .order("created_at", { ascending: true }),
      supabase.from("incidents").select("kind, status, summary, opened_at, resolved_at, resolution_note")
        .eq("user_id", user.id).gte("opened_at", fromIso).lte("opened_at", toIso)
        .order("opened_at", { ascending: true }),
      supabase.from("config_changes").select("table_name, action, before, after, created_at")
        .eq("user_id", user.id).gte("created_at", fromIso).lte("created_at", toIso)
        .order("created_at", { ascending: true }),
    ]);

    setGenerating(false);
    if (runs.error || incidents.error || changes.error) {
      toast({
        title: "Couldn't generate the report",
        description: runs.error?.message || incidents.error?.message || changes.error?.message,
        variant: "destructive",
      });
      return;
    }

    const report = buildComplianceReport({
      from,
      to,
      generatedAt: new Date().toISOString(),
      // deno-lint-ignore no-explicit-any
      testRuns: (runs.data ?? []) as any,
      // deno-lint-ignore no-explicit-any
      incidents: (incidents.data ?? []) as any,
      // deno-lint-ignore no-explicit-any
      changes: (changes.data ?? []) as any,
    });
    setPreview(report);
  };

  const download = () => {
    if (!preview) return;
    const blob = new Blob([preview], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nazai-compliance-report_${from}_to_${to}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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

      <main className="mx-auto w-full max-w-3xl px-6 py-8">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <FileText className="h-5 w-5 text-cyan-400" /> Compliance report
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Self-audit results, incidents with resolutions, and settings changes for a date range, bundled into one document.
        </p>

        <div className="mt-6 flex flex-wrap items-end gap-2 rounded border border-white/10 bg-white/[0.02] p-3">
          <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            From
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}
              className="rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-zinc-200" />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            To
            <input type="date" value={to} min={from} max={todayIso()} onChange={(e) => setTo(e.target.value)}
              className="rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-zinc-200" />
          </label>
          <button
            disabled={generating}
            onClick={generate}
            className="rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 font-mono text-[11px] uppercase text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate report"}
          </button>
          {preview && (
            <button
              onClick={download}
              className="flex items-center gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 font-mono text-[11px] uppercase text-emerald-300 hover:bg-emerald-500/20"
            >
              <Download className="h-3.5 w-3.5" /> Download .md
            </button>
          )}
        </div>

        {preview && (
          <pre className="mt-6 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded border border-white/10 bg-black/40 p-4 text-xs text-zinc-300">
            {preview}
          </pre>
        )}
      </main>
    </div>
  );
}
