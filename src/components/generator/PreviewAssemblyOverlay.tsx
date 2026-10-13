import { useEffect, useRef, useState } from "react";
import AssemblyVisual from "@/components/generator/AssemblyVisual";
import { advancePhase, assemblyPhase, type AssemblyPage, type AssemblyPhase } from "@/lib/assembly";
import { INITIAL_CHECKS, type QualityCheck } from "@/lib/site-structures";

type Props = {
  /** A chat edit / rebuild is running. */
  busy: boolean;
  /** Real generation_progress stage of the running edit, if known. */
  stage: string | null;
  checks?: QualityCheck[] | null;
  /** 0 before the edit request is sent, 3 once it has returned and is being saved/reloaded. */
  stepsPhase: AssemblyPhase;
  /** The preview iframe has finished loading. */
  previewLoaded: boolean;
  pages: AssemblyPage[];
  siteName?: string;
};

const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

/**
 * Shown over the live preview while something is actually happening to the
 * site: a chat edit/rebuild in progress, or the preview still loading. It plays
 * the same assembly as the generator page, with this site's REAL pages, then
 * resolves into the finished site (the pages merge into the output frame) and
 * fades away. It never appears when nothing is happening.
 */
export default function PreviewAssemblyOverlay({ busy, stage, checks, stepsPhase, previewLoaded, pages, siteName }: Props) {
  const [visible, setVisible] = useState(false);
  const [done, setDone] = useState(false);
  const [phase, setPhase] = useState<AssemblyPhase>(0);
  const wasBusy = useRef(false);
  const loadTimer = useRef<ReturnType<typeof setTimeout>>();
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();

  // Forward-only phase from the real stage and the real step of the edit.
  useEffect(() => {
    if (!busy) return;
    setPhase((p) => advancePhase(advancePhase(p, assemblyPhase(stage)), stepsPhase));
  }, [busy, stage, stepsPhase]);

  // An edit starts → show; it ends → merge into the output, then hide.
  useEffect(() => {
    if (busy) {
      clearTimeout(hideTimer.current);
      wasBusy.current = true;
      setPhase(0);
      setDone(false);
      setVisible(true);
      return;
    }
    if (wasBusy.current) {
      wasBusy.current = false;
      setDone(true);
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setVisible(false), reduced() ? 600 : 1800);
    }
  }, [busy]);

  // The preview is slow to load (not busy): show the assembly only if it takes noticeable time.
  useEffect(() => {
    if (busy) return;
    if (!previewLoaded) {
      clearTimeout(loadTimer.current);
      loadTimer.current = setTimeout(() => {
        setPhase(3);
        setDone(false);
        setVisible(true);
      }, 450);
      return () => clearTimeout(loadTimer.current);
    }
    clearTimeout(loadTimer.current);
    if (visible && !wasBusy.current) {
      setDone(true);
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setVisible(false), reduced() ? 400 : 1400);
    }
    // `visible` is deliberately not a dependency: this reacts to the load finishing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewLoaded, busy]);

  useEffect(() => () => { clearTimeout(loadTimer.current); clearTimeout(hideTimer.current); }, []);

  if (!visible) return null;
  return (
    <div
      data-testid="preview-assembly-overlay"
      role="status"
      aria-label={done ? "Your site is ready" : busy ? "Updating your site" : "Loading your site"}
      className="absolute inset-0 z-20 flex items-center justify-center overflow-auto bg-[#050813]/92 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-3xl">
        <AssemblyVisual
          pages={pages}
          phase={done ? 4 : phase}
          checks={checks ?? INITIAL_CHECKS}
          siteName={siteName}
          statusText={busy ? undefined : done ? undefined : "Loading your live preview…"}
        />
      </div>
    </div>
  );
}
