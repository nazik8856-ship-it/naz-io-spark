// Clean it (Context Day 1): Outer Control's first screen. Paste text from ChatGPT, Claude, Gemini or any AI; NazAI applies the
// account's rules and the person's own context and returns ONE result: the text to copy, what was found and what changed.
// Same look as Start a task (glows, the oc-box input with its scan line while working, the cyan-to-gold button).
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, BookUser, Check, ClipboardCopy, Plus, ShieldCheck, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useProjectList, announceProjectsChanged } from "@/hooks/useProjectList";
import { callProjects } from "@/lib/projects";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  allowanceLine, cleanContext, CLEAN_SOURCES, CONTEXT_NAME, CONTEXT_SOURCES_HELP, MAX_CLEAN_CHARS, rememberContext, rememberedContext,
  STARTER_RULES, STATUS_TITLE, trackClean, type CleanResult, type CleanSource,
} from "@/lib/context-clean";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any; // meaning_rules is not in the generated types

const STATUS_STYLE: Record<CleanResult["status"], string> = {
  clean: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  changed: "border-cyan-400/40 bg-cyan-400/10 text-cyan-100",
  flagged: "border-amber-400/40 bg-amber-400/10 text-amber-100",
  held: "border-amber-400/40 bg-amber-400/10 text-amber-100",
  blocked: "border-rose-400/40 bg-rose-400/10 text-rose-100",
};

