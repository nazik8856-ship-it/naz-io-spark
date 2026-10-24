// Import a project into NazAI: a one-time copy from a link, uploaded text files or pasted text, or a Notion page that stays linked
// to its original. After the import it says plainly that the project is under NazAI control, what the rules found, and whether it
// is ready for Outer Control, with the next steps one press away.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, FileUp, FolderInput, Link2, Loader2, Play, Plus, Search, ShieldCheck, Type } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { announceProjectsChanged } from "@/hooks/useProjectList";
import { callProjects, MAX_CHARS, MAX_FILES, UPLOAD_ACCEPT, type ImportedProject, type ProjectCheck } from "@/lib/projects";
import { ControlBadge, SourceBadge } from "./ProjectBadges";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

type Tab = "link" | "upload" | "paste" | "notion";
type NotionPage = { id: string; title: string; last_edited: string; icon: string | null };
const inputCls = "w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-zinc-100 outline-none transition focus:border-amber-300/60 focus:shadow-[0_0_24px_-6px_rgba(212,175,55,0.6)]";

export default function ImportProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const { accountId } = useActiveAccount();
  const [tab, setTab] = useState<Tab>("link");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<{ name: string; text: string }[]>([]);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState<NotionPage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{ project: ImportedProject; check: ProjectCheck } | null>(null);
  const [notionConnected, setNotionConnected] = useState(false);
  const [toolsConnected, setToolsConnected] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open || !accountId) return;
    void (async () => {
      try {
        const [n, t] = await Promise.all([
          anyDb.from("agent_integrations").select("id").eq("user_id", accountId).eq("provider", "Notion").eq("status", "connected").limit(1),
          anyDb.from("external_tools").select("id, endpoint_url").eq("user_id", accountId).eq("enabled", true).is("removed_at", null),
        ]);
        setNotionConnected(Array.isArray(n?.data) && n.data.length > 0);
        setToolsConnected(Array.isArray(t?.data) && t.data.some((x: { endpoint_url?: string }) => !String(x.endpoint_url ?? "").startsWith("nazai-internal://")));
      } catch { /* the tabs that need these stay hidden */ }
    })();
  }, [open, accountId]);

  const reset = () => { setName(""); setUrl(""); setText(""); setFiles([]); setFileProblem(null); setQuery(""); setPages(null); setProblem(null); setDone(null); setTab("link"); };
  const close = (o: boolean) => { if (!o) reset(); onOpenChange(o); };

  const finish = async (action: string, payload: Record<string, unknown>) => {
    setBusy(true); setProblem(null);
    const r = await callProjects(action, { ...payload, ...(name.trim() ? { name: name.trim() } : {}) });
    setBusy(false);
    if (!r.ok) { setProblem(r.message || "The project could not be imported."); return; }
    setDone({ project: r.data.project as ImportedProject, check: r.data.check as ProjectCheck });
    announceProjectsChanged();
  };

  const pickFiles = async (list: FileList | null) => {
    setFileProblem(null);
    const arr = Array.from(list ?? []);
    if (arr.length > MAX_FILES) { setFileProblem(`Choose at most ${MAX_FILES} files.`); return; }
    const read = await Promise.all(arr.map(async (f) => ({ name: f.name, text: await f.text() })));
    const total = read.reduce((n, f) => n + f.text.length, 0);
    if (total > MAX_CHARS) { setFileProblem(`These files have ${total.toLocaleString("en")} characters; a project can hold at most ${MAX_CHARS.toLocaleString("en")}.`); return; }
    setFiles(read);
  };

  const searchNotion = async () => {
    setBusy(true); setProblem(null);
    const r = await callProjects("notion_search", { query });
    setBusy(false);
    if (!r.ok) { setProblem(r.message || "Notion could not be searched."); return; }
    setPages((r.data.pages as NotionPage[]) ?? []);
  };

  const tabs: { id: Tab; label: string; icon: typeof Link2; show: boolean }[] = [
    { id: "link", label: "Link", icon: Link2, show: true },
    { id: "upload", label: "Upload", icon: FileUp, show: true },
    { id: "paste", label: "Paste", icon: Type, show: true },
    { id: "notion", label: "From Notion", icon: FolderInput, show: notionConnected },
  ];

  const go = (path: string) => { close(false); navigate(path); };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-amber-300/20 bg-[#040915] text-zinc-100 shadow-[0_0_80px_-20px_rgba(212,175,55,0.35)] sm:max-w-xl" data-testid="import-dialog">
        <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-amber-400/15 blur-[90px] oc-glow" aria-hidden />
        <DialogHeader className="relative">
          <DialogTitle className="flex items-center gap-3 text-lg">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-amber-300/40 bg-amber-400/15 shadow-[0_0_24px_-4px_rgba(212,175,55,0.6)]"><FolderInput className="h-4 w-4 text-amber-200" /></span>
            {done ? "Project imported" : "Import project"}
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            {done ? "It is now a NazAI project." : "Bring an external project into NazAI so your rules apply to it and Outer Control can use it."}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="relative space-y-4 oc-in" data-testid="import-done">
            <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.06] p-4">
              <p className="flex items-center gap-2 text-base font-semibold text-emerald-100"><CheckCircle2 className="h-5 w-5 text-emerald-300" /> Under NazAI control</p>
              <p className="mt-1 text-sm text-zinc-200">{done.project.name}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2"><SourceBadge project={done.project} withDetail /></div>
            </div>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2" data-testid="import-check">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                {done.check.matches.length === 0
                  ? <span>Checked against {done.check.rules} rule{done.check.rules === 1 ? "" : "s"}: no matches.</span>
                  : <span>Checked against {done.check.rules} rules: {done.check.matches.length} match{done.check.matches.length === 1 ? "" : "es"} ({done.check.matches.map((m) => m.name).join(", ")}). {done.check.matches.some((m) => m.action === "remove_text") ? "That text is removed before any tool receives the project." : ""}</span>}
              </li>
              <li className="flex items-start gap-2" data-testid="import-ready">
                <Play className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
                {toolsConnected === false
                  ? <span>No AI tool is connected yet. <button type="button" className="text-cyan-300 underline-offset-2 hover:underline" onClick={() => go("/control-system/outer")}>Connect a tool</button> to use it with Outer Control.</span>
                  : <span>Ready for Outer Control: start a task with this project and your tools.</span>}
              </li>
            </ul>
            <div className="grid gap-2 sm:grid-cols-3">
              <button type="button" onClick={() => go(`/projects/${done.project.id}`)} className="rounded-xl border border-amber-300/50 bg-amber-400/15 px-3 py-2 text-sm font-semibold text-amber-50 hover:bg-amber-400/25" data-testid="import-open">Open project</button>
              <button type="button" onClick={() => go(`/projects/${done.project.id}#rules`)} className="flex items-center justify-center gap-1.5 rounded-xl border border-white/15 px-3 py-2 text-sm text-zinc-100 hover:bg-white/10" data-testid="import-add-rule"><Plus className="h-4 w-4" /> Add a rule</button>
              <button type="button" onClick={() => go(`/control-system/outer?project=${done.project.id}`)} className="flex items-center justify-center gap-1.5 rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-3 py-2 text-sm text-cyan-50 hover:bg-cyan-400/20" data-testid="import-start-task"><Play className="h-4 w-4" /> Start a task</button>
            </div>
            <div className="flex justify-center"><ControlBadge project={done.project} /></div>
          </div>
        ) : (
          <div className="relative space-y-4">
            <div className="flex flex-wrap gap-1.5 rounded-xl border border-white/10 bg-black/30 p-1" role="tablist">
              {tabs.filter((t) => t.show).map((t) => {
                const Icon = t.icon;
                return (
                  <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => { setTab(t.id); setProblem(null); }} data-testid={`import-tab-${t.id}`}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition ${tab === t.id ? "bg-amber-400/15 text-amber-100 shadow-[0_0_16px_-6px_rgba(212,175,55,0.8)]" : "text-zinc-400 hover:text-zinc-200"}`}>
                    <Icon className="h-3.5 w-3.5" /> {t.label}
                  </button>
                );
              })}
            </div>
            {!notionConnected && <p className="text-[11px] text-zinc-500" data-testid="import-notion-off">Connect Notion to import a page that stays linked to its original. Figma, Canva, Gmail, Slack and Shopify are not supported yet.</p>}

            {tab === "link" && (
              <div className="space-y-2">
                <input className={inputCls} aria-label="Link to import" placeholder="https://… (a public page or a public GitHub repository)" value={url} onChange={(e) => setUrl(e.target.value)} />
                <p className="text-[11px] text-zinc-500">A one-time copy of the page's text. Pages behind a login can not be imported.</p>
              </div>
            )}
            {tab === "upload" && (
              <div className="space-y-2">
                <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-amber-300/30 bg-amber-400/[0.03] px-4 py-6 text-center text-sm text-zinc-300 hover:bg-amber-400/[0.06]">
                  <FileUp className="h-6 w-6 text-amber-200" />
                  <span>{files.length ? `${files.length} file${files.length === 1 ? "" : "s"} chosen` : "Choose text files"}</span>
                  <span className="text-[11px] text-zinc-500">Text, markdown, HTML, JSON, CSV or code · up to {MAX_FILES} files · {MAX_CHARS.toLocaleString("en")} characters in all</span>
                  <input type="file" multiple accept={UPLOAD_ACCEPT} className="sr-only" aria-label="Files to import" onChange={(e) => void pickFiles(e.target.files)} />
                </label>
                {files.length > 0 && <ul className="max-h-28 overflow-y-auto text-xs text-zinc-400" data-testid="import-files">{files.map((f) => <li key={f.name}>{f.name} · {f.text.length.toLocaleString("en")} characters</li>)}</ul>}
                {fileProblem && <p className="text-xs text-amber-200">{fileProblem}</p>}
              </div>
            )}
            {tab === "paste" && (
              <textarea className={`${inputCls} resize-y`} rows={8} aria-label="Text to import" value={text} onChange={(e) => setText(e.target.value)} />
            )}
            {tab === "notion" && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input className={inputCls} aria-label="Search Notion" placeholder="Search your Notion pages" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void searchNotion(); } }} />
                  <button type="button" onClick={() => void searchNotion()} disabled={busy} className="flex shrink-0 items-center gap-1.5 rounded-xl border border-white/15 px-3 text-sm hover:bg-white/10 disabled:opacity-40"><Search className="h-4 w-4" /> Search</button>
                </div>
                {pages && pages.length === 0 && <p className="text-xs text-zinc-500">No pages found. Make sure the page is shared with NazAI's Notion connection.</p>}
                {pages && pages.length > 0 && (
                  <ul className="max-h-56 space-y-1.5 overflow-y-auto" data-testid="notion-pages">
                    {pages.map((p) => (
                      <li key={p.id}>
                        <button type="button" disabled={busy} onClick={() => void finish("import_notion", { page_id: p.id })} className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-sm hover:border-amber-300/40 hover:bg-amber-400/[0.06] disabled:opacity-40">
                          <span className="truncate">{p.icon ? `${p.icon} ` : ""}{p.title}</span>
                          <span className="shrink-0 text-[11px] text-zinc-500">edited {p.last_edited.slice(0, 10)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[11px] text-zinc-500">Stays linked to the original: you can refresh it later. NazAI only edits the original if you turn that on.</p>
              </div>
            )}

            {tab !== "notion" && (
              <input className={inputCls} aria-label="Project name" placeholder="Name (optional: taken from the title, the file or the first line)" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            )}
            {problem && <p className="rounded-xl border border-amber-400/30 bg-amber-400/[0.07] px-3 py-2 text-xs text-amber-100" data-testid="import-problem">{problem}</p>}
            {tab !== "notion" && (
              <button type="button" disabled={busy || (tab === "link" ? !url.trim() : tab === "upload" ? files.length === 0 : !text.trim())} data-testid="import-submit"
                onClick={() => void (tab === "link" ? finish("import_link", { url: url.trim() }) : tab === "upload" ? finish("import_files", { files }) : finish("import_paste", { text }))}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-300/50 bg-gradient-to-r from-amber-400/25 via-amber-300/15 to-cyan-400/20 px-3 py-2.5 text-sm font-semibold text-amber-50 shadow-[0_0_28px_-8px_rgba(212,175,55,0.8)] transition hover:from-amber-400/35 disabled:border-white/10 disabled:from-white/[0.04] disabled:via-white/[0.04] disabled:to-white/[0.04] disabled:text-zinc-500 disabled:shadow-none">
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing…</> : "Import"}
              </button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
