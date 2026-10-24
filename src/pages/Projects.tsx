// Projects: every project of the account, imported (snapshot or linked) and generated (agents and websites), with its source,
// status and type. This page only exists once there is a project: with none it goes back to the dashboard, so there is never an
// empty Projects page.
import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ArrowLeft, FolderInput, FolderKanban, Loader2 } from "lucide-react";
import { useProjectList } from "@/hooks/useProjectList";
import { projectType, shortDate } from "@/lib/projects";
import { ControlBadge, SourceBadge } from "@/components/projects/ProjectBadges";
import ImportProjectDialog from "@/components/projects/ImportProjectDialog";

type Filter = "all" | "imported" | "generated";

export default function Projects() {
  const navigate = useNavigate();
  const { items, loading } = useProjectList();
  const [filter, setFilter] = useState<Filter>("all");
  const [importing, setImporting] = useState(false);
  const shown = useMemo(() => items.filter((i) => filter === "all" || i.origin === filter), [items, filter]);
  useEffect(() => { document.title = "Projects · NazAI"; }, []);

  if (!loading && items.length === 0 && !importing) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen w-full text-white" style={{ backgroundColor: "#020617" }}>
      <header className="flex flex-wrap items-center gap-3 border-b border-white/5 px-4 py-4 sm:px-6">
        <button onClick={() => navigate("/dashboard")} className="flex items-center gap-2 text-zinc-400 transition-colors hover:text-white" aria-label="Back to dashboard">
          <ArrowLeft className="h-5 w-5" /><span className="font-mono text-sm uppercase tracking-wider">Back</span>
        </button>
        <h1 className="ml-2 flex items-center gap-2 text-lg font-semibold"><FolderKanban className="h-5 w-5 text-[#d4af37]" /> Projects</h1>
        <button onClick={() => setImporting(true)} className="ml-auto flex items-center gap-1.5 rounded-lg border border-amber-300/50 bg-amber-400/15 px-3.5 py-2 text-sm font-semibold text-amber-50 shadow-[0_0_18px_-4px_rgba(212,175,55,0.5)] hover:bg-amber-400/25" data-testid="projects-import">
          <FolderInput className="h-4 w-4" /> Import
        </button>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <p className="text-sm text-zinc-400">Every project here is under NazAI control: your rules apply to it, and Outer Control can use it.</p>
        <div className="mt-4 flex gap-1.5" role="tablist">
          {(["all", "imported", "generated"] as Filter[]).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 text-xs capitalize ${filter === f ? "border-amber-300/60 bg-amber-400/15 text-amber-100" : "border-white/10 text-zinc-400 hover:text-zinc-200"}`}>{f}</button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-amber-300" /></div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-[#0b1a35]/60 to-[#070f22]/60">
            <div className="hidden grid-cols-[2fr_1.2fr_1.6fr_1.2fr_0.6fr] gap-3 border-b border-white/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500 md:grid">
              <span>Name</span><span>Source</span><span>Status</span><span>Type</span><span>Updated</span>
            </div>
            <ul>
              {shown.map((p) => (
                <li key={p.key}>
                  <button type="button" onClick={() => navigate(p.href)} data-testid="project-row" data-kind={p.kind}
                    className="grid w-full grid-cols-1 gap-2 border-b border-white/[0.06] px-4 py-3 text-left transition hover:bg-amber-400/[0.04] md:grid-cols-[2fr_1.2fr_1.6fr_1.2fr_0.6fr] md:items-center md:gap-3">
                    <span className="truncate text-sm font-medium text-zinc-100" data-testid="project-name">{p.name}</span>
                    <span><SourceBadge project={p.imported ?? null} /></span>
                    <span><ControlBadge project={p.imported ?? null} /></span>
                    <span className="text-xs text-zinc-300" data-testid="project-type">{projectType(p)}</span>
                    <span className="text-xs text-zinc-500">{shortDate(p.updated_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {shown.length === 0 && <p className="px-4 py-6 text-sm text-zinc-500">None of this kind yet. Choose All to see every project.</p>}
          </div>
        )}
      </main>
      <ImportProjectDialog open={importing} onOpenChange={setImporting} />
    </div>
  );
}