export default function CleanItPanel({ accountId }: { accountId: string | null }) {
  const navigate = useNavigate();
  const projectList = useProjectList();
  const projects = useMemo(() => projectList.items.filter((p) => p.kind === "imported").map((p) => ({ id: p.id, name: p.name })), [projectList.items]);
  const [content, setContent] = useState("");
  const [source, setSource] = useState<CleanSource>("chatgpt");
  const [contextId, setContextId] = useState<string | null>(null);
  const [contextPicked, setContextPicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CleanResult | null>(null);
  const [problem, setProblem] = useState<{ message: string; limit: boolean } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [rules, setRules] = useState<{ total: number; names: string[] } | null>(null);
  const [starterHidden, setStarterHidden] = useState(false);
  const [addingStarter, setAddingStarter] = useState(false);

  // The context used last time on this device (or the project named "My AI context"), once the projects are known.
  useEffect(() => {
    if (contextPicked || projectList.loading) return;
    setContextId(rememberedContext(accountId, projects.map((p) => p.id), Object.fromEntries(projects.map((p) => [p.id, p.name]))));
  }, [accountId, projects, projectList.loading, contextPicked]);

  const loadRules = async () => {
    if (!accountId) return;
    try {
      const [h, s, m] = await Promise.all([
        anyDb.from("hard_rules").select("id, enabled").eq("user_id", accountId),
        anyDb.from("safety_rules").select("id, enabled").eq("user_id", accountId),
        anyDb.from("meaning_rules").select("id, name, enabled").eq("user_id", accountId).is("project_id", null),
      ]);
      const on = (r: { data?: { enabled?: boolean }[] | null }) => (r?.data ?? []).filter((x) => x.enabled !== false).length;
      setRules({ total: on(h) + on(s) + on(m), names: (m?.data ?? []).map((x: { name?: string }) => String(x.name ?? "").trim().toLowerCase()) });
    } catch { /* the line under the box stays generic */ }
  };
  useEffect(() => { void loadRules(); }, [accountId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickContext = (id: string | null) => { setContextPicked(true); setContextId(id); rememberContext(accountId, id); };

  const clean = async () => {
    const text = content.trim();
    if (!text || busy) return;
    setBusy(true); setProblem(null); setResult(null);
    const out = await cleanContext({ content: text, source, projectId: contextId, accountId });
    setBusy(false);
    if ("message" in out) { setProblem({ message: out.message, limit: out.limit }); return; }
    setResult(out.result);
    trackClean("context_checked", {
      status: out.result.status, changed: out.result.status === "changed", rewrite: out.result.rewrite, source,
      with_context: !!out.result.context, found: out.result.found.length, edits: out.result.edits.length,
    });
  };

  const copy = async () => {
    if (!result?.text) return;
    try { await navigator.clipboard.writeText(result.text); toast.success("Copied"); } catch { toast.error("Copy did not work here. Select the text and copy it."); }
    trackClean("result_copied", { status: result.status, rewrite: result.rewrite });
  };

  // The starter rules this account does not have yet (by name): offered even when it has other rules in plain words.
  const missingStarter = rules ? STARTER_RULES.filter((r) => !rules.names.includes(r.name.toLowerCase())) : [];
  const addStarter = async () => {
    if (!accountId || !missingStarter.length) return;
    const adding = missingStarter;
    setAddingStarter(true);
    const { data, error } = await anyDb.from("meaning_rules")
      .insert(adding.map((r) => ({ user_id: accountId, project_id: null, name: r.name, description: r.description, action: r.action, enabled: true, shadow_mode: false })))
      .select("id");
    setAddingStarter(false);
    if (error || (data ?? []).length !== adding.length) { toast.error(error?.message || "The rules could not be added. You may not have permission to change rules on this account."); return; }
    toast.success(`${adding.length} rule${adding.length === 1 ? "" : "s"} added. They apply to every text you clean.`);
    trackClean("starter_rules_added", { count: adding.length });
    void loadRules();
  };

  const chars = content.trim().length;
  const tooLong = chars > MAX_CLEAN_CHARS;
  const contextName = projects.find((p) => p.id === contextId)?.name ?? null;
  const showStarter = missingStarter.length > 0 && !starterHidden;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#040915]/85 px-5 py-6 shadow-[0_0_80px_-30px_rgba(34,211,238,0.45)] sm:px-7" aria-label="Clean it" data-testid="clean-it">
      <div className="pointer-events-none absolute -left-24 -top-28 h-64 w-64 rounded-full bg-cyan-500/15 blur-[90px] oc-glow" aria-hidden />
      <div className="pointer-events-none absolute -right-24 top-24 h-56 w-56 rounded-full bg-amber-400/10 blur-[90px] oc-glow" aria-hidden />

      <div className="relative">
        <div className="flex items-center gap-3">
          <span className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-300/40 bg-gradient-to-br from-cyan-400/25 to-amber-300/10 shadow-[0_0_24px_-4px_rgba(34,211,238,0.6)]">
            <Wand2 className="h-4 w-4 text-cyan-200" />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-zinc-50">Clean it</h1>
            <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-cyan-300/70">NazAI Outer Control</p>
          </div>
        </div>
        <p className="mt-3 max-w-2xl text-sm text-zinc-400">
          Paste what ChatGPT, Claude or any AI wrote. NazAI applies your rules and your own context, fixes only what is wrong, checks it again, and gives you one clean result.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-1.5" role="group" aria-label="Where the text comes from">
          <span className="mr-1 text-xs text-zinc-500">From</span>
          {CLEAN_SOURCES.map((s) => (
            <button key={s.id} type="button" aria-pressed={source === s.id} onClick={() => setSource(s.id)} data-testid={`clean-source-${s.id}`}
              className={`rounded-full border px-3 py-1 text-xs transition ${source === s.id ? "border-cyan-300/60 bg-cyan-400/15 text-cyan-100" : "border-white/10 bg-white/[0.03] text-zinc-400 hover:text-zinc-200"}`}>
              {s.label}
            </button>
          ))}
        </div>

        <div className={`oc-box mt-3 rounded-2xl border bg-black/40 p-1 ${busy ? "oc-scan border-cyan-400/50" : "border-white/10"}`}>
          <textarea className="block min-h-[150px] w-full resize-y rounded-xl bg-transparent px-3 py-2.5 text-[15px] leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-600" rows={6}
            aria-label="Text to clean" placeholder="Paste the AI's answer here…" value={content} onChange={(e) => setContent(e.target.value)} data-testid="clean-input" />
          <div className="flex items-center justify-between gap-2 px-3 pb-1.5 font-mono text-[10px] uppercase tracking-[0.18em]">
            <span className={busy ? "text-cyan-300" : "text-zinc-600"}>{busy ? "Checking, fixing, checking again…" : "Saved encrypted in your history"}</span>
            <span className={tooLong ? "text-rose-300" : "text-zinc-600"}>{chars ? `${chars.toLocaleString("en")} / ${MAX_CLEAN_CHARS.toLocaleString("en")}` : ""}</span>
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
            <BookUser className="h-3.5 w-3.5 shrink-0 text-amber-200/80" />
            <label htmlFor="clean-context" className="shrink-0 text-xs text-zinc-400">Your context</label>
            <select id="clean-context" className="min-w-0 flex-1 truncate bg-transparent text-xs text-zinc-100 outline-none" value={contextId ?? ""} data-testid="clean-context"
              onChange={(e) => pickContext(e.target.value || null)}>
              <option value="" className="bg-[#040915]">None</option>
              {projects.map((p) => <option key={p.id} value={p.id} className="bg-[#040915]">{p.name}</option>)}
            </select>
            <button type="button" onClick={() => setAddOpen(true)} className="flex shrink-0 items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200" data-testid="clean-add-context">
              <Plus className="h-3 w-3" /> Add
            </button>
          </div>
          <button type="button" onClick={() => navigate("/control-system")} className="flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-left text-xs text-zinc-400 transition hover:border-white/20 hover:text-zinc-200" data-testid="clean-rules-line">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-300/80" />
            <span className="truncate" title="Your own rules, plus NazAI's built-in protection for secrets and personal data">{rules ? `${rules.total} of your rules` : "Your rules"} + built-in protection</span>
            <ArrowRight className="ml-auto h-3 w-3 shrink-0" />
          </button>
        </div>

        {showStarter && (
          <div className="oc-in mt-3 flex flex-col items-start gap-x-3 gap-y-2 rounded-xl border border-amber-300/25 sm:flex-row sm:items-center bg-gradient-to-r from-amber-400/[0.07] to-cyan-400/[0.04] px-3 py-2" data-testid="clean-starter">
            <span className="min-w-0 text-xs leading-relaxed text-zinc-300 sm:flex-1">
              <span className="font-medium text-amber-50">Suggested rules for AI output: </span>
              {missingStarter.map((r, i) => <span key={r.name} title={r.description}>{i ? " · " : ""}<span className="underline decoration-dotted decoration-zinc-600 underline-offset-2">{r.name}</span></span>)}
            </span>
            <span className="flex shrink-0 items-center gap-3">
              <button type="button" disabled={addingStarter} onClick={addStarter} data-testid="clean-starter-add" title="Saved as rules in plain words; edit or delete them any time in Inner Control"
                className="rounded-lg border border-amber-300/50 bg-amber-400/15 px-2.5 py-1 text-xs font-medium text-amber-50 hover:bg-amber-400/25 disabled:opacity-50">
                {addingStarter ? "Adding…" : missingStarter.length === 1 ? "Add this rule" : `Add these ${missingStarter.length}`}
              </button>
              <button type="button" onClick={() => setStarterHidden(true)} className="text-xs text-zinc-500 hover:text-zinc-300">Not now</button>
            </span>
          </div>
        )}

        <button type="button" disabled={busy || !chars || tooLong} onClick={() => void clean()} data-testid="clean-go"
          className="group relative mt-4 w-full overflow-hidden rounded-xl border border-cyan-300/50 bg-gradient-to-r from-cyan-500/30 via-cyan-400/20 to-amber-300/25 px-3 py-3 text-sm font-semibold text-cyan-50 shadow-[0_0_28px_-8px_rgba(34,211,238,0.8)] transition hover:from-cyan-400/40 hover:to-amber-300/35 disabled:border-white/10 disabled:from-white/[0.04] disabled:via-white/[0.04] disabled:to-white/[0.04] disabled:text-zinc-500 disabled:shadow-none">
          <span className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4" />{busy ? "Cleaning…" : contextName ? `Clean it with ${contextName}` : "Clean it"}</span>
        </button>
        {result?.allowance && <p className="mt-2 text-center text-[11px] text-zinc-500" data-testid="clean-allowance">{allowanceLine(result.allowance)}</p>}

        {problem && (
          <div role="alert" className={`oc-in mt-4 rounded-xl border px-4 py-3 text-sm ${problem.limit ? "border-amber-300/40 bg-amber-400/[0.08] text-amber-50" : "border-rose-400/30 bg-rose-400/[0.06] text-rose-100"}`} data-testid="clean-problem">
            {problem.message}
          </div>
        )}

        {result && <ResultCard result={result} onCopy={copy} />}
      </div>

      <AddContextDialog open={addOpen} onOpenChange={setAddOpen} accountId={accountId}
        onAdded={(id) => { pickContext(id); announceProjectsChanged(); }} />
    </section>
  );
}

function ResultCard({ result, onCopy }: { result: CleanResult; onCopy: () => void }) {
  return (
    <div className="oc-in mt-5 rounded-2xl border border-white/10 bg-black/30 p-4" aria-live="polite" data-testid="clean-result" data-status={result.status}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[result.status]}`} data-testid="clean-status">{STATUS_TITLE[result.status]}</span>
        {result.rewrite === "passed" && <span className="flex items-center gap-1 text-[11px] text-emerald-300/90"><Check className="h-3 w-3" /> Rewrite passed your rules</span>}
        {result.context && (
          <span className="text-[11px] text-zinc-500">{result.context.checked ? `Compared with "${result.context.name}"` : `"${result.context.name}" could not be compared right now`}</span>
        )}
      </div>
      <p className="mt-2 text-sm text-zinc-300" data-testid="clean-summary">{result.summary}</p>

      {result.text !== null && (
        <div className="mt-3 rounded-xl border border-cyan-400/20 bg-[#030814] p-3">
          <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-zinc-100" data-testid="clean-text">{result.text}</p>
          <div className="mt-2 flex justify-end">
            <button type="button" onClick={onCopy} data-testid="clean-copy"
              className="flex items-center gap-1.5 rounded-lg border border-cyan-300/40 bg-cyan-400/10 px-3 py-1.5 text-xs font-medium text-cyan-50 hover:bg-cyan-400/20">
              <ClipboardCopy className="h-3.5 w-3.5" /> Copy
            </button>
          </div>
        </div>
      )}

      {result.edits.length > 0 && (
        <div className="mt-4" data-testid="clean-edits">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">What changed</p>
          <ul className="mt-1.5 space-y-2">
            {result.edits.map((e, i) => (
              <li key={i} className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-sm">
                <span className="text-rose-200/80 line-through decoration-rose-300/50">{e.before}</span>
                {e.after ? <> <ArrowRight className="mx-1 inline h-3 w-3 text-zinc-500" /> <span className="text-emerald-200">{e.after}</span></> : <span className="ml-1 text-xs text-zinc-500">(removed)</span>}
                {e.why && <span className="mt-0.5 block text-xs text-zinc-500">{e.why}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.found.length > 0 && (
        <div className="mt-4" data-testid="clean-found">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">What the checks found</p>
          <ul className="mt-1.5 space-y-1.5 text-sm">
            {result.found.map((f, i) => (
              <li key={i} className="text-zinc-300">
                <span className={f.kind === "context" ? "text-amber-200" : "text-cyan-200"}>{f.name}</span>
                {f.quote && <> · <span className="text-zinc-100">"{f.quote}"</span></>}
                <span className="text-zinc-500"> — {f.why}</span>
                {f.context_quote && <span className="block text-xs text-zinc-500">Your context says: "{f.context_quote}"</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AddContextDialog({ open, onOpenChange, accountId, onAdded }: { open: boolean; onOpenChange: (o: boolean) => void; accountId: string | null; onAdded: (id: string) => void }) {
  const [name, setName] = useState(CONTEXT_NAME);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    if (!text.trim()) return;
    setBusy(true); setProblem(null);
    const r = await callProjects("import_paste", { text: text.trim(), name: name.trim() || CONTEXT_NAME, account_id: accountId });
    setBusy(false);
    const id = (r.data?.project as { id?: string } | undefined)?.id;
    if (!r.ok || !id) { setProblem(r.message || "Your context could not be saved."); return; }
    trackClean("context_added", { chars: text.trim().length });
    onAdded(id);
    setText(""); onOpenChange(false);
    toast.success("Your context is saved, encrypted. Clean it now uses it.");
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-amber-300/20 bg-[#040915] text-zinc-100 sm:max-w-xl" data-testid="clean-context-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg"><BookUser className="h-4 w-4 text-amber-200" /> Add your AI context</DialogTitle>
          <DialogDescription className="text-zinc-400">
            Paste what your AI already knows about you or your business: facts, prices, policies, how you write. Clean it keeps every result consistent with it. It is stored encrypted, and you can edit or delete it in Projects.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-1 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-zinc-400">
          {CONTEXT_SOURCES_HELP.map((h) => <li key={h.tool}><span className="text-zinc-200">{h.tool}:</span> {h.where}</li>)}
        </ul>
        <label className="block text-xs text-zinc-400" htmlFor="clean-context-name">Name</label>
        <input id="clean-context-name" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-cyan-400/50" />
        <div className="oc-box rounded-xl border border-white/10 bg-black/40 p-1">
          <textarea aria-label="Your context" rows={8} value={text} onChange={(e) => setText(e.target.value)} data-testid="clean-context-text"
            placeholder="e.g. We are a 5-person bakery in Leeds. Delivery is Tuesday and Friday only. Refunds within 14 days. We never use exclamation marks."
            className="block w-full resize-y rounded-lg bg-transparent px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600" />
        </div>
        {problem && <p role="alert" className="text-sm text-rose-200">{problem}</p>}
        <button type="button" disabled={busy || !text.trim()} onClick={() => void save()} data-testid="clean-context-save"
          className="w-full rounded-xl border border-amber-300/50 bg-gradient-to-r from-amber-400/25 to-cyan-400/15 px-3 py-2.5 text-sm font-semibold text-amber-50 disabled:opacity-40">
          {busy ? "Saving…" : "Save my context"}
        </button>
      </DialogContent>
    </Dialog>
  );
}
