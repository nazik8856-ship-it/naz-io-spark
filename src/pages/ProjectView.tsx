// One imported project: who it is (name, source, control status), its content (read-only, never rendered as a page), its control
// panel (its own rules, what the last check found, write-back for a linked project) and what to do with it (start an Outer Control
// task with it, refresh a linked one from its source, archive or delete it) and its history. The text is read through the server
// (it is stored encrypted); a team member who is not an owner sees everything but can change nothing ("View only").
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Copy, Download, FolderKanban, History, Loader2, Lock, Play, Plus, RefreshCw, ShieldCheck, Trash2, Archive, PenLine, Fingerprint } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { announceProjectsChanged, useProjectList } from "@/hooks/useProjectList";
import { ago, callProjects, eventText, hiddenNotice, PROJECT_COLS, shortDate, type ImportedProject, type ProjectCheck, type ProjectEvent, type ProjectRule } from "@/lib/projects";
import { hasPermission } from "@/lib/account-switcher";
import { useAuth } from "@/hooks/useAuth";
import { ControlBadge, ProtectedBadge, SourceBadge, ViewOnlyBadge } from "@/components/projects/ProjectBadges";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

const card = "rounded-2xl border border-white/10 bg-gradient-to-b from-[#0b1a35]/60 to-[#070f22]/60 p-4 sm:p-5";
const title = "flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-amber-200/80";
const inputCls = "w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-300/60";
const ACTION_WORD: Record<string, string> = { remove_text: "removed before tools receive it", block: "blocks", approval: "needs approval" };
type TaskRow = { id: string; objective: string; status: string; started_at: string };

