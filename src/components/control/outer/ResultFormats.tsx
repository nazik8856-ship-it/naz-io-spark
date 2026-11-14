// Outer Control: what a finished result offers beyond reading it: five looks to see it in (chosen before the Task started, switchable
// here) and five file types to take it away as (Word, PDF, Excel, CSV, Markdown). The files follow the look that is showing.
// A file type the request itself asked for ("as a PDF") is marked and listed first.
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, FileDown, Palette } from "lucide-react";
import { toast } from "sonner";
import type { OutputTemplate } from "@/lib/outer-control-report-doc";
import type { ResultDoc } from "@/lib/outer-control-result-doc";
import { buildFile, FILE_LABEL, printPage, saveBytes, type FileKind } from "@/lib/outer-control-files";
import { detectRequestedOutput, renderTemplate, TEMPLATE_IDS, TEMPLATE_INFO } from "@/lib/outer-control-templates";

const ORDER: FileKind[] = ["docx", "pdf", "xlsx", "csv", "md"];

/** The looks, as a row of small swatches. */
export function LookPicker({ look, onLook }: { look: OutputTemplate; onLook: (l: OutputTemplate) => void }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Look of the result" data-testid="look-picker">
      <span className="flex items-center gap-1 pr-1 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-400"><Palette className="h-3 w-3" /> Look</span>
      {TEMPLATE_IDS.map((id) => {
        const c = TEMPLATE_INFO[id].colors;
        const on = id === look;
        return (
          <button key={id} type="button" role="radio" aria-checked={on} title={TEMPLATE_INFO[id].blurb} onClick={() => onLook(id)} data-testid={`look-${id}`}
            className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition ${on ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-100" : "border-white/15 text-zinc-300 hover:bg-white/10"}`}>
            <span className="h-3 w-3 shrink-0 rounded-full border border-white/30" style={{ background: `linear-gradient(135deg, ${c.bg} 0 50%, ${c.accent} 50% 100%)` }} aria-hidden />
            {TEMPLATE_INFO[id].name}
          </button>
        );
      })}
    </div>
  );
}

/** "Download as": Word, PDF, Excel, CSV, Markdown. */
export function FileMenu({ doc, look, report, noun, id, request }: { doc: ResultDoc; look: OutputTemplate; report?: unknown; noun: string; id: string; request: string }) {
  const asked = useMemo(() => detectRequestedOutput(request).file, [request]);
  const kinds = useMemo(() => (asked ? [asked, ...ORDER.filter((k) => k !== asked)] : ORDER), [asked]);

  const make = (kind: FileKind) => {
    try {
      const file = buildFile(kind, doc, look, { noun, id });
      if (!file) {
        // A standard-font PDF can not hold this text (another script, emoji): the browser's own print dialog can.
        if (printPage(renderTemplate(doc, look, report))) toast.message("This result has characters a PDF file can't hold here, so the print dialog opened. Choose “Save as PDF” there.");
        else toast.error("Could not make the PDF. Download the web page instead and print it.");
        return;
      }
      if (saveBytes(file)) toast.success(`${FILE_LABEL[kind]} downloaded.`);
      else toast.error("Could not download. Use Copy result instead.");
    } catch { toast.error("Could not make that file. Use Copy result instead."); }
  };

  // A small menu: opens under the button, closes on a choice, on Escape and on a click anywhere else.
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <div className="relative" ref={box}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded border border-white/15 px-2 py-0.5 text-[10px] font-mono uppercase text-zinc-300 hover:bg-white/10" data-testid="download-as">
        <FileDown className="h-3 w-3" /> Download as <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div role="menu" aria-label="Download as" className="absolute right-0 z-20 mt-1 min-w-[13rem] rounded-lg border border-white/15 bg-[#0a1428] p-1 shadow-xl" data-testid="download-menu">
          <p className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-zinc-400">In the “{TEMPLATE_INFO[look].name}” look</p>
          {kinds.map((k) => (
            <button key={k} type="button" role="menuitem" onClick={() => { setOpen(false); make(k); }} data-testid={`download-${k}`}
              className="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-sm text-zinc-100 hover:bg-white/10 focus:bg-white/10 focus:outline-none">
              <span>{FILE_LABEL[k]}</span>
              {k === asked && <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-1.5 text-[9px] uppercase tracking-wide text-emerald-300" data-testid="download-asked">asked for</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The result in a chosen look, shown in a sandboxed frame: nothing in it can run or reach the page. */
export function LookPreview({ html, title }: { html: string; title: string }) {
  return <iframe title={title} srcDoc={html} sandbox="" className="mt-2 h-[30rem] w-full rounded-lg border border-white/10 bg-white" data-testid="look-preview" />;
}
