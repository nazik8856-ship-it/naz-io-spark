import { useCallback, useEffect, useState } from "react";
import { Gavel, Plus, Trash2, ChevronDown, Eye, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

type Effect = "always_block" | "always_require_approval";

type HardRule = {
  id: string;
  rule_text: string;
  action_type_pattern: string;
  effect: Effect;
  provider: string | null;
  shadow_mode: boolean;
  created_at: string;
};

type ShadowReport = { hits: number; decisions: number };

const SCOPES: { label: string; pattern: string }[] = [
  { label: "Any action", pattern: "*" },
  { label: "Sending email", pattern: "send_email" },
  { label: "Replying to email", pattern: "reply_email" },
  { label: "Posting to Slack", pattern: "slack_*" },
  { label: "Notion writes", pattern: "notion_*" },
  { label: "Canva writes", pattern: "canva_*" },
  { label: "Shopify writes", pattern: "shopify_*" },
  { label: "Figma writes", pattern: "figma_*" },
  { label: "Calendar events", pattern: "create_calendar_event" },
  { label: "Docs & sheets", pattern: "*_doc*" },
];

/**
 * HARD RULES — user-authored, non-negotiable guardrails.
 * Live rules decide matching actions outright (the model is never called).
 * Shadow rules are evaluated and logged only — they never change an outcome,
 * so you can see the impact before promoting one to live.
 */
export default function HardRulesPanel() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<HardRule[]>([]);
  const [reports, setReports] = useState<Record<string, ShadowReport>>({});
  const [text, setText] = useState("");
  const [scope, setScope] = useState("*");
  const [effect, setEffect] = useState<Effect>("always_block");
  const [shadow, setShadow] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("hard_rules")
      .select("id, rule_text, action_type_pattern, effect, provider, shadow_mode, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    const list = (data ?? []) as HardRule[];
    setRules(list);

    // "If this rule goes live, it would have affected N of the last M decisions."
    const shadowRules = list.filter((r) => r.shadow_mode);
    const next: Record<string, ShadowReport> = {};
    await Promise.all(
      shadowRules.map(async (r) => {
        const [{ count: hits }, { count: decisions }] = await Promise.all([
          supabase
            .from("hard_rule_shadow_hits")
            .select("id", { count: "exact", head: true })
            .eq("rule_id", r.id),
          supabase
            .from("agent_decisions")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.id)
            .gte("created_at", r.created_at),
        ]);
        next[r.id] = { hits: hits ?? 0, decisions: decisions ?? 0 };
      }),
    );
    setReports(next);
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!user || !text.trim() || busy) return;
    setBusy(true);
    const { error } = await supabase.from("hard_rules").insert({
      user_id: user.id,
      rule_text: text.trim(),
      action_type_pattern: scope,
      effect,
      shadow_mode: shadow,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Could not save rule", description: error.message, variant: "destructive" });
      return;
    }
    setText("");
    toast({
      title: shadow ? "Rule saved in shadow mode" : "Rule saved",
      description: shadow
        ? "It's only observed and logged — nothing is blocked yet."
        : "It applies before any model scoring.",
    });
    void load();
  };

  const promote = async (r: HardRule) => {
    const { error } = await supabase
      .from("hard_rules")
      .update({ shadow_mode: false, promoted_at: new Date().toISOString() })
      .eq("id", r.id);
    if (error) {
      toast({ title: "Could not promote rule", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Rule is now live", description: "It will decide matching actions from now on." });
    void load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("hard_rules").delete().eq("id", id);
    if (error) {
      toast({ title: "Could not remove rule", description: error.message, variant: "destructive" });
      return;
    }
    void load();
  };

  if (!user) return null;

  return (
    <section className="mx-6 mb-3 rounded-xl border border-white/10 bg-white/[0.03]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <Gavel className="h-4 w-4 text-zinc-400" />
        <span className="flex-1 text-xs font-mono uppercase tracking-wider text-zinc-300">
          Hard rules{rules.length ? ` · ${rules.length}` : ""}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="border-t border-white/10 px-4 py-4 space-y-4">
          <p className="text-[11px] text-zinc-500">
            Live rules are enforced before any AI judgement. Shadow rules are only watched and
            logged, so you can see what they would have done before turning them on.
          </p>

          <div className="space-y-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
              placeholder="e.g. never send email to more than 1 person"
              aria-label="Rule in plain English"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-white/25"
            />
            <div className="flex flex-wrap gap-2">
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                aria-label="Applies to"
                className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-300 outline-none"
              >
                {SCOPES.map((s) => (
                  <option key={s.pattern} value={s.pattern}>{s.label}</option>
                ))}
              </select>
              <select
                value={effect}
                onChange={(e) => setEffect(e.target.value as Effect)}
                aria-label="Effect"
                className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-300 outline-none"
              >
                <option value="always_block">Always block</option>
                <option value="always_require_approval">Always require approval</option>
              </select>
              <select
                value={shadow ? "shadow" : "live"}
                onChange={(e) => setShadow(e.target.value === "shadow")}
                aria-label="Rule mode"
                className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-300 outline-none"
              >
                <option value="shadow">Shadow (observe only)</option>
                <option value="live">Live (enforce now)</option>
              </select>
              <button
                onClick={add}
                disabled={busy || !text.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 px-3 py-1.5 text-xs font-semibold text-emerald-400 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" /> Add rule
              </button>
            </div>
          </div>

          {rules.length === 0 ? (
            <p className="text-[11px] font-mono text-zinc-600">No hard rules yet.</p>
          ) : (
            <ul className="space-y-2">
              {rules.map((r) => {
                const rep = reports[r.id];
                return (
                  <li
                    key={r.id}
                    className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${
                      r.shadow_mode
                        ? "border-amber-500/25 bg-amber-500/[0.04]"
                        : "border-white/10 bg-black/30"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-zinc-200">{r.rule_text}</p>
                        <span
                          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider ${
                            r.shadow_mode
                              ? "bg-amber-500/15 text-amber-300"
                              : "bg-emerald-500/15 text-emerald-300"
                          }`}
                        >
                          {r.shadow_mode ? <Eye className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
                          {r.shadow_mode ? "Shadow" : "Live"}
                        </span>
                      </div>
                      <p className="text-[11px] font-mono text-zinc-500">
                        {SCOPES.find((s) => s.pattern === r.action_type_pattern)?.label ?? r.action_type_pattern}
                        {" · "}
                        {r.effect === "always_block" ? "always blocked" : "approval required"}
                      </p>
                      {r.shadow_mode && (
                        <div className="mt-1.5 space-y-1.5">
                          <p className="text-[11px] text-amber-300/80">
                            {rep
                              ? rep.decisions === 0
                                ? "No decisions yet since this rule was created — nothing to report."
                                : `If this rule goes live, it would have affected ${rep.hits} of the last ${rep.decisions} decisions.`
                              : "Measuring impact…"}
                          </p>
                          <button
                            onClick={() => promote(r)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 px-2.5 py-1 text-[11px] font-semibold text-emerald-400"
                          >
                            <ShieldCheck className="h-3 w-3" /> Promote to live
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => remove(r.id)}
                      aria-label={`Remove rule: ${r.rule_text}`}
                      className="text-zinc-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