export default function ProjectView() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { accountId, role, permissions } = useActiveAccount();
  const { user } = useAuth();
  // Owners change a project; every other team member can only look at it.
  const canEdit = hasPermission(role, permissions, "integrations");
  const { count, loading: listLoading } = useProjectList();
  const [p, setP] = useState<ImportedProject | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [contentProblem, setContentProblem] = useState<string | null>(null);
  const [events, setEvents] = useState<ProjectEvent[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteName, setDeleteName] = useState("");
  const [rules, setRules] = useState<ProjectRule[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [rule, setRule] = useState({ name: "", words: "", action: "remove" });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [writeText, setWriteText] = useState("");

  const load = useCallback(async () => {
    if (!accountId) return;
    const [pr, ru, ta, ev, text] = await Promise.all([
      anyDb.from("imported_projects").select(PROJECT_COLS).eq("id", id).eq("user_id", accountId).maybeSingle(),
      anyDb.from("project_rules").select("id, name, pattern, severity, redact, enabled, created_at").eq("project_id", id).order("created_at"),
      anyDb.from("outer_control_workflows").select("id, objective, status, started_at").eq("user_id", accountId).eq("project_id", id).order("started_at", { ascending: false }).limit(5),
      anyDb.from("project_events").select("id, project_id, project_name, actor_id, action, detail, created_at").eq("project_id", id).order("created_at", { ascending: false }).limit(20),
      // The text is stored encrypted: only the server can read it.
      callProjects("read", { project_id: id, account_id: accountId }),
    ]);
    setP((pr?.data as ImportedProject | null) ?? null);
    setRules((ru?.data as ProjectRule[]) ?? []);
    setTasks(ta?.error ? [] : ((ta?.data as TaskRow[]) ?? []));
    setEvents(ev?.error ? [] : ((ev?.data as ProjectEvent[]) ?? []));
    setContent(text.ok ? String(text.data.content ?? "") : null);
    setContentProblem(text.ok ? null : text.message || "The text could not be read.");
    setLoading(false);
  }, [accountId, id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (p) document.title = `${p.name} · NazAI`; }, [p]);
  // "Add a rule" from the import confirmation opens straight on the rules.
  useEffect(() => { if (!loading && window.location.hash === "#rules") document.getElementById("rules")?.scrollIntoView({ behavior: "smooth" }); }, [loading]);
  // An archived or missing project: back to the list, or to the dashboard when there is no project left.
  useEffect(() => {
    if (loading || listLoading) return;
    if (!p || p.archived_at) navigate(count > 0 ? "/projects" : "/dashboard", { replace: true });
  }, [loading, listLoading, p, count, navigate]);

  const run = async (key: string, action: string, payload: Record<string, unknown>, okMsg?: string) => {
    setBusy(key);
    const r = await callProjects(action, { project_id: id, account_id: accountId, ...payload });
    setBusy(null);
    if (!r.ok) { toast.error(r.message || "That did not work."); return null; }
    if (okMsg) toast.success(okMsg);
    await load();
    return r.data;
  };

  if (loading || !p) return <div className="flex min-h-screen items-center justify-center" style={{ backgroundColor: "#020617" }}><Loader2 className="h-6 w-6 animate-spin text-amber-300" /></div>;

  const check: ProjectCheck | null = p.last_check;
  const linked = p.source_mode === "linked";
  const hidden = hiddenNotice(check);
  const injection = check?.injection ?? null;
  const copy = async () => { try { await navigator.clipboard.writeText(content ?? ""); toast.success("Content copied."); } catch { toast.error("Could not copy."); } };
  const download = () => {
    const ext = p.content_type === "markdown" ? "md" : p.content_type === "html" ? "html.txt" : "txt";
    const url = URL.createObjectURL(new Blob([content ?? ""], { type: "text/plain" }));
    const a = document.createElement("a"); a.href = url; a.download = `${p.name.replace(/[^\w.-]+/g, "-").slice(0, 60)}.${ext}`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen w-full text-white" style={{ backgroundColor: "#020617" }}>
      <header className="flex flex-wrap items-center gap-3 border-b border-white/5 px-4 py-4 sm:px-6">
        <button onClick={() => navigate("/projects")} className="flex items-center gap-2 text-zinc-400 transition-colors hover:text-white" aria-label="Back to projects">
          <ArrowLeft className="h-5 w-5" /><span className="font-mono text-sm uppercase tracking-wider">Projects</span>
        </button>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6">
        {/* Identity: always visible */}
        <section className={`${card} relative overflow-hidden`} data-testid="project-identity">
          <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-amber-400/15 blur-[80px]" aria-hidden />
          <div className="relative flex flex-wrap items-start gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-amber-300/40 bg-amber-400/15 shadow-[0_0_24px_-4px_rgba(212,175,55,0.6)]"><FolderKanban className="h-5 w-5 text-amber-200" /></span>
            <div className="min-w-0 flex-1">
              {renaming === null ? (
                <h1 className="flex items-center gap-2 text-xl font-semibold sm:text-2xl" data-testid="project-title">
                  <span className="truncate">{p.name}</span>
                  {canEdit && <button type="button" onClick={() => setRenaming(p.name)} aria-label="Rename" className="text-zinc-500 hover:text-zinc-200"><PenLine className="h-4 w-4" /></button>}
                </h1>
              ) : (
                <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (await run("rename", "rename", { name: renaming })) { setRenaming(null); announceProjectsChanged(); } }}>
                  <input className={inputCls} aria-label="Project name" value={renaming} maxLength={120} onChange={(e) => setRenaming(e.target.value)} autoFocus />
                  <button className="rounded-xl border border-amber-300/50 px-3 text-sm" type="submit">Save</button>
                  <button className="rounded-xl border border-white/15 px-3 text-sm" type="button" onClick={() => setRenaming(null)}>Cancel</button>
                </form>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <SourceBadge project={p} withDetail />
                <ProtectedBadge project={p} />
                {!canEdit && <ViewOnlyBadge />}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                <ControlBadge project={p} />
                <span>Imported {shortDate(p.created_at)}</span>
                {linked && <span>Last synced {ago(p.last_synced_at)}</span>}
                <span className="flex items-center gap-1"><Fingerprint className="h-3 w-3" /> {p.content_sha256.slice(0, 12)}</span>
                {hidden && <span className="flex items-center gap-1 text-amber-100/90" title={hidden.detail} data-testid="project-hidden"><Lock className="h-3 w-3" /> {hidden.text}</span>}
              </div>
            </div>
          </div>
        </section>

        {injection && (
          <section className="rounded-2xl border border-amber-400/40 bg-amber-400/[0.07] p-4 text-sm oc-in" data-testid="project-injection">
            <p className="flex items-center gap-2 font-semibold text-amber-100"><AlertTriangle className="h-4 w-4 text-amber-300" /> This project contains text that tries to instruct an AI</p>
            <p className="mt-1 text-xs text-zinc-300">NazAI keeps the text as it is but never treats it as instructions: tools receive the project as reference material only, marked as such.</p>
            <ul className="mt-2 space-y-1 text-xs text-amber-50/90">
              {injection.signals.map((s, i) => <li key={i}>• {s.label}{s.sample ? <span className="text-zinc-400"> — “{s.sample}”</span> : null}</li>)}
            </ul>
          </section>
        )}

        {/* Actions */}
        <section className="flex flex-wrap gap-2" data-testid="project-actions">
          <button type="button" onClick={() => navigate(`/control-system/outer?project=${p.id}`)} className="flex items-center gap-1.5 rounded-xl border border-cyan-400/50 bg-gradient-to-r from-cyan-500/25 to-amber-300/15 px-4 py-2 text-sm font-semibold text-cyan-50 shadow-[0_0_24px_-8px_rgba(34,211,238,0.8)] hover:from-cyan-400/35" data-testid="project-start-task">
            <Play className="h-4 w-4" /> Start a task with this project
          </button>
          {linked && canEdit && (
            <button type="button" disabled={busy === "refresh"} onClick={async () => { const d = await run("refresh", "refresh", {}); if (d) toast.success(d.changed ? "Updated from the original." : "No changes in the original."); }} className="flex items-center gap-1.5 rounded-xl border border-white/15 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50" data-testid="project-refresh">
              <RefreshCw className={`h-4 w-4 ${busy === "refresh" ? "animate-spin" : ""}`} /> Refresh from source
            </button>
          )}
          {canEdit && (
            <>
              <button type="button" onClick={async () => { if (await run("archive", "archive", {}, "Archived. It is hidden, not deleted.")) announceProjectsChanged(); }} className="ml-auto flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-sm text-zinc-400 hover:bg-white/10 hover:text-zinc-200" data-testid="project-archive">
                <Archive className="h-4 w-4" /> Archive
              </button>
              <button type="button" onClick={() => setDeleteOpen(true)} className="flex items-center gap-1.5 rounded-xl border border-rose-400/30 px-3 py-2 text-sm text-rose-200/80 hover:bg-rose-500/10 hover:text-rose-100" data-testid="project-delete">
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            </>
          )}
        </section>

        <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
          {/* Content */}
          <section className={card} data-testid="project-content">
            <div className="flex items-center justify-between gap-2">
              <h2 className={title}>Content</h2>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => void copy()} className="flex items-center gap-1 rounded border border-white/15 px-2 py-0.5 font-mono text-[10px] uppercase text-zinc-300 hover:bg-white/10"><Copy className="h-3 w-3" /> Copy</button>
                <button type="button" onClick={download} className="flex items-center gap-1 rounded border border-white/15 px-2 py-0.5 font-mono text-[10px] uppercase text-zinc-300 hover:bg-white/10"><Download className="h-3 w-3" /> Download</button>
              </div>
            </div>
            {p.files.length > 1 && <p className="mt-2 text-xs text-zinc-400" data-testid="project-files">{p.files.length} files: {p.files.map((f) => f.name).join(", ")}</p>}
            {/* Shown as text, never rendered: an imported page can not run anything here. */}
            {content === null
              ? <p className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-3 text-sm text-amber-100" data-testid="project-text-problem">{contentProblem}</p>
              : <pre className={`mt-3 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/40 p-3 text-[13px] leading-relaxed text-zinc-200 ${p.content_type === "code" ? "font-mono" : "font-sans"}`} data-testid="project-text">{content}</pre>}
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-500">{(content ?? "").length.toLocaleString("en")} characters{check?.protected && <><span aria-hidden>·</span><Lock className="h-3 w-3" /> stored encrypted</>}</p>
          </section>

          {/* Control panel */}
          <section className={`${card} space-y-4`} id="rules" data-testid="project-control">
            <h2 className={title}><ShieldCheck className="h-3.5 w-3.5" /> Control</h2>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs" data-testid="project-check">
              {check ? (check.matches.length === 0
                ? <p className="text-emerald-200">Checked against {check.rules} rules: no matches.</p>
                : <ul className="space-y-1 text-amber-100">{check.matches.map((m) => <li key={m.name}>{m.name}: {ACTION_WORD[m.action]}</li>)}</ul>)
                : <p className="text-zinc-400">Not checked yet.</p>}
              <p className="mt-1 text-zinc-500">Your account's rules always apply. The rules below apply to this project only.</p>
            </div>

            <div>
              <p className="text-xs font-medium text-zinc-300">Rules for this project ({rules.length})</p>
              <ul className="mt-2 space-y-1.5" data-testid="project-rules">
                {rules.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs">
                    <span className="min-w-0"><span className="text-zinc-100">{r.name}</span> <span className="text-zinc-500">· {r.severity === "require_approval" ? "needs approval" : r.redact ? "removes the words" : "blocks the reply"}</span></span>
                    {canEdit && <button type="button" aria-label={`Remove rule ${r.name}`} onClick={() => void run(`rm-${r.id}`, "remove_rule", { rule_id: r.id }, "Rule removed.")} className="text-zinc-500 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" /></button>}
                  </li>
                ))}
              </ul>
              {canEdit && <form className="mt-2 space-y-2" onSubmit={async (e) => { e.preventDefault(); if (await run("rule", "add_rule", { name: rule.name, words: rule.words, rule_action: rule.action }, "Rule added. It applies to this project only.")) setRule({ name: "", words: "", action: "remove" }); }}>
                <input className={inputCls} aria-label="Rule name" placeholder="Rule name (e.g. Hide the codename)" value={rule.name} maxLength={120} onChange={(e) => setRule({ ...rule, name: e.target.value })} />
                <input className={inputCls} aria-label="Words to catch" placeholder="Words or phrases, separated by commas" value={rule.words} onChange={(e) => setRule({ ...rule, words: e.target.value })} />
                <select className={inputCls} aria-label="What the rule does" value={rule.action} onChange={(e) => setRule({ ...rule, action: e.target.value })}>
                  <option value="remove">Remove them from what tools receive and return</option>
                  <option value="block">Block a reply that contains them</option>
                  <option value="approval">Ask me to approve first</option>
                </select>
                <button type="submit" disabled={busy === "rule" || !rule.name.trim() || !rule.words.trim()} className="flex w-full items-center justify-center gap-1 rounded-xl border border-amber-300/50 bg-amber-400/15 px-3 py-2 text-sm text-amber-50 disabled:opacity-40" data-testid="project-add-rule"><Plus className="h-4 w-4" /> Add rule</button>
              </form>}
            </div>

            {linked ? (
              <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs" data-testid="project-write-back">
                <label className="flex items-center justify-between gap-3">
                  <span><span className="text-sm text-zinc-100">Allow NazAI to edit the original</span><br /><span className="text-zinc-500">Off: NazAI never changes the Notion page. On: every write still waits for your approval, and only adds to the end.</span></span>
                  <input type="checkbox" role="switch" aria-label="Allow NazAI to edit the original" checked={p.write_back} disabled={!canEdit}
                    onChange={() => (p.write_back ? void run("wb", "set_write_back", { enabled: false }, "Write-back is off.") : setConfirmOpen(true))} className="h-5 w-5 accent-amber-400" />
                </label>
                {p.write_back && canEdit && (
                  <div className="mt-3 space-y-2">
                    <textarea className={inputCls} rows={3} aria-label="Text to add to the original" placeholder="Text to add at the end of the original page" value={writeText} onChange={(e) => setWriteText(e.target.value)} />
                    <button type="button" disabled={!writeText.trim() || busy === "write"} onClick={async () => { if (await run("write", "write_back", { text: writeText }, "Waiting for your approval in Approvals. Nothing is written before that.")) setWriteText(""); }} className="rounded-xl border border-amber-300/50 bg-amber-400/15 px-3 py-1.5 text-sm text-amber-50 disabled:opacity-40" data-testid="project-write">Write to the original</button>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-zinc-500" data-testid="project-no-write-back">A snapshot is a copy: NazAI never writes to the original.</p>
            )}

            {tasks.length > 0 && (
              <div data-testid="project-tasks">
                <p className="text-xs font-medium text-zinc-300">Tasks with this project</p>
                <ul className="mt-1 space-y-1 text-xs text-zinc-400">{tasks.map((t) => <li key={t.id} className="truncate">{t.status === "completed" ? "✓" : "•"} {t.objective}</li>)}</ul>
              </div>
            )}
          </section>
        </div>

        {/* History: who did what, newest first */}
        <section className={card} data-testid="project-history">
          <h2 className={title}><History className="h-3.5 w-3.5" /> History</h2>
          {events.length === 0
            ? <p className="mt-2 text-xs text-zinc-500">Nothing recorded yet. Imports, rule changes and write-backs appear here.</p>
            : (
              <ol className="mt-3 space-y-2 border-l border-amber-300/20 pl-4">
                {events.map((e) => (
                  <li key={e.id} className="relative text-xs" data-testid="project-event">
                    <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-amber-300/80 shadow-[0_0_8px_rgba(212,175,55,0.8)]" aria-hidden />
                    <span className="text-zinc-100">{eventText(e)}</span>
                    <span className="text-zinc-500"> · {e.actor_id && e.actor_id === user?.id ? "You" : "A team member"} · {shortDate(e.created_at)} {ago(e.created_at)}</span>
                  </li>
                ))}
              </ol>
            )}
        </section>
      </main>

      <Dialog open={confirmOpen} onOpenChange={(o) => { setConfirmOpen(o); if (!o) setConfirmName(""); }}>
        <DialogContent className="border-amber-300/30 bg-[#040915] text-zinc-100 sm:max-w-md" data-testid="write-back-confirm">
          <DialogHeader>
            <DialogTitle>Allow NazAI to edit the original?</DialogTitle>
            <DialogDescription className="text-zinc-400">NazAI will be able to add text to the end of the original Notion page. Every write first waits for your approval in Approvals. Type the project's name to turn this on.</DialogDescription>
          </DialogHeader>
          <input className={inputCls} aria-label="Type the project name" placeholder={p.name} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
          <button type="button" disabled={confirmName.trim() !== p.name || busy === "wb"} onClick={async () => { if (await run("wb", "set_write_back", { enabled: true, confirm_name: confirmName.trim() }, "Write-back is on. Every write waits for your approval.")) { setConfirmOpen(false); setConfirmName(""); } }}
            className="rounded-xl border border-amber-300/50 bg-amber-400/20 px-3 py-2 text-sm font-semibold text-amber-50 disabled:opacity-40" data-testid="write-back-enable">Turn on write-back</button>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={(o) => { setDeleteOpen(o); if (!o) setDeleteName(""); }}>
        <DialogContent className="border-rose-400/30 bg-[#040915] text-zinc-100 sm:max-w-md" data-testid="delete-confirm">
          <DialogHeader>
            <DialogTitle>Delete this project permanently?</DialogTitle>
            <DialogDescription className="text-zinc-400">Its text and its rules are erased from NazAI and can not be brought back. A write-back still waiting for approval is cancelled. The original (Notion page, link or files) is not touched. To keep it but hide it, use Archive instead. Type the project's name to delete it.</DialogDescription>
          </DialogHeader>
          <input className={inputCls} aria-label="Type the project name to delete it" placeholder={p.name} value={deleteName} onChange={(e) => setDeleteName(e.target.value)} />
          <button type="button" disabled={deleteName.trim() !== p.name || busy === "delete"}
            onClick={async () => {
              setBusy("delete");
              const r = await callProjects("delete", { project_id: id, account_id: accountId, confirm_name: deleteName.trim() });
              setBusy(null);
              if (!r.ok) { toast.error(r.message || "The project could not be deleted."); return; }
              toast.success("Deleted permanently.");
              setDeleteOpen(false);
              announceProjectsChanged();
              navigate(count > 1 ? "/projects" : "/dashboard", { replace: true });
            }}
            className="rounded-xl border border-rose-400/50 bg-rose-500/20 px-3 py-2 text-sm font-semibold text-rose-50 disabled:opacity-40" data-testid="delete-confirm-button">Delete permanently</button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
