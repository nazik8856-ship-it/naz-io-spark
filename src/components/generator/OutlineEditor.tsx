import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LOCKED_PAGE_SLUGS, moveItem, OUTLINE_ADDABLE_TYPES, SECTION_LABELS, type Outline,
} from "@/lib/site-structures";

/**
 * Progressive refinement, stage 1: the proposed pages and sections, editable
 * before any content is written. Home (first, hero first) and contact are
 * locked in place; everything else can be reordered, removed or added to.
 * Structural rules for the chosen template are re-checked server-side when
 * the content stage runs.
 */
export default function OutlineEditor({
  outline, onChange, disabled,
}: { outline: Outline; onChange: (next: Outline) => void; disabled?: boolean }) {
  const setPage = (pi: number, patch: Partial<Outline["pages"][number]>) =>
    onChange({ pages: outline.pages.map((p, i) => (i === pi ? { ...p, ...patch } : p)) });

  return (
    <div className="space-y-3" data-testid="outline-editor">
      {outline.pages.map((page, pi) => {
        const locked = LOCKED_PAGE_SLUGS.has(page.slug);
        return (
          <section key={`${page.slug}-${pi}`} className="rounded-xl border border-white/10 bg-white/[0.03] p-4" data-page={page.slug}>
            <header className="flex items-center gap-2">
              <input
                value={page.title}
                disabled={disabled || page.slug === "contact"}
                onChange={(e) => setPage(pi, { title: e.target.value.slice(0, 60) })}
                aria-label={`Title of the ${page.slug} page`}
                className="bg-transparent text-sm font-semibold text-white outline-none border-b border-transparent focus:border-purple-400/60 min-w-0 flex-1"
              />
              <span className="text-[10px] font-mono text-zinc-500">/{page.slug}</span>
              {!locked && (
                <>
                  <button type="button" disabled={disabled || pi <= 1} aria-label={`Move ${page.title} up`}
                    onClick={() => onChange({ pages: moveItem(outline.pages, pi, pi - 1) })}
                    className="p-1 rounded text-zinc-400 hover:text-white disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                  <button type="button" disabled={disabled || pi >= outline.pages.length - 2} aria-label={`Move ${page.title} down`}
                    onClick={() => onChange({ pages: moveItem(outline.pages, pi, pi + 1) })}
                    className="p-1 rounded text-zinc-400 hover:text-white disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                  <button type="button" disabled={disabled} aria-label={`Remove the ${page.title} page`}
                    onClick={() => onChange({ pages: outline.pages.filter((_, i) => i !== pi) })}
                    className="p-1 rounded text-red-300/70 hover:text-red-300"><X className="h-3.5 w-3.5" /></button>
                </>
              )}
            </header>

            <ol className="mt-3 flex flex-wrap gap-2">
              {page.sections.map((s, si) => {
                const fixed = (page.slug === "home" && si === 0) || s.type === "contact";
                return (
                  <li key={`${s.type}-${si}`} data-section={s.type}
                    className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
                      fixed ? "border-white/10 text-zinc-300 bg-white/[0.03]" : "border-purple-400/30 text-purple-100 bg-purple-500/10")}>
                    {!fixed && (
                      <button type="button" disabled={disabled || si <= (page.slug === "home" ? 1 : 0)} aria-label={`Move ${SECTION_LABELS[s.type] ?? s.type} earlier`}
                        onClick={() => setPage(pi, { sections: moveItem(page.sections, si, si - 1) })}
                        className="text-zinc-400 hover:text-white disabled:opacity-30"><ChevronLeft className="h-3 w-3" /></button>
                    )}
                    <span>{SECTION_LABELS[s.type] ?? s.type}{s.variant ? <span className="text-zinc-500"> · {s.variant}</span> : null}</span>
                    {!fixed && (
                      <>
                        <button type="button" disabled={disabled || si >= page.sections.length - 1} aria-label={`Move ${SECTION_LABELS[s.type] ?? s.type} later`}
                          onClick={() => setPage(pi, { sections: moveItem(page.sections, si, si + 1) })}
                          className="text-zinc-400 hover:text-white disabled:opacity-30"><ChevronRight className="h-3 w-3" /></button>
                        <button type="button" disabled={disabled} aria-label={`Remove ${SECTION_LABELS[s.type] ?? s.type}`}
                          onClick={() => setPage(pi, { sections: page.sections.filter((_, i) => i !== si) })}
                          className="text-red-300/70 hover:text-red-300"><X className="h-3 w-3" /></button>
                      </>
                    )}
                  </li>
                );
              })}
              {page.slug !== "contact" && (
                <li>
                  <label className="inline-flex items-center gap-1 rounded-full border border-dashed border-white/20 px-2.5 py-1 text-xs text-zinc-400 hover:text-white">
                    <Plus className="h-3 w-3" />
                    <select
                      aria-label={`Add a section to ${page.title}`}
                      disabled={disabled}
                      value=""
                      onChange={(e) => {
                        if (!e.target.value) return;
                        setPage(pi, { sections: [...page.sections, { type: e.target.value }] });
                      }}
                      className="bg-transparent outline-none text-xs cursor-pointer"
                    >
                      <option value="">Add section</option>
                      {OUTLINE_ADDABLE_TYPES.map((t) => <option key={t} value={t} className="text-black">{SECTION_LABELS[t]}</option>)}
                    </select>
                  </label>
                </li>
              )}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
