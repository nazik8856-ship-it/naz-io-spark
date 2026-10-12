import { useEffect, useMemo, useState } from "react";
import { Loader2, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { diffSites, type DiffPage, type DiffSite } from "@/lib/site-diff";

export type VersionRow = { id: string; label: string | null; created_at: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  websiteId: string;
  /** The live site as currently saved. */
  current: DiffSite;
  versions: VersionRow[];
  /** Version to compare against first (the snapshot taken before the latest change). */
  initialVersionId?: string | null;
  /** Bumped by the parent after every save so the "after" frame reloads. */
  previewKey: number;
  onRestore: (versionId: string) => void;
};

const previewUrl = (websiteId: string, page: string, versionId?: string) =>
  `/website-preview/${websiteId}?embed=1&page=${encodeURIComponent(page)}${versionId ? `&version=${versionId}` : ""}`;

/**
 * Instant before/after comparison: a saved version next to (or toggled
 * against) the current site, both rendered by the real preview, plus a
 * plain-language list of what changed. Restoring goes through the existing
 * restore flow, which snapshots the current state first.
 */
export default function BeforeAfterDialog({ open, onOpenChange, websiteId, current, versions, initialVersionId, previewKey, onRestore }: Props) {
  const [versionId, setVersionId] = useState<string | null>(initialVersionId ?? versions[0]?.id ?? null);
  const [mode, setMode] = useState<"toggle" | "side">("side");
  const [showing, setShowing] = useState<"before" | "after">("after");
  const [pageSlug, setPageSlug] = useState("home");
  const [before, setBefore] = useState<DiffSite | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setVersionId(initialVersionId ?? versions[0]?.id ?? null);
  }, [open, initialVersionId, versions]);

  useEffect(() => {
    if (!open || !versionId) { setBefore(null); return; }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      const { data, error } = await supabase
        .from("website_versions")
        .select("website_snapshot, pages_snapshot")
        .eq("id", versionId)
        .eq("website_id", websiteId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setBefore(null);
        setLoadError(error?.message ?? "That saved version could not be loaded.");
      } else {
        const ws = (data.website_snapshot ?? {}) as Record<string, any>;
        const pgs = (Array.isArray(data.pages_snapshot) ? data.pages_snapshot : []) as Record<string, any>[];
        setBefore({
          theme: ws.theme ?? null,
          pages: pgs.map((p) => ({ slug: String(p.slug), title: p.title, sections: Array.isArray(p.sections) ? p.sections : [] })) as DiffPage[],
        });
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, versionId, websiteId]);

  const diff = useMemo(() => (before ? diffSites(before, current) : null), [before, current]);
  const slugs = useMemo(() => {
    const all = [...current.pages, ...(before?.pages ?? [])].map((p) => p.slug);
    return [...new Set(all)];
  }, [current, before]);
  const slug = slugs.includes(pageSlug) ? pageSlug : slugs[0] ?? "home";
  const selected = versions.find((v) => v.id === versionId) ?? null;

  const frame = (kind: "before" | "after") => (
    <div className="flex-1 min-w-0 flex flex-col gap-1.5" data-frame={kind}>
      <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/50">
        {kind === "before" ? `Before${selected?.label ? ` · ${selected.label}` : ""}` : "After · current"}
      </div>
      <div className="relative flex-1 min-h-[320px] rounded-lg overflow-hidden border border-white/10 bg-white">
        {kind === "before" && !versionId ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-500 bg-[#050813]">No saved version to compare.</div>
        ) : (
          <iframe
            key={`${kind}-${versionId}-${kind === "after" ? previewKey : 0}-${slug}`}
            title={`${kind} preview`}
            src={kind === "before" ? previewUrl(websiteId, slug, versionId!) : previewUrl(websiteId, slug)}
            className="absolute inset-0 w-full h-full border-0"
          />
        )}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[96vw] h-[90vh] flex flex-col gap-3 bg-[#0a0f1e] border-white/10 text-white">
        <DialogHeader>
          <DialogTitle>Before / after</DialogTitle>
          <DialogDescription className="text-white/50">
            Compare the current site with a saved version. Restoring a version saves the current state first, so it can be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5 text-white/60">
            Compare with
            <select
              aria-label="Version to compare with"
              value={versionId ?? ""}
              onChange={(e) => setVersionId(e.target.value || null)}
              className="rounded-md bg-white/[0.06] border border-white/10 px-2 py-1 text-white/90"
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id} className="text-black">{(v.label || "Snapshot")} · {new Date(v.created_at).toLocaleString()}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-white/60">
            Page
            <select
              aria-label="Page to compare"
              value={slug}
              onChange={(e) => setPageSlug(e.target.value)}
              className="rounded-md bg-white/[0.06] border border-white/10 px-2 py-1 text-white/90"
            >
              {slugs.map((s) => <option key={s} value={s} className="text-black">/{s}</option>)}
            </select>
          </label>
          <div className="inline-flex p-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06] ml-auto" role="group" aria-label="View mode">
            {(["side", "toggle"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m}
                className={cn("px-3 py-1 rounded-md font-medium transition", mode === m ? "bg-white/[0.1] text-white" : "text-white/50 hover:text-white/80")}>
                {m === "side" ? "Side by side" : "Toggle"}
              </button>
            ))}
          </div>
          {mode === "toggle" && (
            <div className="inline-flex p-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06]" role="group" aria-label="Toggle between before and after">
              {(["before", "after"] as const).map((k) => (
                <button key={k} type="button" onClick={() => setShowing(k)} aria-pressed={showing === k}
                  className={cn("px-3 py-1 rounded-md font-medium capitalize transition", showing === k ? "bg-cyan-400/20 text-cyan-100" : "text-white/50 hover:text-white/80")}>
                  {k}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 flex gap-3" data-testid="compare-frames">
          {mode === "side" ? (<>{frame("before")}{frame("after")}</>) : frame(showing)}
        </div>

        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 max-h-[22vh] overflow-y-auto">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/50">What changed</div>
            {versionId && (
              <button
                type="button"
                onClick={() => onRestore(versionId)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-cyan-200 border border-cyan-400/30 bg-cyan-400/10 hover:bg-cyan-400/20 transition"
              >
                <Undo2 className="h-3 w-3" /> Restore previous version
              </button>
            )}
          </div>
          {loading && <div className="mt-2 flex items-center gap-2 text-xs text-white/50"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the saved version…</div>}
          {loadError && <p className="mt-2 text-xs text-amber-300">{loadError}</p>}
          {diff && !loading && (
            diff.changed ? (
              <ul className="mt-2 space-y-1 text-xs text-white/80" data-testid="diff-lines">
                {diff.lines.map((l, i) => <li key={i}>• {l}</li>)}
              </ul>
            ) : <p className="mt-2 text-xs text-white/50">No visible difference from this version.</p>
          )}
          {!versions.length && <p className="mt-2 text-xs text-white/50">No saved versions yet — one is created before every edit, rebuild or professional pass.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
