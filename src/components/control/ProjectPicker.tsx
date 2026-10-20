// Inner Control header: which project this page is about. Lists the account's agents and websites; the choice changes everything
// on the page. With one project it is a label, with none it points to the Generator.
import { Bot, ChevronDown, Globe, Plus } from "lucide-react";
import { KIND_LABEL, type InnerProject } from "@/lib/inner-projects";

export default function ProjectPicker({
  projects, selected, loading, onSelect, onCreate,
}: {
  projects: InnerProject[];
  selected: InnerProject | null;
  loading: boolean;
  onSelect: (key: string) => void;
  onCreate: () => void;
}) {
  if (loading) {
    return <div className="h-8 w-44 animate-pulse rounded border border-white/10 bg-white/[0.03]" data-testid="project-picker-loading" aria-label="Loading projects" />;
  }
  if (projects.length === 0 || !selected) {
    return (
      <button onClick={onCreate} className="flex items-center gap-1.5 rounded border border-dashed border-cyan-500/40 bg-cyan-500/5 px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-wider text-cyan-200 hover:bg-cyan-500/10" data-testid="project-picker-empty">
        <Plus className="h-3.5 w-3.5" /> Create your first project
      </button>
    );
  }
  const Icon = selected.kind === "agent" ? Bot : Globe;
  const agents = projects.filter((p) => p.kind === "agent");
  const websites = projects.filter((p) => p.kind === "website");
  if (projects.length === 1) {
    return (
      <div className="flex items-center gap-1.5 rounded border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-wider text-zinc-300" data-testid="project-picker-single">
        <Icon className="h-3.5 w-3.5 text-cyan-300" />
        <span className="text-zinc-500">{KIND_LABEL[selected.kind]}</span>
        <span className="max-w-[200px] truncate normal-case tracking-normal text-zinc-100">{selected.name}</span>
      </div>
    );
  }
  return (
    <label className="relative flex items-center gap-1.5 rounded border border-cyan-500/30 bg-cyan-500/[0.06] px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-wider text-zinc-300" data-testid="project-picker">
      <Icon className="h-3.5 w-3.5 text-cyan-300" />
      <span className="text-zinc-500">Project</span>
      <select
        value={selected.key}
        onChange={(e) => onSelect(e.target.value)}
        className="max-w-[240px] appearance-none bg-transparent pr-5 normal-case tracking-normal text-zinc-100 outline-none [&>optgroup]:bg-[#020617] [&>optgroup>option]:bg-[#020617] [&>option]:bg-[#020617]"
        aria-label="Choose the project Inner Control shows"
        title="Choose the project Inner Control shows"
      >
        {agents.length > 0 && <optgroup label="Agents">{agents.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</optgroup>}
        {websites.length > 0 && <optgroup label="Websites">{websites.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</optgroup>}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3 w-3 opacity-60" />
    </label>
  );
}
