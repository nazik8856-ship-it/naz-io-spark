// Outer Control: the official result of a Completed session or Task. The controlled output is always visible; the
// proof, rules and changes are one tap away, as readable text or as the structured JSON (the same record).
import { useState } from "react";
import { Check, Copy, Download, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { validateArtifact, type Artifact } from "@/lib/outer-control-artifact";

export default function FinalArtifactView({ artifact, kind }: { artifact: unknown; kind: "session" | "task" }) {
  const [view, setView] = useState<"readable" | "json">("readable");
  const valid = validateArtifact(artifact, kind);
  // Never render a result from something that is not a valid artifact.
  if (!valid.ok) return null;
  const a = artifact as Artifact;
  const json = JSON.stringify(a, null, 2);

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(`${what} copied.`); }
    catch { toast.error("Could not copy. Select the text and copy it by hand."); }
  };

  /** The result as a file: a report is Markdown; anything else is plain text. */
  const download = () => {
    try {
      const isReport = a.final_output.trimStart().startsWith("# ");
      const url = URL.createObjectURL(new Blob([a.final_output], { type: isReport ? "text/markdown" : "text/plain" }));
      const el = document.createElement("a");
      el.href = url; el.download = `${isReport ? "report" : "result"}-${a.id.slice(0, 8)}.${isReport ? "md" : "txt"}`;
      document.body.appendChild(el); el.click(); el.remove(); URL.revokeObjectURL(url);
    } catch { toast.error("Could not download. Use Copy result instead."); }
  };

  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.05] px-3 py-2" data-testid="final-artifact">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-emerald-300">
          <Check className="h-3 w-3" /> Final result · controlled version
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={download} className="flex items-center gap-1 rounded border border-white/15 px-2 py-0.5 text-[10px] font-mono uppercase text-zinc-300 hover:bg-white/10" data-testid="download-result">
            <Download className="h-3 w-3" /> Download
          </button>
          <button type="button" onClick={() => copy(a.final_output, "Result")} className="flex items-center gap-1 rounded border border-white/15 px-2 py-0.5 text-[10px] font-mono uppercase text-zinc-300 hover:bg-white/10">
            <Copy className="h-3 w-3" /> Copy result
          </button>
        </div>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-sm text-zinc-100" data-testid="final-artifact-output">{a.final_output}</p>
      {a.what_done && (
        <p className="mt-2 text-xs text-zinc-300" data-testid="final-artifact-what-done"><span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">What was done · </span>{a.what_done}</p>
      )}
      {a.links && a.links.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2" data-testid="final-artifact-links">
          {a.links.map((l) => (
            <li key={l.url}>
              <a href={l.url} target="_blank" rel="noopener noreferrer" title={l.url}
                className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-100 hover:bg-cyan-500/20">
                <ExternalLink className="h-3 w-3" /> Open the work · {l.label}
              </a>
            </li>
          ))}
        </ul>
      )}
      <details className="mt-2 rounded border border-white/10 px-2 py-1 text-xs" data-testid="final-artifact-proof">
        <summary className="cursor-pointer text-zinc-300">
          Proof, rules applied and changes · {a.rules.triggered.length} rule{a.rules.triggered.length === 1 ? "" : "s"} triggered · {a.changes.length} change{a.changes.length === 1 ? "" : "s"}
        </summary>
        <div className="mt-1.5 flex items-center gap-2">
          {(["readable", "json"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
              className={`rounded border px-2 py-0.5 text-[10px] font-mono uppercase ${view === v ? "border-cyan-500/50 text-cyan-300" : "border-white/15 text-zinc-400 hover:bg-white/10"}`}>
              {v === "readable" ? "Readable" : "JSON"}
            </button>
          ))}
          <button type="button" onClick={() => copy(view === "json" ? json : a.human_text, view === "json" ? "JSON" : "Text")} className="ml-auto flex items-center gap-1 rounded border border-white/15 px-2 py-0.5 text-[10px] font-mono uppercase text-zinc-300 hover:bg-white/10">
            <Copy className="h-3 w-3" /> Copy
          </button>
        </div>
        <pre className="mt-1.5 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-black/30 p-2 text-[11px] leading-relaxed text-zinc-300" data-testid={view === "json" ? "final-artifact-json" : "final-artifact-text"}>
          {view === "json" ? json : a.human_text}
        </pre>
      </details>
    </div>
  );
}
