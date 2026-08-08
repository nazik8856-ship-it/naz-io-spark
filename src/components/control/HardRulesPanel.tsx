import { useCallback, useEffect, useState } from "react";
import { Gavel, Plus, Trash2, ChevronDown } from "lucide-react";
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
};

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
 * Matching actions are decided by the rule itself; control-engine never
 * calls the model for them.
 */
export default function HardRulesPanel() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<HardRule[]>([]);
  const [text, setText] = useState("");
  const [scope, setScope] = useState("*");
  const [effect, setEffect] = useState<Effect>("always_block");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("hard_rules")
      .select("id, rule_text, action_type_pattern, effect, provider")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setRules((data ?? []) as HardRule[]);
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
    });
    setBusy(false);
    if (error) {
      toast({ title: "Could not save rule", description: error.message, variant: "destructive" });
      return;
    }
    setText("");
    toast({ title: "Rule saved", description: "It applies before any model scoring." });
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
            Rules are enforced before any AI judgement. Matching actions are decided by your rule,
            not the model.
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
              {rules.map((r) => (
                <li
                  key={r.id}
                  className="flex items-start gap-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-zinc-200">{r.rule_text}</p>
                    <p className="text-[11px] font-mono text-zinc-500">
                      {SCOPES.find((s) => s.pattern === r.action_type_pattern)?.label ?? r.action_type_pattern}
                      {" · "}
                      {r.effect === "always_block" ? "always blocked" : "approval required"}
                    </p>
                  </div>
                  <button
                    onClick={() => remove(r.id)}
                    aria-label={`Remove rule: ${r.rule_text}`}
                    className="text-zinc-500 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
