import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, FlaskConical } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type SimResult = {
  live_rules: { matched: { id: string; rule_text: string; effect: string } | null; shadow_matches: { id: string; rule_text: string; would_have: string }[] };
  draft_rule: { matches: boolean; would_result_in: string | null } | null;
  safety_scan: { matched: boolean; severity: string | null; summary: string | null };
  draft_safety_rule: { matches: boolean; would_result_in: string | null } | null;
  projected_verdict: "block" | "require_approval" | "allow";
  note: string;
};

const VERDICT_STYLE: Record<string, string> = {
  block: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  require_approval: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  allow: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
};

/**
 * RULE SIMULATOR — paste a hypothetical action, see what a draft hard rule
 * (plus the account's current live rules + the safety scanner) would do to
 * it, without a full scenario replay and without touching anything real.
 */
export default function ControlRuleSimulator() {
  const navigate = useNavigate();
  const [actionType, setActionType] = useState("");
  const [provider, setProvider] = useState("");
  const [description, setDescription] = useState("");
  const [useDraft, setUseDraft] = useState(false);
  const [draftPattern, setDraftPattern] = useState("");
  const [draftEffect, setDraftEffect] = useState<"always_block" | "always_require_approval">("always_require_approval");
  const [draftProvider, setDraftProvider] = useState("");
  const [useDraftSafety, setUseDraftSafety] = useState(false);
  const [draftSafetyPattern, setDraftSafetyPattern] = useState("");
  const [draftSafetySeverity, setDraftSafetySeverity] = useState<"block" | "require_approval">("require_approval");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SimResult | null>(null);

  const run = async () => {
    if (!actionType.trim() || !description.trim()) {
      toast({ title: "Missing fields", description: "Action type and description are required.", variant: "destructive" });
      return;
    }
    if (useDraftSafety && !draftSafetyPattern.trim()) {
      toast({ title: "Missing pattern", description: "The draft safety rule needs a pattern to test.", variant: "destructive" });
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("rule-simulator", {
      body: {
        action_type: actionType.trim(),
        provider: provider.trim() || "unknown",
        description: description.trim(),
        params: {},
        draft_rule: useDraft
          ? { action_type_pattern: draftPattern.trim() || "*", effect: draftEffect, provider: draftProvider.trim() || null }
          : null,
        draft_safety_rule: useDraftSafety
          ? { pattern: draftSafetyPattern.trim(), severity: draftSafetySeverity }
          : null,
      },
    });
    setBusy(false);
    if (error) {
      toast({ title: "Simulation failed", description: error.message, variant: "destructive" });
      return;
    }
    setResult(data as SimResult);
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

      <main className="mx-auto w-full max-w-2xl px-6 py-8">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <FlaskConical className="h-5 w-5 text-cyan-400" /> Rule simulator
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Test a hypothetical action against your current rules — and optionally a draft rule you haven't saved yet.
          Nothing here writes to the database or runs a real action.
        </p>

        <div className="mt-6 space-y-3 rounded border border-white/10 bg-white/[0.02] p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              Action type
              <input value={actionType} onChange={(e) => setActionType(e.target.value)} placeholder="e.g. send_email"
                className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-200" />
            </label>
            <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              Provider
              <input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="e.g. Gmail"
                className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-200" />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            Description
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
              placeholder="What the action would do"
              className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-200" />
          </label>

          <label className="flex items-center gap-2 pt-2 text-xs text-zinc-300">
            <input type="checkbox" checked={useDraft} onChange={(e) => setUseDraft(e.target.checked)} />
            Also test a draft hard rule (not saved)
          </label>
          {useDraft && (
            <div className="grid grid-cols-3 gap-3 rounded border border-cyan-500/20 bg-cyan-500/[0.03] p-3">
              <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                Pattern
                <input value={draftPattern} onChange={(e) => setDraftPattern(e.target.value)} placeholder="* or slack_*"
                  className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-200" />
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                Provider (optional)
                <input value={draftProvider} onChange={(e) => setDraftProvider(e.target.value)}
                  className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-200" />
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                Effect
                <select value={draftEffect} onChange={(e) => setDraftEffect(e.target.value as typeof draftEffect)}
                  className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-200">
                  <option value="always_require_approval">Require approval</option>
                  <option value="always_block">Block</option>
                </select>
              </label>
            </div>
          )}

          <label className="flex items-center gap-2 pt-2 text-xs text-zinc-300">
            <input type="checkbox" checked={useDraftSafety} onChange={(e) => setUseDraftSafety(e.target.checked)} />
            Also test a draft safety rule (not saved)
          </label>
          {useDraftSafety && (
            <div className="grid grid-cols-2 gap-3 rounded border border-cyan-500/20 bg-cyan-500/[0.03] p-3">
              <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                Pattern (regex)
                <input value={draftSafetyPattern} onChange={(e) => setDraftSafetyPattern(e.target.value)} placeholder="e.g. wire transfer"
                  className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-200" />
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                Severity
                <select value={draftSafetySeverity} onChange={(e) => setDraftSafetySeverity(e.target.value as typeof draftSafetySeverity)}
                  className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-200">
                  <option value="require_approval">Require approval</option>
                  <option value="block">Block</option>
                </select>
              </label>
            </div>
          )}

          <button
            disabled={busy}
            onClick={run}
            className="mt-2 rounded border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 font-mono text-[11px] uppercase text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {busy ? "Running…" : "Run simulation"}
          </button>
        </div>

        {result && (
          <div className="mt-6 space-y-3">
            <div className={`rounded border p-4 font-mono text-sm uppercase tracking-wider ${VERDICT_STYLE[result.projected_verdict]}`}>
              Projected verdict: {result.projected_verdict.replace("_", " ")}
            </div>
            <p className="text-xs text-zinc-500">{result.note}</p>

            <div className="rounded border border-white/10 bg-white/[0.02] p-3 text-sm">
              <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Live hard rules</div>
              {result.live_rules.matched ? (
                <p className="mt-1 text-zinc-300">Matched: "{result.live_rules.matched.rule_text}" → {result.live_rules.matched.effect}</p>
              ) : (
                <p className="mt-1 text-zinc-500">No live rule matches this action.</p>
              )}
              {result.live_rules.shadow_matches.length > 0 && (
                <p className="mt-1 text-zinc-500">
                  Shadow rule(s) would have: {result.live_rules.shadow_matches.map((r) => r.rule_text).join(", ")}
                </p>
              )}
            </div>

            {result.draft_rule && (
              <div className="rounded border border-cyan-500/20 bg-cyan-500/[0.03] p-3 text-sm">
                <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Draft rule</div>
                <p className="mt-1 text-zinc-300">
                  {result.draft_rule.matches
                    ? `Matches — would result in: ${result.draft_rule.would_result_in}`
                    : "Does not match this action."}
                </p>
              </div>
            )}

            <div className="rounded border border-white/10 bg-white/[0.02] p-3 text-sm">
              <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Safety scanner</div>
              <p className="mt-1 text-zinc-300">
                {result.safety_scan.matched ? result.safety_scan.summary : "No pattern matched."}
              </p>
            </div>

            {result.draft_safety_rule && (
              <div className="rounded border border-cyan-500/20 bg-cyan-500/[0.03] p-3 text-sm">
                <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Draft safety rule</div>
                <p className="mt-1 text-zinc-300">
                  {result.draft_safety_rule.matches
                    ? `Matches — would result in: ${result.draft_safety_rule.would_result_in?.replace("_", " ")}`
                    : "Does not match this action."}
                </p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
