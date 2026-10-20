// Inner Control header: which project this page is about. Lists the account's agents and websites; the choice changes everything
// on the page. With one project it is a label, with none it points to the Generator. More than one opens a styled list, grouped by kind.
import { useEffect, useRef, useState } from "react";
import { Bot, Check, ChevronDown, Globe, Plus } from "lucide-react";
import { KIND_LABEL, type InnerProject } from "@/lib/inner-projects";

const KIND_ICON = { agent: Bot, website: Globe } as const;

function Group({ title, items, selectedKey, onPick }: { title: string; items: InnerProject[]; selectedKey: string; onPick: (key: string) => void }) {
  if (items.length === 0) return null;
  const Icon = KIND_ICON[items[0].kind];
  return (
    <div role="group" aria-label={title} className="py-1">
      <div className="flex items-center gap-1.5 px-3 pb-1 pt-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        <Icon className="h-3 w-3" /> {title} <span className="text-zinc-600">{items.length}</span>
      </div>
      {items.map((p) => {
        const active = p.key === selectedKey;
        return (
          <button
            key={p.key} type="button" role="option" data-testid={`project-option-${p.key}`} aria-selected={active} onClick={() => onPick(p.key)}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors focus-visible:bg-white/10 focus-visible:outline-none ${active ? "bg-cyan-500/10 text-cyan-100" : "text-zinc-200 hover:bg-white/[0.06]"}`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-cyan-300" : "bg-transparent"}`} />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            {active && <Check className="h-3.5 w-3.5 shrink-0 text-cyan-300" />}
          </button>
        );
      })}
    </div>
  );
}

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
  return <PickerMenu agents={agents} websites={websites} selected={selected} Icon={Icon} onSelect={onSelect} />;
}

function PickerMenu({ agents, websites, selected, Icon, onSelect }: {
  agents: InnerProject[]; websites: InnerProject[]; selected: InnerProject; Icon: typeof Bot; onSelect: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const pick = (key: string) => { setOpen(false); if (key !== selected.key) onSelect(key); };
  return (
    <div ref={box} className="relative">
      <button
        ref={trigger} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open}
        aria-label="Choose the project Inner Control shows" title="Choose the project Inner Control shows"
        data-testid="project-picker" data-value={selected.key} onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider transition-colors ${open ? "border-cyan-400/60 bg-cyan-500/15" : "border-cyan-500/30 bg-cyan-500/[0.06] hover:border-cyan-400/50 hover:bg-cyan-500/10"}`}
      >
        <Icon className="h-3.5 w-3.5 text-cyan-300" />
        <span className="text-zinc-500">{KIND_LABEL[selected.kind]}</span>
        <span className="max-w-[200px] truncate normal-case tracking-normal text-zinc-100">{selected.name}</span>
        <ChevronDown className={`h-3 w-3 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          role="listbox" aria-label="Your projects"
          className="absolute left-0 top-full z-50 mt-2 w-[280px] overflow-hidden rounded-xl border border-cyan-500/25 bg-[#050b1a]/95 text-zinc-100 shadow-[0_12px_40px_rgba(0,0,0,0.6),0_0_0_1px_rgba(34,211,238,0.06)] backdrop-blur"
        >
          <div className="max-h-[320px] divide-y divide-white/5 overflow-y-auto">
            <Group title="Agents" items={agents} selectedKey={selected.key} onPick={pick} />
            <Group title="Websites" items={websites} selectedKey={selected.key} onPick={pick} />
          </div>
          <div className="border-t border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] text-zinc-500">Everything on this page follows the project you pick.</div>
        </div>
      )}
    </div>
  );
}
