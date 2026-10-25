// The two badges every project shows wherever it appears: where it came from (Snapshot / Linked / Generated) and that it is under
// NazAI control (or why it needs attention).
import { AlertTriangle, Copy, Eye, Link2, Lock, ShieldCheck, Sparkles } from "lucide-react";
import { projectStatus, sourceBadge, type ImportedProject } from "@/lib/projects";

export function SourceBadge({ project, withDetail = false }: { project: ImportedProject | null; withDetail?: boolean }) {
  const b = sourceBadge(project);
  const style = b.tone === "linked" ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-200" : b.tone === "snapshot" ? "border-zinc-400/40 bg-white/[0.04] text-zinc-200" : "border-purple-400/40 bg-purple-500/10 text-purple-200";
  const Icon = b.tone === "linked" ? Link2 : b.tone === "snapshot" ? Copy : Sparkles;
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-testid="source-badge" data-tone={b.tone}>
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] ${style}`} title={b.detail}>
        <Icon className="h-3 w-3" /> {b.label}
      </span>
      {withDetail && <span className="text-xs text-zinc-400" data-testid="source-detail">{b.detail}</span>}
    </span>
  );
}

export function ControlBadge({ project }: { project: ImportedProject | null }) {
  const s = projectStatus(project);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] ${s.tone === "ok" ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200" : "border-amber-400/50 bg-amber-400/10 text-amber-200"}`} data-testid="control-badge" data-tone={s.tone}>
      {s.tone === "ok" ? <ShieldCheck className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />} <span className="max-w-[28ch] truncate">{s.label}</span>
    </span>
  );
}

/** The small shield every protected project shows: its text is stored encrypted and secrets were hidden before saving. */
export function ProtectedBadge({ project }: { project: ImportedProject | null }) {
  if (!project?.last_check?.protected) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/40 bg-gradient-to-r from-amber-400/15 to-cyan-400/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-amber-100 shadow-[0_0_14px_-6px_rgba(212,175,55,0.9)]"
      title="Protected: stored encrypted, secrets hidden before saving, only your team can read it" data-testid="protected-badge">
      <Lock className="h-3 w-3" /> Protected
    </span>
  );
}

/** For a team member who can see the project but not change it. */
export function ViewOnlyBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-300" title="Only an owner of this account can change this project" data-testid="view-only-badge">
      <Eye className="h-3 w-3" /> View only
    </span>
  );
}
