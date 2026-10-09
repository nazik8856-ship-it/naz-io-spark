// Blueprint task #62: the website-generation equivalent of AgentCockpit's
// RunControlReport (task #57). compile-website-manifest's applySafetyGate
// (task #60/#61) already computes what account safety rules redacted or
// flagged in this page's generated copy and persists it on the website row
// as `generation_notes` -- this surfaces that at the point of delivery
// instead of leaving it as a jsonb column no owner would ever query.
import { useState } from "react";
import { ShieldCheck, ShieldAlert, ChevronDown, ChevronRight } from "lucide-react";

export default function WebsiteControlReport({ notes, trustScore }: { notes: string[] | null | undefined; trustScore?: number | null }) {
  const [open, setOpen] = useState(false);
  const list = Array.isArray(notes) ? notes : [];
  const clean = list.length === 0;
  // GAP 3 (Trust Score + Provenance + Control Report, 2026-10-09): the
  // same computeTrustScore (outer-control-scoring.ts) score persisted on
  // the website row by applySafetyGate/checkWebsiteAssembly -- not
  // recomputed here, just rendered. A website generated before this GAP
  // shipped has trustScore === null/undefined; falls back to the clean/
  // flagged read `notes` already gives rather than showing a bare dash.
  const score = typeof trustScore === "number" ? trustScore : clean ? 100 : null;
  const scoreColor = score === null ? "text-white/40" : score >= 80 ? "text-emerald-300" : score >= 50 ? "text-amber-300" : "text-red-400";
  // AUDIT 5 (Trust Score + Provenance + Control Report, 2026-10-07): this
  // used to match the exact generation-time phrase ("redacted at
  // generation time") only -- a note from the final-assembly check
  // (checkWebsiteAssembly's "...was redacted across this site at
  // final-assembly check...", now also merged into this same notes array
  // at publish time) was something that WAS actually redacted, but got
  // miscounted into the "flagged" bucket below purely because its wording
  // differs. Matching "was redacted" catches both callers' real redaction
  // notes without caring which check phase wrote them.
  const redacted = list.filter((n) => n.includes("was redacted"));
  const flagged = list.filter((n) => !redacted.includes(n));

  return (
    <div
      className="mx-4 mt-3 rounded-xl border p-3"
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
        <span className="text-sm font-bold text-white">Control Report — this generation</span>
        {score !== null && (
          <span className={`ml-auto text-xs font-mono font-bold ${scoreColor}`} title="Trust score: 100 minus a fixed cost per safety-rule match found during generation.">
            {score}
          </span>
        )}
        {clean ? (
          <span className={score !== null ? "ml-2 text-[10px] font-mono uppercase text-emerald-300/80" : "ml-auto text-[10px] font-mono uppercase text-emerald-300/80"}>clean</span>
        ) : (
          <>
            <span className="ml-2 text-[10px] font-mono uppercase text-amber-300/80">
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
          No account safety rule matched this page's generated copy.
        </p>
      ) : (
        open && (
          <ul className="mt-2.5 space-y-1.5">
            {list.map((note, i) => (
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
