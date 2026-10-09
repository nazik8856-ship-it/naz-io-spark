// GAP 3 (Trust Score + Provenance + Control Report, 2026-10-09): the
// agent-generation equivalent of WebsiteControlReport
// (src/components/websites/WebsiteControlReport.tsx). compile-agent-manifest's
// hard-rule/safety-rule gate and final-assembly-check.ts's checkAgentAssembly
// now persist agents.trust_score/agents.generation_notes the exact same way
// those functions have persisted websites.trust_score/generation_notes since
// AUDIT 5/GAP 3 -- until now an agent had no report surface at all; its
// safety findings only ever landed mixed into manifest.guardrails,
// indistinguishable from ordinary behavioral rules a human never asked
// about. Fetches by agentId (same pattern RunOutcomes.tsx already uses)
// rather than threading trust_score/generation_notes as new props through
// AgentCockpit -- GeneratedAgentDashboard only ever receives `manifest`,
// which has no column for either.
import { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export default function AgentControlReport({ agentId }: { agentId?: string }) {
  const [open, setOpen] = useState(false);
  const [trustScore, setTrustScore] = useState<number | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!agentId || agentId.startsWith("local-")) return;
      const { data } = await supabase
        .from("agents")
        .select("trust_score, generation_notes")
        .eq("id", agentId)
        .maybeSingle();
      if (cancelled) return;
      setTrustScore(typeof (data as any)?.trust_score === "number" ? (data as any).trust_score : null);
      setNotes(Array.isArray((data as any)?.generation_notes) ? (data as any).generation_notes : []);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  // Not saved yet, or nothing to report (no agents.trust_score column data
  // and no notes yet written for this agent) -- show nothing rather than a
  // misleadingly blank "clean" card before the first real check has run.
  if (!loaded || (trustScore === null && notes.length === 0)) return null;

  const clean = notes.length === 0;
  const redacted = notes.filter((n) => n.includes("redacted"));
  const flagged = notes.filter((n) => !redacted.includes(n));
  const score = trustScore ?? (clean ? 100 : null);
  const scoreColor = score === null ? "text-white/40" : score >= 80 ? "text-emerald-300" : score >= 50 ? "text-amber-300" : "text-red-400";

  return (
    <div
      className="rounded-xl border p-3"
      style={
        clean
          ? { borderColor: "rgba(52,211,153,0.28)", background: "rgba(52,211,153,0.05)" }
          : { borderColor: "rgba(245,158,11,0.28)", background: "rgba(245,158,11,0.05)" }
      }
    >
      <button
        onClick={() => !clean && setOpen((o) => !o)}
        className="w-full flex items-center gap-2 text-left"
        disabled={clean}
      >
        {clean ? (
          <ShieldCheck className="h-4 w-4 text-emerald-300 shrink-0" />
        ) : (
          <ShieldAlert className="h-4 w-4 text-amber-300 shrink-0" />
        )}
        <span className="text-sm font-bold text-white">Control Report</span>
        {score !== null && (
          <span className={`ml-auto text-xs font-mono font-bold ${scoreColor}`} title="Trust score: 100 minus a fixed cost per safety-rule match found during generation or final-assembly check.">
            {score}
          </span>
        )}
        {clean ? (
          <span className={score !== null ? "ml-2 text-[10px] font-mono uppercase text-emerald-300/80" : "ml-auto text-[10px] font-mono uppercase text-emerald-300/80"}>clean</span>
        ) : (
          <>
            <span className={score !== null ? "ml-2 text-[10px] font-mono uppercase text-amber-300/80" : "ml-auto text-[10px] font-mono uppercase text-amber-300/80"}>
              {redacted.length ? `${redacted.length} redacted` : ""}
              {redacted.length && flagged.length ? " · " : ""}
              {flagged.length ? `${flagged.length} flagged` : ""}
            </span>
            {open ? (
              <ChevronDown className="h-3.5 w-3.5 text-white/40 shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-white/40 shrink-0" />
            )}
          </>
        )}
      </button>
      {clean ? (
        <p className="mt-1.5 text-xs text-emerald-200/90">
          No account hard/safety rule matched this agent's generated tools or prose.
        </p>
      ) : (
        open && (
          <ul className="mt-2.5 space-y-1.5">
            {notes.map((note, i) => (
              <li key={i} className="rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-amber-100/90">
                {note}
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
