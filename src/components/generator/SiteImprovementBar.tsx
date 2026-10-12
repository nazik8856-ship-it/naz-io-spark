import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Columns2, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase, SUPABASE_FUNCTIONS_URL, SUPABASE_ANON } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import QualityStrip from "@/components/generator/QualityStrip";
import StageStepper from "@/components/generator/StageStepper";
import BeforeAfterDialog, { type VersionRow } from "@/components/generator/BeforeAfterDialog";
import {
  INITIAL_CHECKS, isAutoFixNote, normalizeChecks, stripNotePrefix, structureLabel, type QualityCheck,
} from "@/lib/site-structures";

type Props = {
  websiteId: string;
  website: Record<string, any> | null;
  pages: Record<string, any>[];
  /** Bumped by the parent after every save; reloads the "after" frame and the version list. */
  previewKey: number;
  /** Re-reads the site + pages and refreshes the preview. */
  onReload: () => Promise<void>;
  /** Starts the dashboard's existing restore flow (confirmation, snapshot-first). */
  onRestoreVersion: (versionId: string) => void;
};

const POLISH_TIMEOUT_MS = 120_000;

/**
 * The Generator's improvement controls for one website: the staged-flow
 * stepper, the one-click "Make it more professional" pass with its live
 * quality strip, the list of things the Generator fixed by itself, and the
 * before/after comparison.
 */
export default function SiteImprovementBar({ websiteId, website, pages, previewKey, onReload, onRestoreVersion }: Props) {
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<QualityCheck[]>(INITIAL_CHECKS);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareVersionId, setCompareVersionId] = useState<string | null>(null);
  const [fixesOpen, setFixesOpen] = useState(false);

  const stage = (website?.generation_stage as string | null | undefined) ?? null;
  const structure = structureLabel(website?.structure_template);
  const strict = website?.strict_mode === true;
  const autoFixes = useMemo(
    () => (Array.isArray(website?.generation_notes) ? (website!.generation_notes as unknown[]).filter(isAutoFixNote).map(stripNotePrefixSafe) : []),
    [website?.generation_notes],
  );

  const loadVersions = useCallback(async (): Promise<VersionRow[]> => {
    const { data } = await supabase
      .from("website_versions")
      .select("id, label, created_at")
      .eq("website_id", websiteId)
      .order("created_at", { ascending: false })
      .limit(30);
    const rows = (data ?? []) as VersionRow[];
    setVersions(rows);
    return rows;
  }, [websiteId]);

  useEffect(() => { void loadVersions(); }, [loadVersions, previewKey]);

  // Live checks while the pass runs: same poll GeneratorHome uses for a new site.
  useEffect(() => {
    if (!busy || !requestId) return;
    let cancelled = false;
    const poll = async () => {
      const { data } = await supabase.from("generation_progress").select("checks" as "stage").eq("request_id", requestId).maybeSingle();
      const raw = (data as unknown as { checks?: unknown } | null)?.checks;
      if (!cancelled && raw) setChecks(normalizeChecks(raw));
    };
    void poll();
    const timer = setInterval(poll, 1300);
    return () => { cancelled = true; clearInterval(timer); };
  }, [busy, requestId]);

  const runProfessionalPass = async () => {
    if (busy) return;
    setBusy(true);
    setChecks(INITIAL_CHECKS);
    const reqId = crypto.randomUUID();
    setRequestId(reqId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), POLISH_TIMEOUT_MS);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Your session expired. Please refresh the page and try again.");
      const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/compile-website-manifest`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON },
        body: JSON.stringify({ prompt: "Make it more professional", improve: "professional", previousWebsiteId: websiteId, requestId: reqId }),
        signal: controller.signal,
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(body?.message || body?.error || `Professional pass failed (${resp.status})`);
      if (Array.isArray(body?.quality_checks)) setChecks(normalizeChecks(body.quality_checks));
      await onReload();
      const rows = await loadVersions();
      if (body?.improved) {
        toast.success(body.summary || "Professional pass applied.");
        // Instant before/after: open the comparison against the snapshot just taken.
        setCompareVersionId(rows[0]?.id ?? null);
        setCompareOpen(true);
      } else {
        toast.info(body?.summary || "Nothing needed to change.");
      }
    } catch (e) {
      const timedOut = e instanceof DOMException && e.name === "AbortError";
      toast.error(timedOut ? "The professional pass is taking too long — your site is unchanged. Try again." : e instanceof Error ? e.message : "Professional pass failed");
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  };

  const current = useMemo(
    () => ({ theme: (website?.theme ?? null) as Record<string, any> | null, pages: pages.map((p) => ({ slug: String(p.slug), title: p.title as string | undefined, sections: Array.isArray(p.sections) ? p.sections : [] })) }),
    [website?.theme, pages],
  );

  if (!website) return null;
  const showStepper = stage === "content" || stage === "polished";

  return (
    <div className="shrink-0 border-b border-white/[0.06] bg-[#080d1c] px-4 py-2.5 space-y-2" data-testid="site-improvement-bar">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {showStepper && <StageStepper current="polish" done={stage === "polished"} />}
        <div className="flex items-center gap-1.5 text-[11px]">
          {structure && <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-white/70">{structure}</span>}
          {strict && <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-amber-200">Strict</span>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {autoFixes.length > 0 && (
            <button
              type="button"
              onClick={() => setFixesOpen((o) => !o)}
              aria-expanded={fixesOpen}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-emerald-200 border border-emerald-400/30 bg-emerald-400/10 hover:bg-emerald-400/20 transition"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Fixed automatically ({autoFixes.length})
              <ChevronDown className={cn("h-3 w-3 transition-transform", fixesOpen && "rotate-180")} />
            </button>
          )}
          <button
            type="button"
            onClick={() => { setCompareVersionId(versions[0]?.id ?? null); setCompareOpen(true); }}
            disabled={versions.length === 0}
            title={versions.length === 0 ? "A version is saved before every edit, rebuild or professional pass" : "Compare the current site with a saved version"}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-white/80 border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] transition disabled:opacity-40"
          >
            <Columns2 className="h-3.5 w-3.5" /> Compare
          </button>
          <button
            type="button"
            onClick={runProfessionalPass}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-[#120a24] bg-gradient-to-r from-purple-300 to-fuchsia-300 hover:from-purple-200 hover:to-fuchsia-200 transition disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {busy ? "Making it more professional…" : "Make it more professional"}
          </button>
        </div>
      </div>

      {busy && <QualityStrip checks={checks} compact />}
      {!busy && stage === "content" && (
        <p className="text-[11px] text-white/50">Step 3 of 3 — visual polish: stricter wording and links, consistent spacing, and a relevance check on images and claims. A version is saved first.</p>
      )}
      {fixesOpen && autoFixes.length > 0 && (
        <ul className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.05] px-3 py-2 space-y-1 text-xs text-emerald-100/90" data-testid="auto-fixes">
          {autoFixes.map((n, i) => <li key={i}>• {n}</li>)}
        </ul>
      )}

      <BeforeAfterDialog
        open={compareOpen}
        onOpenChange={setCompareOpen}
        websiteId={websiteId}
        current={current}
        versions={versions}
        initialVersionId={compareVersionId}
        previewKey={previewKey}
        onRestore={(vid) => { setCompareOpen(false); onRestoreVersion(vid); }}
      />
    </div>
  );
}

function stripNotePrefixSafe(n: unknown): string {
  return typeof n === "string" ? stripNotePrefix(n) : "";
}
