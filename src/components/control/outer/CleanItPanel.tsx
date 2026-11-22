// Clean it (Context Day 1): Outer Control's first screen. Paste text from ChatGPT, Claude, Gemini or any AI; NazAI applies the
// account's rules and the person's own context and returns ONE result: the text to copy, what was found and what changed.
// Same look as Start a task (glows, the oc-box input, the cyan-to-gold button). The details that make it feel controlled
// (docs/clean-it.md, "Details"): the control pulse, the thin progress line and a precise timer while it works, the result's
// reveal with its seal, the rule application trail, the quiet confidence of a clean result, the context weight and the trust line.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, BookUser, Check, ClipboardCopy, Mail, PenLine, Plus, Send, ShieldCheck, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useProjectList, announceProjectsChanged } from "@/hooks/useProjectList";
import { callProjects } from "@/lib/projects";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  allowanceLine, blocksOf, cleanContext, CLEAN_FORMATS, CLEAN_SOURCES, composeContext, CONTEXT_NAME, CONTEXT_SECTIONS, CONTEXT_SOURCES_HELP,
  contextWeight, EMAIL_RE, isControlled, mailLinks, MAX_CLEAN_CHARS, parseContextSections, plural, rememberContext, rememberedContext,
  rememberedFormat, rememberFormat, secondsLabel, STARTER_RULES, STATUS_TITLE, structureContext, toHtml, toPlain, trackClean, trailOf,
  type CleanFormat, type CleanResult, type CleanSource, type SectionKey, type StructuredContext,
} from "@/lib/context-clean";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any; // meaning_rules is not in the generated types

/** The keyboard shortcut for Clean it, as this computer writes it. */
const SHORTCUT = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘ ↵" : "Ctrl ↵";

const STATUS_STYLE: Record<CleanResult["status"], string> = {
  clean: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  changed: "border-cyan-400/40 bg-cyan-400/10 text-cyan-100",
  flagged: "border-amber-400/40 bg-amber-400/10 text-amber-100",
  held: "border-amber-400/40 bg-amber-400/10 text-amber-100",
  blocked: "border-rose-400/40 bg-rose-400/10 text-rose-100",
};

