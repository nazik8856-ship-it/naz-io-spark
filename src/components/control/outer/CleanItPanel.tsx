// Clean it (Context Day 1): Outer Control's first screen. Paste text from ChatGPT, Claude, Gemini or any AI; NazAI applies the
// account's rules and the person's own context and returns ONE result: the text to copy, what was found and what changed.
// Same look as Start a task (glows, the oc-box input, the cyan-to-gold button). The details that make it feel controlled
// (docs/clean-it.md, "Details"): the control pulse, the thin progress line and a precise timer while it works, the result's
// reveal with its seal, the rule application trail, the quiet confidence of a clean result, the context weight and the trust line.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, BookUser, Check, ClipboardCopy, Plus, ShieldCheck, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useProjectList, announceProjectsChanged } from "@/hooks/useProjectList";
import { callProjects } from "@/lib/projects";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  allowanceLine, cleanContext, CLEAN_SOURCES, CONTEXT_NAME, CONTEXT_SOURCES_HELP, contextWeight, isControlled, MAX_CLEAN_CHARS, plural,
  rememberContext, rememberedContext, secondsLabel, STARTER_RULES, STATUS_TITLE, trackClean, trailOf, type CleanResult, type CleanSource,
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
    const out = await cleanContext({ content: text, source, projectId: contextId, accountId });
    setBusy(false); setStartedAt(null); setTook(Date.now() - t0);
    if ("message" in out) { setProblem({ message: out.message, limit: out.limit }); return; }
    setResult(out.result); setResultFor(text);
    pulse();
    if (out.result.context?.used !== undefined) setWeight({ used: out.result.context.used, total: out.result.context.total ?? out.result.context.used, limit: weight?.limit ?? 6000 });
    trackClean("context_checked", {
      status: out.result.status, changed: out.result.status === "changed", rewrite: out.result.rewrite, source,
      with_context: !!out.result.context, found: out.result.found.length, edits: out.result.edits.length,
    });
  };

  const copy = async (): Promise<boolean> => {
    if (!result?.text) return false;
    let ok = true;
    try { await navigator.clipboard.writeText(result.text); } catch { ok = false; toast.error("Copy did not work here. Select the text and copy it."); }
    trackClean("result_copied", { status: result.status, rewrite: result.rewrite });
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

      <AddContextDialog open={addOpen} onOpenChange={setAddOpen} accountId={accountId}
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

function ResultCard({ result, onCopy, elevated, took }: { result: CleanResult; onCopy: () => Promise<boolean>; elevated: boolean; took: number | null }) {
  const trail = trailOf(result);
  const controlled = isControlled(result);
  const [hoverEdit, setHoverEdit] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
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
  const copyNow = async () => { if (await onCopy()) { setCopied(true); window.setTimeout(() => setCopied(false), 1600); } };

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

      {result.text !== null && (
        <div className="nz-reveal relative mt-3 rounded-xl border border-cyan-400/20 bg-[#030814] p-3 pt-8" style={{ animationDelay: "120ms" }}>
          {controlled && (
            <span className="absolute right-3 top-2.5 flex items-center gap-2" data-testid="clean-seal" title={took !== null ? `Controlled by NazAI in ${secondsLabel(took)}` : "Controlled by NazAI"}>
              <span className="h-px w-8 bg-gradient-to-r from-transparent to-cyan-300/80" aria-hidden />
              <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-cyan-200/75">Controlled by NazAI</span>
            </span>
          )}
          <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-zinc-100" data-testid="clean-text">{text}</p>
          <div className="mt-2 flex justify-end">
            <button type="button" onClick={() => void copyNow()} data-testid="clean-copy"
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${copied ? "border-emerald-300/50 bg-emerald-400/15 text-emerald-50" : "border-cyan-300/40 bg-cyan-400/10 text-cyan-50 hover:bg-cyan-400/20"}`}>
              {copied ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><ClipboardCopy className="h-3.5 w-3.5" /> Copy</>}
            </button>
          </div>
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
