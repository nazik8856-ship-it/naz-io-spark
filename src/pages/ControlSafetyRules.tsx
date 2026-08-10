import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ScanSearch, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

type Severity = "block" | "require_approval";
type Rule = {
  id: string;
  name: string;
  category: string;
  pattern: string;
  severity: Severity;
  enabled: boolean;
};

// Mirrors BUILTIN_SAFETY_RULES in the edge function — shown read-only.
const BUILTINS: { name: string; category: string; severity: Severity }[] = [
  { name: "API key or secret in payload", category: "secrets", severity: "block" },
  { name: "Payment card number", category: "pii", severity: "block" },
  { name: "National ID / SSN pattern", category: "pii", severity: "block" },
  { name: "Destructive wording", category: "destructive", severity: "block" },
  { name: "Refund or cancellation without a reference", category: "financial", severity: "require_approval" },
  { name: "Mass-audience send", category: "reach", severity: "require_approval" },
  { name: "Disposable recipient domain", category: "recipients", severity: "block" },
];

/**
 * SAFETY RULES — the deterministic, non-model scan that runs inside the
 * control gate before any AI judgement. Pure pattern matching, so a model
 * mistake alone can never let a high-stakes action through.
 */
export default function ControlSafetyRules() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rules, setRules] = useState<Rule[]>([]);
  const [name, setName] = useState("");
  const [pattern, setPattern] = useState("");
  const [severity, setSeverity] = useState<Severity>("require_approval");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("safety_rules")
      .select("id, name, category, pattern, severity, enabled")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setRules((data ?? []) as unknown as Rule[]);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!user || !name.trim() || !pattern.trim()) return;
    try { new RegExp(pattern); } catch {
      toast({ title: "That pattern isn't valid", description: "Check the expression and try again.", variant: "destructive" });
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("safety_rules").insert({
      user_id: user.id, name: name.trim(), pattern: pattern.trim(), severity, category: "custom",
    });
    setBusy(false);
    if (error) { toast({ title: "Couldn't add rule", description: error.message, variant: "destructive" }); return; }
    setName(""); setPattern("");
    load();
  };

  const toggle = async (r: Rule) => {
    await supabase.from("safety_rules").update({ enabled: !r.enabled }).eq("id", r.id);
    load();
  };
  const remove = async (r: Rule) => {
    await supabase.from("safety_rules").delete().eq("id", r.id);
    load();
  };

  return (
    <div className="min-h-screen w-full text-white" style={{ backgroundColor: "#020617" }}>
      <header className="flex items-center gap-3 border-b border-white/5 px-6 py-4">
        <button
          onClick={() => navigate("/control-system")}
          className="flex items-center gap-2 text-zinc-400 transition-colors hover:text-white"
          aria-label="Back to Control System"
        >
          <ArrowLeft className="h-5 w-5" />
          <span className="font-mono text-sm uppercase tracking-wider">Control System</span>
        </button>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-8">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <ScanSearch className="h-5 w-5 text-cyan-300" /> Safety rules
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Pattern checks that run before any AI judgement. A match either blocks the action outright
          or sends it to the approval queue.
        </p>

        <section className="mt-6 rounded-lg border border-white/10 bg-white/[0.03] p-4">
          <h2 className="font-mono text-xs uppercase tracking-wider text-zinc-400">Add a rule</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input
              value={name} onChange={(e) => setName(e.target.value)}
              placeholder="What it catches, e.g. Competitor mentions"
              className="rounded border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-cyan-500/50"
            />
            <input
              value={pattern} onChange={(e) => setPattern(e.target.value)}
              placeholder="Pattern, e.g. (acme|globex)"
              className="rounded border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm outline-none focus:border-cyan-500/50"
            />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <select
              value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}
              className="rounded border border-white/10 bg-black/40 px-3 py-2 text-xs outline-none"
            >
              <option value="require_approval">Send to approval queue</option>
              <option value="block">Block outright</option>
            </select>
            <button
              disabled={busy}
              onClick={add}
              className="flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-mono uppercase text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </div>
        </section>

        <section className="mt-6 space-y-2">
          <h2 className="font-mono text-xs uppercase tracking-wider text-zinc-400">Your rules</h2>
          {rules.length === 0 ? (
            <p className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-500">
              No custom rules yet — the built-in checks below still apply.
            </p>
          ) : rules.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-zinc-200">{r.name}</p>
                <p className="truncate font-mono text-[11px] text-zinc-500">{r.pattern}</p>
              </div>
              <span className={`rounded border px-2 py-0.5 text-[10px] font-mono uppercase ${
                r.severity === "block"
                  ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-300"
              }`}>
                {r.severity === "block" ? "block" : "approval"}
              </span>
              <button onClick={() => toggle(r)} className="text-[10px] font-mono uppercase text-zinc-400 hover:text-white">
                {r.enabled ? "on" : "off"}
              </button>
              <button onClick={() => remove(r)} className="text-zinc-500 hover:text-rose-300" aria-label="Delete rule">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </section>

        <section className="mt-8 space-y-2">
          <h2 className="font-mono text-xs uppercase tracking-wider text-zinc-400">Built-in checks (always on)</h2>
          {BUILTINS.map((b) => (
            <div key={b.name} className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3">
              <p className="min-w-0 flex-1 truncate text-sm text-zinc-300">{b.name}</p>
              <span className="text-[10px] font-mono uppercase text-zinc-500">{b.category}</span>
              <span className={`text-[10px] font-mono uppercase ${b.severity === "block" ? "text-rose-300" : "text-amber-300"}`}>
                {b.severity === "block" ? "block" : "approval"}
              </span>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