export default function CleanItPanel({ accountId, onActivity }: { accountId: string | null; onActivity?: () => void }) {
  const navigate = useNavigate();
  const projectList = useProjectList();
  const projects = useMemo(() => projectList.items.filter((p) => p.kind === "imported").map((p) => ({ id: p.id, name: p.name })), [projectList.items]);
  const [content, setContent] = useState("");
  const [source, setSource] = useState<CleanSource>("chatgpt");
  const [format, setFormat] = useState<CleanFormat>(() => rememberedFormat());
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [contextId, setContextId] = useState<string | null>(null);
  const [contextPicked, setContextPicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CleanResult | null>(null);
  const [resultFor, setResultFor] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ message: string; limit: boolean } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [rules, setRules] = useState<{ total: number; names: string[] } | null>(null);
  const [starterHidden, setStarterHidden] = useState(false);
  const [addingStarter, setAddingStarter] = useState(false);
  const [weight, setWeight] = useState<{ used: number; total: number; limit: number } | null>(null);
  // Control pulse: a counter that replays the strong pulse (when Clean it is pressed and when the rules are applied).
  const [surge, setSurge] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [took, setTook] = useState<number | null>(null);

  const pulse = () => { setSurge((n) => n + 1); onActivity?.(); };

  // The context used last time on this device (or the project named "My AI context"), once the projects are known.
  useEffect(() => {
    if (contextPicked || projectList.loading) return;
    setContextId(rememberedContext(accountId, projects.map((p) => p.id), Object.fromEntries(projects.map((p) => [p.id, p.name]))));
  }, [accountId, projects, projectList.loading, contextPicked]);

  // Context weight: how much of the chosen context a clean reads (lengths only).
  useEffect(() => {
    setWeight(null);
    if (!contextId) return;
    let live = true;
    void contextWeight(contextId, accountId).then((w) => { if (live) setWeight(w); });
    return () => { live = false; };
  }, [contextId, accountId]);

  // A precise timer while it works (tenths of a second), instead of a spinner.
  useEffect(() => {
    if (!busy || startedAt === null) return;
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(t);
  }, [busy, startedAt]);

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
    if (!text || busy || text.length > MAX_CLEAN_CHARS) return;
    const t0 = Date.now();
    setBusy(true); setProblem(null); setResult(null); setTook(null); setStartedAt(t0); setNow(t0);
    pulse();
    const out = await cleanContext({ content: text, source, projectId: contextId, accountId, format });
    setBusy(false); setStartedAt(null); setTook(Date.now() - t0);
    if ("message" in out) { setProblem({ message: out.message, limit: out.limit }); return; }
    setResult(out.result); setResultFor(text);
    pulse();
    if (out.result.context?.used !== undefined) setWeight({ used: out.result.context.used, total: out.result.context.total ?? out.result.context.used, limit: weight?.limit ?? 6000 });
    trackClean("context_checked", {
      status: out.result.status, changed: out.result.status === "changed", rewrite: out.result.rewrite, source,
      with_context: !!out.result.context, found: out.result.found.length, edits: out.result.edits.length,
      format: out.result.format ?? "as_pasted", reshaped: (out.result.format ?? "as_pasted") === format,
    });
  };

  // Copy: plain text, or formatted (paragraphs, lists and bold kept, for email, Docs, Notion, Slack).
  const copy = async (mode: "plain" | "formatted"): Promise<boolean> => {
    if (!result?.text) return false;
    const plain = toPlain(result.text, result.email?.subject);
    let ok = true;
    try {
      const Item = (window as unknown as { ClipboardItem?: new (d: Record<string, Blob>) => unknown }).ClipboardItem;
      if (mode === "formatted" && Item && navigator.clipboard.write) {
        await navigator.clipboard.write([new Item({ "text/html": new Blob([toHtml(result.text, result.email?.subject)], { type: "text/html" }), "text/plain": new Blob([plain], { type: "text/plain" }) }) as ClipboardItem]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
    } catch { ok = false; toast.error("Copy did not work here. Select the text and copy it."); }
    trackClean("result_copied", { status: result.status, rewrite: result.rewrite, mode, format: result.format ?? "as_pasted" });
    return ok;
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
  // Quiet confidence: a fully clean result (no rule broken, nothing found) takes the focus while the text it came from is unchanged.
  const quiet = !!result && result.status === "clean" && result.found.length === 0 && content.trim() === resultFor;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#040915]/85 px-5 py-6 shadow-[0_0_80px_-30px_rgba(34,211,238,0.45)] sm:px-7" aria-label="Clean it" data-testid="clean-it">
      <div className="pointer-events-none absolute -left-24 -top-28 h-64 w-64 rounded-full bg-cyan-500/15 blur-[90px] oc-glow" aria-hidden />
      <div className="pointer-events-none absolute -right-24 top-24 h-56 w-56 rounded-full bg-amber-400/10 blur-[90px] oc-glow" aria-hidden />

      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-300/40 bg-gradient-to-br from-cyan-400/25 to-amber-300/10 shadow-[0_0_24px_-4px_rgba(34,211,238,0.6)]">
              <Wand2 className="h-4 w-4 text-cyan-200" />
            </span>
            <div>
              <h1 className="text-xl font-semibold text-zinc-50">Clean it</h1>
              <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-cyan-300/70">NazAI Outer Control</p>
            </div>
          </div>
          <ControlPulse surge={surge} working={busy} />
        </div>
        <p className="mt-3 max-w-2xl text-sm text-zinc-400">
          Paste what ChatGPT, Claude or any AI wrote. NazAI applies your rules and your own context, fixes only what is wrong, checks it again, and gives you one clean result.
        </p>

        <div className={`transition-[opacity,filter] duration-700 ${quiet ? "opacity-60 saturate-50 hover:opacity-100 hover:saturate-100 focus-within:opacity-100 focus-within:saturate-100" : ""}`} data-testid="clean-input-area" data-quiet={quiet ? "true" : "false"}>
          <div className="mt-5 flex flex-wrap items-center gap-1.5" role="group" aria-label="Where the text comes from">
            <span className="mr-1 text-xs text-zinc-500">From</span>
            {CLEAN_SOURCES.map((s) => (
              <button key={s.id} type="button" aria-pressed={source === s.id} onClick={() => setSource(s.id)} data-testid={`clean-source-${s.id}`}
                className={`rounded-full border px-3 py-1 text-xs transition ${source === s.id ? "border-cyan-300/60 bg-cyan-400/15 text-cyan-100" : "border-white/10 bg-white/[0.03] text-zinc-400 hover:text-zinc-200"}`}>
                {s.label}
              </button>
            ))}
            <span className="mx-2 hidden h-4 w-px bg-white/10 sm:inline-block" aria-hidden />
            <span className="mr-1 basis-full text-xs text-zinc-500 sm:basis-auto">Shape</span>
            {CLEAN_FORMATS.map((f) => (
              <button key={f.id} type="button" aria-pressed={format === f.id} onClick={() => { setFormat(f.id); rememberFormat(f.id); }} data-testid={`clean-format-${f.id}`}
                className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition ${format === f.id ? "border-amber-300/60 bg-amber-400/15 text-amber-50" : "border-white/10 bg-white/[0.03] text-zinc-400 hover:text-zinc-200"}`}>
                {f.id === "email" && <Mail className="h-3 w-3" />}{f.label}
              </button>
            ))}
          </div>

          <div className={`oc-box relative mt-3 overflow-hidden rounded-2xl border bg-black/40 p-1 ${busy ? "border-cyan-400/50" : "border-white/10"}`}>
            {busy && <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] overflow-hidden" aria-hidden data-testid="clean-progress"><span className="nz-line" /></span>}
            <textarea className="block min-h-[150px] w-full resize-y rounded-xl bg-transparent px-3 py-2.5 text-[15px] leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-600" rows={6}
              aria-label="Text to clean" placeholder="Paste the AI's answer here…" value={content} onChange={(e) => setContent(e.target.value)} data-testid="clean-input"
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void clean(); } }} />
            <div className="flex items-center justify-between gap-2 px-3 pb-1.5 font-mono text-[10px] uppercase tracking-[0.18em]">
              <span className={busy ? "text-cyan-300" : "text-zinc-600"}>{busy ? "Checking, fixing, checking again…" : "Saved encrypted in your history"}</span>
              <span className={tooLong ? "text-rose-300" : "text-zinc-600"}>{chars ? `${chars.toLocaleString("en")} / ${MAX_CLEAN_CHARS.toLocaleString("en")}` : ""}</span>
            </div>
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
            {contextId && <ContextWeight weight={weight} />}
            {contextId && (
              <button type="button" aria-label="Edit your context" title="Edit your context" data-testid="clean-edit-context"
                onClick={() => { setEditing({ id: contextId, name: contextName ?? CONTEXT_NAME }); setAddOpen(true); }}
                className="shrink-0 text-zinc-500 hover:text-cyan-200"><PenLine className="h-3.5 w-3.5" /></button>
            )}
            <button type="button" onClick={() => { setEditing(null); setAddOpen(true); }} className="flex shrink-0 items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200" data-testid="clean-add-context">
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

        <button type="button" disabled={busy || !chars || tooLong} onClick={() => void clean()} data-testid="clean-go" aria-busy={busy}
          className="group relative mt-4 w-full overflow-hidden rounded-xl border border-cyan-300/50 bg-gradient-to-r from-cyan-500/30 via-cyan-400/20 to-amber-300/25 px-3 py-3 text-sm font-semibold text-cyan-50 shadow-[0_0_28px_-8px_rgba(34,211,238,0.8)] transition hover:from-cyan-400/40 hover:to-amber-300/35 disabled:border-white/10 disabled:from-white/[0.04] disabled:via-white/[0.04] disabled:to-white/[0.04] disabled:text-zinc-500 disabled:shadow-none aria-busy:border-cyan-300/50 aria-busy:text-cyan-100">
          {busy ? (
            <span className="inline-flex items-center gap-2" data-testid="clean-working">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 nz-pulse" aria-hidden />
              Applying your rules
              <span className="font-mono text-xs tabular-nums text-cyan-200/80" data-testid="clean-timer">{secondsLabel(now - (startedAt ?? now))}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4" />{contextName ? `Clean it with ${contextName}` : "Clean it"}</span>
          )}
          {!busy && <span className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 font-mono text-[10px] text-cyan-100/40 sm:inline" aria-hidden>{SHORTCUT}</span>}
          {busy && <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px overflow-hidden" aria-hidden><span className="nz-line" style={{ height: "1px" }} /></span>}
        </button>
        {result?.allowance && <p className="mt-2 text-center text-[11px] text-zinc-500" data-testid="clean-allowance">{allowanceLine(result.allowance)}</p>}

        {problem && (
          <div role="alert" className={`oc-in mt-4 rounded-xl border px-4 py-3 text-sm ${problem.limit ? "border-amber-300/40 bg-amber-400/[0.08] text-amber-50" : "border-rose-400/30 bg-rose-400/[0.06] text-rose-100"}`} data-testid="clean-problem">
            {problem.message}
          </div>
        )}

        {result && <ResultCard result={result} onCopy={copy} elevated={quiet} took={took} />}
      </div>

      <AddContextDialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) setEditing(null); }} accountId={accountId} editing={editing}
        onAdded={(id) => { pickContext(id); announceProjectsChanged(); }} />
    </section>
  );
}

/** "Outer Control is active", with a soft cyan pulse that becomes stronger for about 1.5 s when the rules are being applied. */
function ControlPulse({ surge, working }: { surge: number; working: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/[0.05] px-2.5 py-1 text-[11px] text-cyan-100/80" data-testid="control-pulse" data-working={working ? "true" : "false"}>
      <span className="relative flex h-2 w-2">
        <span className="absolute inset-0 rounded-full bg-cyan-300 nz-pulse" />
        {surge > 0 && <span key={surge} className="absolute inset-0 rounded-full nz-pulse-strong" data-testid="control-pulse-surge" />}
      </span>
      <span className="hidden sm:inline">Outer Control is active</span>
    </span>
  );
}

/** How much of the context a clean reads: five thin marks, filled in proportion (up to the characters it reads). */
function ContextWeight({ weight }: { weight: { used: number; total: number; limit: number } | null }) {
  const ratio = weight && weight.limit ? Math.min(1, weight.used / weight.limit) : 0;
  const filled = weight && weight.used > 0 ? Math.max(1, Math.ceil(ratio * 5)) : 0;
  const label = !weight
    ? "Reading your context…"
    : weight.total > weight.used
      ? `Reads the first ${weight.used.toLocaleString("en")} of ${weight.total.toLocaleString("en")} characters of your context`
      : `Reads all ${weight.used.toLocaleString("en")} characters of your context (up to ${weight.limit.toLocaleString("en")})`;
  return (
    <span className="flex shrink-0 items-end gap-[3px]" title={label} aria-label={label} role="img" data-testid="context-weight" data-filled={filled}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={`w-[3px] rounded-full transition-all duration-500 ${i < filled ? "bg-gradient-to-t from-cyan-400/60 to-amber-200/80 shadow-[0_0_6px_rgba(34,211,238,0.5)]" : "bg-white/10"}`}
          style={{ height: `${5 + i * 2}px` }} />
      ))}
    </span>
  );
}

const TRAIL_STYLE = {
  rules: { text: "text-cyan-200", marker: "rgba(34, 211, 238, 0.32)" },
  fixes: { text: "text-emerald-200", marker: "rgba(52, 211, 153, 0.32)" },
  blocked: { text: "text-amber-200", marker: "rgba(251, 191, 36, 0.32)" },
  stopped: { text: "text-rose-200", marker: "rgba(251, 113, 133, 0.32)" },
} as const;

function ResultCard({ result, onCopy, elevated, took }: { result: CleanResult; onCopy: (mode: "plain" | "formatted") => Promise<boolean>; elevated: boolean; took: number | null }) {
  const trail = trailOf(result);
  const controlled = isControlled(result);
  const [hoverEdit, setHoverEdit] = useState<number | null>(null);
  const [copied, setCopied] = useState<"plain" | "formatted" | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [focus, setFocus] = useState<{ key: string; n: number } | null>(null);
  const rulesRef = useRef<HTMLDivElement>(null);
  const editsRef = useRef<HTMLDivElement>(null);
  const foundRef = useRef<HTMLDivElement>(null);

  const go = (key: "rules" | "fixes" | "blocked") => {
    const target = key === "fixes" ? (editsRef.current ?? foundRef.current) : (foundRef.current ?? rulesRef.current);
    target?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    setFocus({ key: key === "fixes" && editsRef.current ? "edits" : foundRef.current ? "found" : "summary", n: Date.now() });
  };
  const ring = (key: string) => focus?.key === key ? "nz-focus" : "";
  const blockedStyle = result.status === "blocked" ? TRAIL_STYLE.stopped : TRAIL_STYLE.blocked;
  const copyNow = async (mode: "plain" | "formatted") => { if (await onCopy(mode)) { setCopied(mode); window.setTimeout(() => setCopied(null), 1600); } };
  const shaped = (result.format ?? "as_pasted") !== "as_pasted";

  // Hovering a change marks its new words in the result.
  const after = hoverEdit !== null ? result.edits[hoverEdit]?.after?.trim() : "";
  const at = after && result.text ? result.text.indexOf(after) : -1;
  const text: ReactNode = result.text !== null && at >= 0
    ? <>{result.text.slice(0, at)}<mark className="rounded bg-emerald-400/20 px-0.5 text-emerald-50 transition-colors">{after}</mark>{result.text.slice(at + after.length)}</>
    : result.text;

  return (
    <div className={`nz-reveal mt-5 rounded-2xl border p-4 transition-all duration-700 ${elevated ? "-translate-y-0.5 border-cyan-300/30 bg-[#05101f] shadow-[0_28px_70px_-30px_rgba(34,211,238,0.6)]" : "border-white/10 bg-black/30"}`}
      aria-live="polite" data-testid="clean-result" data-status={result.status} data-elevated={elevated ? "true" : "false"}>
      <div ref={rulesRef} className={`flex flex-wrap items-center gap-2 rounded-lg ${ring("summary")}`}>
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[result.status]}`} data-testid="clean-status">{STATUS_TITLE[result.status]}</span>
        {result.rewrite === "passed" && <span className="flex items-center gap-1 text-[11px] text-emerald-300/90"><Check className="h-3 w-3" /> Rewrite passed your rules</span>}
        {result.context && (
          <span className="text-[11px] text-zinc-500">{result.context.checked ? `Compared with "${result.context.name}"` : `"${result.context.name}" could not be compared right now`}</span>
        )}
      </div>
      <p className="nz-reveal mt-2 text-sm text-zinc-300" style={{ animationDelay: "60ms" }} data-testid="clean-summary">{result.summary}</p>
      {result.format_note && <p className="mt-1 text-xs text-amber-200/80" data-testid="clean-format-note">{result.format_note}</p>}

      {result.text !== null && (
        <div className="nz-reveal relative mt-3 rounded-xl border border-cyan-400/20 bg-[#030814] p-3 pt-8" style={{ animationDelay: "120ms" }}>
          {controlled && (
            <span className="absolute right-3 top-2.5 flex items-center gap-2" data-testid="clean-seal" title={took !== null ? `Controlled by NazAI in ${secondsLabel(took)}` : "Controlled by NazAI"}>
              <span className="h-px w-8 bg-gradient-to-r from-transparent to-cyan-300/80" aria-hidden />
              <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-cyan-200/75">Controlled by NazAI</span>
            </span>
          )}
          {result.email ? (
            <EmailView subject={result.email.subject} body={result.text} />
          ) : shaped ? (
            <div className="text-[15px] leading-relaxed text-zinc-100" data-testid="clean-text"><RichText text={result.text} /></div>
          ) : (
            <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-zinc-100" data-testid="clean-text">{text}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={() => void copyNow("formatted")} data-testid="clean-copy-formatted" title="Keeps paragraphs, lists and bold when you paste into email, Docs, Notion or Slack"
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition ${copied === "formatted" ? "border-emerald-300/50 bg-emerald-400/15 text-emerald-50" : "border-white/10 text-zinc-300 hover:border-white/20 hover:text-zinc-100"}`}>
              {copied === "formatted" ? <><Check className="h-3.5 w-3.5" /> Copied</> : "Copy formatted"}
            </button>
            <button type="button" onClick={() => void copyNow("plain")} data-testid="clean-copy"
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${copied === "plain" ? "border-emerald-300/50 bg-emerald-400/15 text-emerald-50" : "border-cyan-300/40 bg-cyan-400/10 text-cyan-50 hover:bg-cyan-400/20"}`}>
              {copied === "plain" ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><ClipboardCopy className="h-3.5 w-3.5" /> Copy</>}
            </button>
            {result.email && controlled && (
              <button type="button" onClick={() => setSendOpen(true)} data-testid="clean-send"
                className="flex items-center gap-1.5 rounded-lg border border-amber-300/50 bg-gradient-to-r from-amber-400/20 to-cyan-400/10 px-3 py-1.5 text-xs font-semibold text-amber-50 hover:from-amber-400/30">
                <Send className="h-3.5 w-3.5" /> Send…
              </button>
            )}
          </div>
          {result.email && <SendEmailDialog open={sendOpen} onOpenChange={setSendOpen} subject={result.email.subject} body={result.text} />}
        </div>
      )}

      <div className="nz-reveal mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" style={{ animationDelay: "180ms" }} data-testid="clean-trail" aria-label="What was applied">
        <TrailStep label={plural(trail.rules, "rule applied", "rules applied")} n={trail.rules} style={TRAIL_STYLE.rules} onClick={() => go("rules")} testId="trail-rules" />
        <span className="text-zinc-600" aria-hidden>→</span>
        <TrailStep label={plural(trail.fixes, "fix made", "fixes made")} n={trail.fixes} style={TRAIL_STYLE.fixes} onClick={() => go("fixes")} testId="trail-fixes" />
        <span className="text-zinc-600" aria-hidden>→</span>
        <TrailStep label={plural(trail.blocked, "item blocked", "items blocked")} n={trail.blocked} style={blockedStyle} onClick={() => go("blocked")} testId="trail-blocked" />
      </div>

      {result.edits.length > 0 && (
        <div ref={editsRef} className={`nz-reveal mt-4 rounded-lg ${ring("edits")}`} style={{ animationDelay: "240ms" }} data-testid="clean-edits">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">What changed</p>
          <ul className="mt-1.5 space-y-2">
            {result.edits.map((e, i) => (
              <li key={i} className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-sm transition-colors hover:border-emerald-300/20"
                onMouseEnter={() => setHoverEdit(i)} onMouseLeave={() => setHoverEdit(null)}>
                <span className="text-rose-200/80 line-through decoration-rose-300/50">{e.before}</span>
                {e.after ? <> <ArrowRight className="mx-1 inline h-3 w-3 text-zinc-500" /> <span className="text-emerald-200">{e.after}</span></> : <span className="ml-1 text-xs text-zinc-500">(removed)</span>}
                {e.why && <span className="mt-0.5 block text-xs text-zinc-500">{e.why}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.found.length > 0 && (
        <div ref={foundRef} className={`nz-reveal mt-4 rounded-lg ${ring("found")}`} style={{ animationDelay: "300ms" }} data-testid="clean-found">
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

      {controlled && (
        <p className="nz-reveal mt-4 border-t border-white/5 pt-2.5 text-center font-mono text-[10px] tracking-[0.12em] text-zinc-500" style={{ animationDelay: "360ms" }} data-testid="clean-signature">
          Verified against your rules • <span title="Your text is never shown to anyone else. It goes only to the AI NazAI uses to check and fix it, and it is saved encrypted in your history." className="cursor-help underline decoration-dotted decoration-zinc-700 underline-offset-2">Not shared</span> • Controlled output
        </p>
      )}
    </div>
  );
}

function TrailStep({ label, n, style, onClick, testId }: { label: string; n: number; style: { text: string; marker: string }; onClick: () => void; testId: string }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId}
      className={`nz-marker rounded-sm px-0.5 outline-none transition-colors ${n > 0 ? style.text : "text-zinc-500"}`}
      style={{ ["--nz-marker" as string]: style.marker }}>
      {label}
    </button>
  );
}

/** **bold** inside a line, as React (never HTML from the AI). */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return <>{parts.map((p, i) => /^\*\*[^*]+\*\*$/.test(p) ? <strong key={i} className="font-semibold text-zinc-50">{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>)}</>;
}

/** A reshaped result: paragraphs, bullet lists and bold, laid out as they will be pasted. */
function RichText({ text }: { text: string }) {
  return (
    <div className="space-y-3">
      {blocksOf(text).map((b, i) => b.kind === "ul" ? (
        <ul key={i} className="space-y-1.5">
          {b.items.map((it, j) => (
            <li key={j} className="flex gap-2.5"><span className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-cyan-300/80" aria-hidden /><span><Inline text={it} /></span></li>
          ))}
        </ul>
      ) : (
        <p key={i} className="break-words">{b.lines.map((l, j) => <span key={j}>{j ? <br /> : null}<Inline text={l} /></span>)}</p>
      ))}
    </div>
  );
}

/** Email format: shown as an email ready to send (who, subject, body), in NazAI's look. */
function EmailView({ subject, body }: { subject: string; body: string }) {
  return (
    <div data-testid="clean-email">
      <div className="mb-3 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.22em] text-amber-200/70">
        <Mail className="h-3 w-3" /> Email · ready to send
      </div>
      <dl className="space-y-1.5 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5 text-xs">
        <div className="flex items-baseline gap-3"><dt className="w-14 shrink-0 text-zinc-500">From</dt><dd className="text-zinc-400">You</dd></div>
        <div className="flex items-baseline gap-3"><dt className="w-14 shrink-0 text-zinc-500">To</dt><dd className="text-zinc-600">Added when you send</dd></div>
        <div className="flex items-baseline gap-3 border-t border-white/5 pt-1.5"><dt className="w-14 shrink-0 text-zinc-500">Subject</dt><dd className="text-[15px] font-semibold text-zinc-50" data-testid="clean-email-subject">{subject}</dd></div>
      </dl>
      <div className="mt-4 border-l-2 border-cyan-300/20 pl-4 text-[15px] leading-relaxed text-zinc-100" data-testid="clean-text"><RichText text={body} /></div>
    </div>
  );
}

/**
 * Send: who it is from and to. NazAI opens the person's own Gmail (the account named in From), Outlook or mail app with everything
 * filled in; they press Send there. NazAI never sends as them, and the addresses are not saved.
 */
function SendEmailDialog({ open, onOpenChange, subject, body }: { open: boolean; onOpenChange: (o: boolean) => void; subject: string; body: string }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [subj, setSubj] = useState(subject);
  useEffect(() => { if (open) setSubj(subject); }, [open, subject]);
  const fromOk = EMAIL_RE.test(from.trim());
  const toList = to.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const toOk = toList.length > 0 && toList.every((x) => EMAIL_RE.test(x));
  const ready = fromOk && toOk && !!subj.trim();
  const links = mailLinks({ from: from.trim(), to: toList.join(","), subject: subj.trim(), body: toPlain(body) });
  const opened = (client: string) => { trackClean("email_opened", { client }); onOpenChange(false); };
  const field = "w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-400/50";
  const btn = "flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-semibold transition";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-cyan-400/20 bg-[#040915] text-zinc-100 sm:max-w-md" data-testid="clean-send-dialog">
        <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-amber-400/10 blur-[80px]" aria-hidden />
        <DialogHeader className="relative">
          <DialogTitle className="flex items-center gap-2 text-lg"><Send className="h-4 w-4 text-amber-200" /> Send this email</DialogTitle>
          <DialogDescription className="text-zinc-400">NazAI opens your own email with everything filled in, and you press Send there. Your addresses are not saved.</DialogDescription>
        </DialogHeader>
        <div className="relative space-y-3">
          <label className="block space-y-1"><span className="text-xs text-zinc-400">From (your email)</span>
            <input type="email" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="you@yourcompany.com" className={field} data-testid="send-from" autoComplete="email" /></label>
          <label className="block space-y-1"><span className="text-xs text-zinc-400">To</span>
            <input type="text" value={to} onChange={(e) => setTo(e.target.value)} placeholder="sam@example.com" className={field} data-testid="send-to" /></label>
          <label className="block space-y-1"><span className="text-xs text-zinc-400">Subject</span>
            <input type="text" value={subj} onChange={(e) => setSubj(e.target.value)} className={field} data-testid="send-subject" /></label>
          {(from && !fromOk) || (to && !toOk) ? <p className="text-xs text-rose-200" role="alert">Check the email address{to && !toOk && from && !fromOk ? "es" : ""}.</p> : null}
          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <a href={ready ? links.gmail : undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!ready} data-testid="send-gmail" onClick={(e) => { if (!ready) e.preventDefault(); else opened("gmail"); }}
              className={`${btn} ${ready ? "border-cyan-300/50 bg-gradient-to-r from-cyan-500/30 to-amber-300/20 text-cyan-50 shadow-[0_0_24px_-8px_rgba(34,211,238,0.8)]" : "pointer-events-auto cursor-not-allowed border-white/10 text-zinc-500"}`}>Gmail</a>
            <a href={ready ? links.outlook : undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!ready} data-testid="send-outlook" onClick={(e) => { if (!ready) e.preventDefault(); else opened("outlook"); }}
              className={`${btn} ${ready ? "border-white/15 text-zinc-100 hover:border-white/30" : "cursor-not-allowed border-white/10 text-zinc-500"}`}>Outlook</a>
            <a href={ready ? links.mailto : undefined} aria-disabled={!ready} data-testid="send-mailto" onClick={(e) => { if (!ready) e.preventDefault(); else opened("mail_app"); }}
              className={`${btn} ${ready ? "border-white/15 text-zinc-100 hover:border-white/30" : "cursor-not-allowed border-white/10 text-zinc-500"}`}>Mail app</a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Draft = Record<SectionKey, string>;
const draftOf = (s: StructuredContext): Draft => ({ facts: s.facts.join("\n"), policies: s.policies.join("\n"), tone: s.tone.join("\n"), never_say: s.never_say.join("\n") });
const sectionsOf = (d: Draft): StructuredContext => ({
  facts: d.facts.split("\n").map((x) => x.trim()).filter(Boolean),
  policies: d.policies.split("\n").map((x) => x.trim()).filter(Boolean),
  tone: d.tone.split("\n").map((x) => x.trim()).filter(Boolean),
  never_say: d.never_say.split("\n").map((x) => x.trim()).filter(Boolean),
});

/**
 * Your context, added or edited. Paste what your AI knows about you; "Sort it" divides it into Facts, Policies, Tone and Never say
 * (only what the text says), each part editable; saved encrypted as one project. Editing saves a new version and archives the old.
 */
function AddContextDialog({ open, onOpenChange, accountId, onAdded, editing }: { open: boolean; onOpenChange: (o: boolean) => void; accountId: string | null; onAdded: (id: string) => void; editing: { id: string; name: string } | null }) {
  const [name, setName] = useState(CONTEXT_NAME);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<"sort" | "save" | "load" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProblem(null); setNote(null); setDraft(null); setText(""); setName(editing?.name ?? CONTEXT_NAME);
    if (!editing) return;
    let live = true;
    setBusy("load");
    void callProjects("read", { project_id: editing.id, account_id: accountId }).then((r) => {
      if (!live) return;
      setBusy(null);
      const content = String((r.data as { content?: string })?.content ?? "");
      if (!r.ok) { setProblem(r.message || "Your context could not be read."); return; }
      const parsed = parseContextSections(content);
      if (parsed) setDraft(draftOf(parsed)); else setText(content);
    });
    return () => { live = false; };
  }, [open, editing, accountId]);

  const sort = async () => {
    if (!text.trim()) return;
    setBusy("sort"); setProblem(null);
    const r = await structureContext(text.trim(), accountId);
    setBusy(null);
    if (r.ok === false) { setProblem(r.message); return; }
    setDraft(draftOf(r.sections));
    const bits = [r.discarded ? `${r.discarded} line${r.discarded === 1 ? " was" : "s were"} left out because your text does not say ${r.discarded === 1 ? "it" : "them"}.` : "", r.hidden.length ? "Secrets in your text were hidden and are not kept." : ""].filter(Boolean);
    setNote(bits.length ? bits.join(" ") : null);
  };

  const save = async () => {
    const content = draft ? composeContext(sectionsOf(draft)) : text.trim();
    if (!content) { setProblem("Add at least one line."); return; }
    setBusy("save"); setProblem(null);
    const r = await callProjects("import_paste", { text: content, name: name.trim() || CONTEXT_NAME, account_id: accountId });
    const id = (r.data?.project as { id?: string } | undefined)?.id;
    if (!r.ok || !id) { setBusy(null); setProblem(r.message || "Your context could not be saved."); return; }
    if (editing) await callProjects("archive", { project_id: editing.id, archived: true, account_id: accountId }); // the old version is kept, archived
    setBusy(null);
    trackClean("context_added", { chars: content.length, structured: !!draft, edited: !!editing });
    onAdded(id);
    onOpenChange(false);
    toast.success(editing ? "Your context is updated. The previous version is archived in Projects." : "Your context is saved, encrypted. Clean it now uses it.");
  };

  const sectionCls = "block w-full resize-y rounded-lg bg-transparent px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-amber-300/20 bg-[#040915] text-zinc-100 sm:max-w-2xl" data-testid="clean-context-dialog">
        <div className="pointer-events-none absolute -left-16 -top-20 h-48 w-48 rounded-full bg-amber-400/10 blur-[80px]" aria-hidden />
        <DialogHeader className="relative">
          <DialogTitle className="flex items-center gap-2 text-lg"><BookUser className="h-4 w-4 text-amber-200" /> {editing ? "Edit your context" : "Add your AI context"}</DialogTitle>
          <DialogDescription className="text-zinc-400">
            {draft
              ? "Sorted into four parts. Edit any line: one item per line. Clean it checks against Facts, Policies and Never say, and writes in your Tone."
              : "Paste what your AI already knows about you or your business: facts, prices, policies, how you write. NazAI sorts it into four parts you can edit. It is stored encrypted."}
          </DialogDescription>
        </DialogHeader>
        {busy === "load" && <p className="text-sm text-zinc-500">Reading your context…</p>}
        {!draft && busy !== "load" && (
          <>
            <ul className="space-y-1 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-zinc-400">
              {CONTEXT_SOURCES_HELP.map((h) => <li key={h.tool}><span className="text-zinc-200">{h.tool}:</span> {h.where}</li>)}
            </ul>
            <div className={`oc-box relative overflow-hidden rounded-xl border bg-black/40 p-1 ${busy === "sort" ? "border-cyan-400/50" : "border-white/10"}`}>
              {busy === "sort" && <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] overflow-hidden" aria-hidden><span className="nz-line" /></span>}
              <textarea aria-label="Your context" rows={8} value={text} onChange={(e) => setText(e.target.value)} data-testid="clean-context-text"
                placeholder="e.g. We are a 5-person bakery in Leeds. Delivery is Tuesday and Friday only. Refunds within 14 days. We never use exclamation marks."
                className="block w-full resize-y rounded-lg bg-transparent px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600" />
            </div>
          </>
        )}
        {draft && (
          <div className="grid gap-3 sm:grid-cols-2" data-testid="context-sections">
            {CONTEXT_SECTIONS.map((c) => (
              <label key={c.key} className="block rounded-xl border border-white/10 bg-white/[0.02] p-2.5" data-testid={`context-section-${c.key}`}>
                <span className="flex items-baseline justify-between gap-2 px-1">
                  <span className={`text-xs font-semibold ${c.key === "never_say" ? "text-rose-200" : c.key === "tone" ? "text-amber-100" : "text-cyan-100"}`}>{c.title}</span>
                  <span className="font-mono text-[10px] text-zinc-600">{draft[c.key].split("\n").filter((x) => x.trim()).length}</span>
                </span>
                <span className="block px-1 text-[11px] text-zinc-500">{c.hint}</span>
                <textarea rows={4} value={draft[c.key]} onChange={(e) => setDraft({ ...draft, [c.key]: e.target.value })} className={`${sectionCls} mt-1`} placeholder="Nothing yet" aria-label={c.title} />
              </label>
            ))}
          </div>
        )}
        {note && <p className="text-xs text-amber-200/80" data-testid="context-note">{note}</p>}
        <label className="block text-xs text-zinc-400" htmlFor="clean-context-name">Name</label>
        <input id="clean-context-name" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-cyan-400/50" />
        {problem && <p role="alert" className="text-sm text-rose-200">{problem}</p>}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          {draft ? (
            <button type="button" disabled={busy !== null} onClick={() => void save()} data-testid="clean-context-save"
              className="flex-1 rounded-xl border border-amber-300/50 bg-gradient-to-r from-amber-400/25 to-cyan-400/15 px-3 py-2.5 text-sm font-semibold text-amber-50 disabled:opacity-40">
              {busy === "save" ? "Saving…" : editing ? "Save changes" : "Save my context"}
            </button>
          ) : (
            <button type="button" disabled={busy !== null || !text.trim()} onClick={() => void sort()} data-testid="clean-context-sort"
              className="flex-1 rounded-xl border border-cyan-300/50 bg-gradient-to-r from-cyan-500/30 to-amber-300/20 px-3 py-2.5 text-sm font-semibold text-cyan-50 disabled:opacity-40">
              {busy === "sort" ? "Sorting into four parts…" : "Sort it into Facts, Policies, Tone, Never say"}
            </button>
          )}
          {draft ? (
            <button type="button" disabled={busy !== null} onClick={() => { setText(composeContext(sectionsOf(draft))); setDraft(null); setNote(null); }} className="text-xs text-zinc-500 hover:text-zinc-300 sm:px-3">Edit as plain text</button>
          ) : (
            <button type="button" disabled={busy !== null || !text.trim()} onClick={() => void save()} data-testid="clean-context-save" className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-40 sm:px-3">Save as it is</button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
