import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download, Upload, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
// Stale generated types: control-system tables aren't in types.ts yet.
const anyDb = supabase as any;
import { useAuth } from "@/hooks/useAuth";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { canWriteAsOwner } from "@/lib/account-switcher";
import { friendlyErrorMessage } from "@/lib/friendly-errors";
import { toast } from "@/hooks/use-toast";
import {
  buildPolicyBundle, validatePolicyBundle, resolveImportForAccount,
  type PolicyBundle, type SourceAgentSetting, type SourceHardRule, type SourceSafetyRule,
} from "@/lib/policy-bundle";

type AgentOption = { id: string; name: string };

/**
 * POLICY AS CODE — export this account's entire policy (hard rules,
 * safety rules, spend cap, strictness, per-agent overrides) as one
 * portable JSON bundle, and re-import one into any account. Enables
 * backup outside the platform, staging->prod promotion, and version
 * control in the customer's own repo. Every imported rule lands inert
 * (shadow/off) for review — nothing a bundle imports goes live on its own.
 */
export default function ControlPolicyBundle() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { accountId, role } = useActiveAccount();
  const canWrite = canWriteAsOwner(role);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [bundle, setBundle] = useState<PolicyBundle | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  const exportBundle = useCallback(async () => {
    if (!accountId) return;
    setExporting(true);
    const [{ data: agentRows }, { data: hardRules }, { data: safetyRules }, { data: profile }, { data: caps }, { data: overrides }] = await Promise.all([
      anyDb.from("agents").select("id, name").eq("user_id", accountId),
      anyDb.from("hard_rules").select("rule_text, action_type_pattern, effect, provider, shadow_mode, agent_id").eq("user_id", accountId),
      anyDb.from("safety_rules").select("name, category, pattern, severity, enabled, shadow_mode, agent_id").eq("user_id", accountId),
      anyDb.from("profiles").select("control_strictness").eq("id", accountId).maybeSingle(),
      anyDb.from("ai_spend_caps").select("daily_cap_usd, enabled, agent_id").eq("user_id", accountId),
      anyDb.from("agent_strictness_overrides").select("agent_id, strictness").eq("user_id", accountId),
    ]);
    setExporting(false);

    const agents = (agentRows ?? []) as AgentOption[];
    const agentNamesById: Record<string, string> = {};
    for (const a of agents) agentNamesById[a.id] = a.name;

    const capsByAgent: Record<string, number> = {};
    let accountCap = { usd: 5, enabled: true };
    for (const c of (caps ?? []) as { daily_cap_usd: number; enabled: boolean; agent_id: string | null }[]) {
      if (c.agent_id) capsByAgent[c.agent_id] = c.daily_cap_usd;
      else accountCap = { usd: c.daily_cap_usd, enabled: c.enabled };
    }
    const overrideByAgent: Record<string, string> = {};
    for (const o of (overrides ?? []) as { agent_id: string; strictness: string }[]) overrideByAgent[o.agent_id] = o.strictness;

    const agentSettings: SourceAgentSetting[] = agents.map((a) => ({
      agent_id: a.id,
      strictness_override: overrideByAgent[a.id] ?? null,
      spend_cap_usd: capsByAgent[a.id] ?? null,
    }));

    const built = buildPolicyBundle({
      accountWideStrictness: (profile as { control_strictness?: string } | null)?.control_strictness ?? "balanced",
      accountWideSpendCapUsd: accountCap.usd,
      accountWideSpendCapEnabled: accountCap.enabled,
      agentNamesById,
      agentSettings,
      hardRules: (hardRules ?? []) as SourceHardRule[],
      safetyRules: (safetyRules ?? []) as SourceSafetyRule[],
    });

    const blob = new Blob([JSON.stringify(built, null, 2)], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nazai-policy-bundle_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast({ title: "Policy bundle exported", description: `${built.hard_rules.length} hard rule(s), ${built.safety_rules.length} safety rule(s).` });
  }, [accountId]);

  const onFileSelected = async (file: File) => {
    setBundle(null);
    setValidationErrors([]);
    setImportWarnings([]);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setValidationErrors(["That file isn't valid JSON."]);
      return;
    }
    const result = validatePolicyBundle(parsed);
    if (!result.valid) {
      setValidationErrors(result.errors);
      return;
    }
    setBundle(parsed as PolicyBundle);
  };

  const applyImport = async () => {
    if (!bundle || !canWrite || !accountId) return;
    setImporting(true);
    const { data: agentRows } = await anyDb.from("agents").select("id, name").eq("user_id", accountId);
    const agentIdsByName: Record<string, string> = {};
    for (const a of (agentRows ?? []) as AgentOption[]) agentIdsByName[a.name] = a.id;

    const resolved = resolveImportForAccount(bundle, accountId, agentIdsByName);
    setImportWarnings(resolved.warnings);

    const [hardRes, safetyRes] = await Promise.all([
      resolved.hardRuleInserts.length ? anyDb.from("hard_rules").insert(resolved.hardRuleInserts) : Promise.resolve({ error: null }),
      resolved.safetyRuleInserts.length ? anyDb.from("safety_rules").insert(resolved.safetyRuleInserts) : Promise.resolve({ error: null }),
    ]);
    setImporting(false);
    if (hardRes.error || safetyRes.error) {
      toast({ title: "Import failed", description: friendlyErrorMessage((hardRes.error || safetyRes.error)!.message), variant: "destructive" });
      return;
    }
    toast({
      title: "Policy imported",
      description: `${resolved.hardRuleInserts.length} hard rule(s) added in shadow mode, ${resolved.safetyRuleInserts.length} safety rule(s) added off. Review and enable them from Hard rules / Safety rules.`,
    });
    setBundle(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  if (!user) return null;

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
        <h1 className="text-xl font-semibold">Policy as code</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Export your entire policy as one portable file, or import one to start from. Imported rules
          always land inert for review — nothing goes live on its own.
        </p>

        <section className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="font-mono text-xs uppercase tracking-wider text-zinc-400">Export</h2>
          <button
            onClick={exportBundle}
            disabled={exporting}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 px-3 py-1.5 text-xs font-semibold text-cyan-300 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> {exporting ? "Exporting…" : "Export policy bundle (.json)"}
          </button>
        </section>

        {canWrite && (
          <section className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <h2 className="font-mono text-xs uppercase tracking-wider text-zinc-400">Import</h2>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFileSelected(f); }}
              className="mt-3 block text-xs text-zinc-400"
            />

            {validationErrors.length > 0 && (
              <div className="mt-3 space-y-1 rounded border border-rose-500/30 bg-rose-500/[0.04] p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-300">
                  <AlertTriangle className="h-3.5 w-3.5" /> This bundle isn't valid:
                </p>
                {validationErrors.map((e, i) => <p key={i} className="text-[11px] text-rose-300/80">{e}</p>)}
              </div>
            )}

            {bundle && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-zinc-300">
                  {bundle.hard_rules.length} hard rule(s), {bundle.safety_rules.length} safety rule(s),{" "}
                  {bundle.agents.length} agent setting(s) — exported {new Date(bundle.exported_at).toLocaleString()}.
                </p>
                <button
                  onClick={applyImport}
                  disabled={importing}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 px-3 py-1.5 text-xs font-semibold text-emerald-400 disabled:opacity-40"
                >
                  <Upload className="h-3.5 w-3.5" /> {importing ? "Importing…" : "Import (shadow mode / off)"}
                </button>
              </div>
            )}

            {importWarnings.length > 0 && (
              <div className="mt-3 space-y-1 rounded border border-amber-500/30 bg-amber-500/[0.04] p-3">
                {importWarnings.map((w, i) => <p key={i} className="text-[11px] text-amber-300/80">{w}</p>)}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
