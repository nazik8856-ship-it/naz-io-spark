import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, KeyRound, Plus, Copy, Ban, Check, Send, Settings, ChevronDown, ChevronUp, Trash2, MessageSquareText } from "lucide-react";
import { supabase, SUPABASE_FUNCTIONS_URL } from "@/integrations/supabase/client";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { hasPermission } from "@/lib/account-switcher";
import { toast } from "@/hooks/use-toast";

// api_keys is new (2026-08-26) -- not yet in the generated Supabase types
// (types.ts isn't regenerated in this sandbox), same established
// workaround used everywhere else a recent migration adds a table/column
// this session can't regenerate types for.
const anyDb = supabase as any;

type ApiKeyRow = {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
  created_at: string;
  on_uncertain: string;
  rate_limit_per_minute: number | null;
  response_persona: string | null;
};

type ContextEntry = { id: string; entry_text: string; enabled: boolean; created_at: string };

type KeyActivity = { callsToday: number; lastDecision: string | null; lastDecisionAt: string | null };

/** Pure -- color for a decision's free-text verb prefix (this codebase's own convention: "ALLOW ...", "BLOCK ...", "MODIFY/DEFERRED ..."). */
function decisionColorClass(decision: string | null): string {
  const upper = (decision ?? "").trim().toUpperCase();
  if (upper.startsWith("ALLOW")) return "text-emerald-400";
  if (upper.startsWith("BLOCK") || upper.startsWith("CIRCUIT_BREAKER")) return "text-rose-400";
  if (!upper) return "text-zinc-400";
  return "text-amber-400";
}

/**
 * "OUTER NAZAI" — the public Control API. Lets an EXTERNAL platform submit
 * one of its own proposed actions to NazAI's decision-gating engine and
 * get back a verdict (allow/modify/block/deferred), authenticated by a
 * key generated here. Verdict-only: a key can never create, edit, or
 * delete this account's own hard rules, safety rules, spend caps, or
 * approvals — every policy change still happens only inside this app.
 */
export default function ControlApiKeys() {
  const navigate = useNavigate();
  const { accountId, role, permissions } = useActiveAccount();
  const canWrite = hasPermission(role, permissions, "integrations");
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [activityByKey, setActivityByKey] = useState<Record<string, KeyActivity>>({});
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [justCreated, setJustCreated] = useState<{ key: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // Item 166: which key's settings panel (persona, context, rate limit)
  // is expanded -- one at a time, same "click to expand a card" pattern
  // as every other settings surface in this app.
  const [expandedKeyId, setExpandedKeyId] = useState<string | null>(null);

  // In-app API tester -- fires a REAL request at the public control-api
  // endpoint, exactly as an external caller would, so a key can be
  // verified without reaching for curl. Deliberately a plain fetch with
  // the pasted key as the Bearer token, not supabase.functions.invoke
  // (which would attach this browser session's own NazAI login instead).
  const [testKey, setTestKey] = useState("");
  const [testActionType, setTestActionType] = useState("send_email");
  const [testProvider, setTestProvider] = useState("Gmail");
  const [testDescription, setTestDescription] = useState("Reply to a customer inquiry.");
  const [testParams, setTestParams] = useState("{}");
  const [testMode, setTestMode] = useState<"fast" | "full">("fast");
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ status: number; body: Record<string, unknown> } | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data, error } = await anyDb
      .from("api_keys")
      .select("id, name, key_prefix, scopes, last_used_at, revoked_at, expires_at, created_at, on_uncertain, rate_limit_per_minute, response_persona")
      .eq("user_id", accountId)
      .order("created_at", { ascending: false });
    if (error) toast({ title: "Couldn't load API keys", description: error.message, variant: "destructive" });
    const rows = (data ?? []) as unknown as ApiKeyRow[];
    setKeys(rows);

    if (rows.length) {
      const ids = rows.map((r) => r.id);
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      // Two lightweight, approximate queries (same posture as
      // ControlWebhooks.tsx's own recentByHook: a bounded recent-rows
      // fetch grouped client-side, not a live-aggregation guarantee for
      // every key) -- exact counts for "today," and the most recent
      // decision per key from a bounded recent window, not a full scan.
      const [{ data: todayRows }, { data: recentRows }] = await Promise.all([
        anyDb.from("agent_decisions").select("api_key_id").in("api_key_id", ids).gte("created_at", todayStart.toISOString()),
        anyDb.from("agent_decisions").select("api_key_id, decision, created_at").in("api_key_id", ids).order("created_at", { ascending: false }).limit(200),
      ]);
      const callsToday: Record<string, number> = {};
      for (const r of (todayRows ?? []) as { api_key_id: string }[]) {
        callsToday[r.api_key_id] = (callsToday[r.api_key_id] ?? 0) + 1;
      }
      const lastByKey: Record<string, { decision: string; created_at: string }> = {};
      for (const r of (recentRows ?? []) as { api_key_id: string; decision: string; created_at: string }[]) {
        // Rows arrive newest-first, so the first one seen per key is its most recent.
        if (!lastByKey[r.api_key_id]) lastByKey[r.api_key_id] = r;
      }
      const activity: Record<string, KeyActivity> = {};
      for (const id of ids) {
        activity[id] = {
          callsToday: callsToday[id] ?? 0,
          lastDecision: lastByKey[id]?.decision ?? null,
          lastDecisionAt: lastByKey[id]?.created_at ?? null,
        };
      }
      setActivityByKey(activity);
    } else {
      setActivityByKey({});
    }
    setLoading(false);
  }, [accountId]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast({ title: "Name it first", description: "e.g. \"Production integration\"", variant: "destructive" });
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("api-keys", { body: { name: trimmed, account_id: accountId } });
    setBusy(false);
    const res = (data ?? {}) as { ok?: boolean; key?: string; name?: string; error?: string };
    if (error || !res.ok || !res.key) {
      toast({ title: "Couldn't create the key", description: res.error || error?.message, variant: "destructive" });
      return;
    }
    setName("");
    setJustCreated({ key: res.key, name: res.name || trimmed });
    setCopied(false);
    setTestKey(res.key);
    load();
  };

  const revoke = async (row: ApiKeyRow) => {
    const { data, error } = await supabase.functions.invoke(`api-keys/${row.id}/revoke`, { body: { account_id: accountId } });
    const res = (data ?? {}) as { ok?: boolean; error?: string };
    if (error || !res.ok) {
      toast({ title: "Couldn't revoke it", description: res.error || error?.message, variant: "destructive" });
      return;
    }
    toast({ title: "Key revoked", description: `"${row.name}" can no longer authenticate.` });
    load();
  };

  const copyKey = async () => {
    if (!justCreated) return;
    try {
      await navigator.clipboard.writeText(justCreated.key);
      setCopied(true);
      toast({ title: "Copied to clipboard" });
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast({ title: "Couldn't copy", description: "Select and copy the key manually.", variant: "destructive" });
    }
  };

  const runTest = async () => {
    if (!testKey.trim()) {
      toast({ title: "Paste a key first", variant: "destructive" });
      return;
    }
    if (!testActionType.trim() || !testDescription.trim()) {
      toast({ title: "action_type and description are required", variant: "destructive" });
      return;
    }
    let parsedParams: unknown = {};
    try {
      parsedParams = testParams.trim() ? JSON.parse(testParams) : {};
    } catch {
      toast({ title: "params must be valid JSON", variant: "destructive" });
      return;
    }
    setTestBusy(true);
    setTestResult(null);
    try {
      const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/control-api/v1`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${testKey.trim()}` },
        body: JSON.stringify({
          action_type: testActionType.trim(),
          provider: testProvider.trim() || undefined,
          description: testDescription.trim(),
          params: parsedParams,
          mode: testMode,
        }),
      });
      const body = await resp.json().catch(() => ({}));
      setTestResult({ status: resp.status, body });
    } catch (e) {
      setTestResult({ status: 0, body: { error: e instanceof Error ? e.message : "Network error" } });
    } finally {
      setTestBusy(false);
    }
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
          <KeyRound className="h-5 w-5 text-cyan-400" /> API Keys
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Give an external platform or your own backend a key so it can submit a proposed action to NazAI's
          control system and get back a real verdict — allow, modify, block, or deferred. Verdict-only: a key
          can never create, edit, or delete your hard rules, safety rules, spend caps, or approvals from
          outside. See the <button onClick={() => navigate("/control-system/api-docs")} className="text-cyan-400 underline underline-offset-2 hover:text-cyan-300">developer docs</button> for the request/response shape.
        </p>

        {canWrite ? (
          <div className="mt-6 space-y-3 rounded border border-white/10 bg-white/[0.02] p-4">
            <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              Key name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Production integration"
                className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-200"
              />
            </label>
            <button
              disabled={busy}
              onClick={create}
              className="flex items-center gap-1.5 rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 font-mono text-[11px] uppercase text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Generate key
            </button>
          </div>
        ) : (
          <p className="mt-6 rounded border border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-500">
            Only an account owner can generate or revoke API keys. You can view the keys below.
          </p>
        )}

        {justCreated && (
          <div className="mt-4 rounded border border-amber-500/40 bg-amber-500/10 p-4">
            <p className="font-mono text-[11px] uppercase tracking-wider text-amber-300">
              Copy this now — it won't be shown again
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 truncate rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-200">
                {justCreated.key}
              </code>
              <button
                onClick={copyKey}
                className="flex shrink-0 items-center gap-1 rounded border border-white/15 px-2 py-1.5 text-[10px] font-mono uppercase text-zinc-300 hover:bg-white/5"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-2 text-xs text-zinc-400">
              Send it as <code className="text-zinc-300">Authorization: Bearer {justCreated.key.slice(0, 12)}…</code>
              {" "}on every request. If you lose it, revoke this key and generate a new one.
            </p>
          </div>
        )}

        {loading ? (
          <p className="mt-8 font-mono text-xs uppercase text-zinc-500">Loading…</p>
        ) : keys.length === 0 ? (
          <p className="mt-6 rounded border border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-500">
            No API keys yet.
          </p>
        ) : (
          <ul className="mt-6 space-y-3">
            {keys.map((k) => (
              <li key={k.id} className="rounded border border-white/10 bg-white/[0.02] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-zinc-200">{k.name}</div>
                    <div className="mt-1 font-mono text-[10px] text-zinc-500">{k.key_prefix}</div>
                    <div className="mt-1 text-[10px] font-mono text-zinc-500">
                      Created {new Date(k.created_at).toLocaleDateString()}
                      {k.last_used_at ? ` · Last used ${new Date(k.last_used_at).toLocaleString()}` : " · Never used"}
                    </div>
                    <div className="mt-1 text-[10px] font-mono text-zinc-500">
                      {(activityByKey[k.id]?.callsToday ?? 0)} call{(activityByKey[k.id]?.callsToday ?? 0) === 1 ? "" : "s"} today
                      {activityByKey[k.id]?.lastDecision && (
                        <>
                          {" · Last verdict: "}
                          <span className={decisionColorClass(activityByKey[k.id]?.lastDecision ?? null)}>
                            {activityByKey[k.id]?.lastDecision}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {k.revoked_at ? (
                      <span className="rounded border border-white/15 px-2 py-1 text-[10px] font-mono uppercase text-zinc-500">
                        Revoked
                      </span>
                    ) : (
                      <>
                        <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-mono uppercase text-emerald-300">
                          Active
                        </span>
                        <button
                          onClick={() => setExpandedKeyId(expandedKeyId === k.id ? null : k.id)}
                          className="flex items-center gap-1 rounded border border-white/15 px-2 py-1.5 text-[10px] font-mono uppercase text-zinc-300 hover:bg-white/5"
                        >
                          <Settings className="h-3.5 w-3.5" />
                          Settings
                          {expandedKeyId === k.id ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                        {canWrite && (
                          <button
                            onClick={() => revoke(k)}
                            className="flex items-center gap-1 rounded border border-rose-500/30 px-2 py-1.5 text-[10px] font-mono uppercase text-rose-300 hover:bg-rose-500/10"
                          >
                            <Ban className="h-3.5 w-3.5" /> Revoke
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {expandedKeyId === k.id && !k.revoked_at && (
                  <ApiKeySettingsPanel
                    keyId={k.id}
                    accountId={accountId}
                    onUncertain={k.on_uncertain}
                    initialPersona={k.response_persona}
                    initialRateLimit={k.rate_limit_per_minute}
                    canWrite={canWrite}
                    onSaved={load}
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-10 rounded border border-white/10 bg-white/[0.02] p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <Send className="h-4 w-4 text-cyan-400" /> Test the API
          </h2>
          <p className="mt-1 text-xs text-zinc-400">
            Sends a real request to the public Control API using the key below — exactly what an external
            caller would do. Nothing here ever gets carried out; it only returns a verdict.
          </p>

          <div className="mt-4 grid gap-3">
            <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              API key
              <input
                value={testKey}
                onChange={(e) => setTestKey(e.target.value)}
                placeholder="nazai_sk_..."
                className="rounded border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-xs text-zinc-200"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                action_type
                <input
                  value={testActionType}
                  onChange={(e) => setTestActionType(e.target.value)}
                  className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-200"
                />
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                provider
                <input
                  value={testProvider}
                  onChange={(e) => setTestProvider(e.target.value)}
                  className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-200"
                />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              description
              <input
                value={testDescription}
                onChange={(e) => setTestDescription(e.target.value)}
                className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-200"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              params (JSON)
              <textarea
                value={testParams}
                onChange={(e) => setTestParams(e.target.value)}
                rows={3}
                className="rounded border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-xs text-zinc-200"
              />
            </label>
            <div className="flex items-center gap-4 text-xs text-zinc-300">
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Mode</span>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="test-mode" checked={testMode === "fast"} onChange={() => setTestMode("fast")} className="accent-cyan-500" />
                fast (deterministic only)
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="test-mode" checked={testMode === "full"} onChange={() => setTestMode("full")} className="accent-cyan-500" />
                full (LLM-scored)
              </label>
            </div>
            <button
              disabled={testBusy}
              onClick={runTest}
              className="flex w-fit items-center gap-1.5 rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 font-mono text-[11px] uppercase text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" /> {testBusy ? "Sending…" : "Send test request"}
            </button>
          </div>

          {testResult && (
            <div className="mt-4 rounded border border-white/10 bg-black/40 p-3">
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider">
                <span className={testResult.status >= 200 && testResult.status < 300 ? "text-emerald-400" : "text-rose-400"}>
                  HTTP {testResult.status || "network error"}
                </span>
                {typeof testResult.body.verdict === "string" && (
                  <span
                    className={
                      testResult.body.verdict === "allow"
                        ? "text-emerald-400"
                        : testResult.body.verdict === "block"
                        ? "text-rose-400"
                        : "text-amber-400"
                    }
                  >
                    verdict: {String(testResult.body.verdict)}
                  </span>
                )}
              </div>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-[11px] text-zinc-300">
                {JSON.stringify(testResult.body, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/**
 * "/respond" MVP backlog, item 166: a real settings panel for the three
 * per-key things that previously shipped API-only (response_persona,
 * api_key_context_entries, rate_limit_per_minute) -- deliberately NOT a
 * new endpoint: persona/rate-limit write through the existing
 * POST /api-keys/:id/policy (on_uncertain is a required field on every
 * call to that route, so it's always sent back unchanged), and context
 * entries through the existing GET/POST/DELETE /api-keys/:id/context.
 * There's no update-entry endpoint on the backend, so this only supports
 * add/delete for entries, matching exactly what's actually there.
 */
function ApiKeySettingsPanel({
  keyId,
  accountId,
  onUncertain,
  initialPersona,
  initialRateLimit,
  canWrite,
  onSaved,
}: {
  keyId: string;
  accountId: string | null;
  onUncertain: string;
  initialPersona: string | null;
  initialRateLimit: number | null;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [persona, setPersona] = useState(initialPersona ?? "");
  const [rateLimit, setRateLimit] = useState(initialRateLimit != null ? String(initialRateLimit) : "");
  const [savingSettings, setSavingSettings] = useState(false);

  const [entries, setEntries] = useState<ContextEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [newEntryText, setNewEntryText] = useState("");
  const [addingEntry, setAddingEntry] = useState(false);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    setEntriesLoading(true);
    const qs = accountId ? `?account_id=${encodeURIComponent(accountId)}` : "";
    const { data, error } = await supabase.functions.invoke(`api-keys/${keyId}/context${qs}`, { method: "GET" });
    const res = (data ?? {}) as { ok?: boolean; entries?: ContextEntry[]; error?: string };
    if (error || !res.ok) {
      toast({ title: "Couldn't load context entries", description: res.error || error?.message, variant: "destructive" });
    } else {
      setEntries(res.entries ?? []);
    }
    setEntriesLoading(false);
  }, [keyId, accountId]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  const saveSettings = async () => {
    const trimmedPersona = persona.trim();
    if (trimmedPersona.length > 500) {
      toast({ title: "Persona too long", description: "Keep it to 500 characters or fewer.", variant: "destructive" });
      return;
    }
    let rateLimitValue: number | null = null;
    if (rateLimit.trim()) {
      const parsed = Number(rateLimit.trim());
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 6000) {
        toast({ title: "Invalid rate limit", description: "Must be a whole number between 1 and 6000, or blank for the default.", variant: "destructive" });
        return;
      }
      rateLimitValue = parsed;
    }
    setSavingSettings(true);
    const { data, error } = await supabase.functions.invoke(`api-keys/${keyId}/policy`, {
      body: {
        account_id: accountId,
        on_uncertain: onUncertain,
        response_persona: trimmedPersona || null,
        rate_limit_per_minute: rateLimitValue,
      },
    });
    setSavingSettings(false);
    const res = (data ?? {}) as { ok?: boolean; error?: string };
    if (error || !res.ok) {
      toast({ title: "Couldn't save settings", description: res.error || error?.message, variant: "destructive" });
      return;
    }
    toast({ title: "Settings saved" });
    onSaved();
  };

  const addEntry = async () => {
    const trimmed = newEntryText.trim();
    if (!trimmed) return;
    if (trimmed.length > 2000) {
      toast({ title: "Entry too long", description: "Keep each entry to 2000 characters or fewer.", variant: "destructive" });
      return;
    }
    setAddingEntry(true);
    const { data, error } = await supabase.functions.invoke(`api-keys/${keyId}/context`, {
      body: { account_id: accountId, entry_text: trimmed },
    });
    setAddingEntry(false);
    const res = (data ?? {}) as { ok?: boolean; error?: string };
    if (error || !res.ok) {
      toast({ title: "Couldn't add that entry", description: res.error || error?.message, variant: "destructive" });
      return;
    }
    setNewEntryText("");
    loadEntries();
  };

  const deleteEntry = async (entryId: string) => {
    setDeletingEntryId(entryId);
    const { data, error } = await supabase.functions.invoke(`api-keys/${keyId}/context`, {
      method: "DELETE",
      body: { account_id: accountId, entry_id: entryId },
    });
    setDeletingEntryId(null);
    const res = (data ?? {}) as { ok?: boolean; error?: string };
    if (error || !res.ok) {
      toast({ title: "Couldn't remove that entry", description: res.error || error?.message, variant: "destructive" });
      return;
    }
    setEntries((prev) => prev.filter((e) => e.id !== entryId));
  };

  return (
    <div className="mt-3 space-y-4 rounded border border-white/10 bg-black/20 p-3">
      <div>
        <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
          Tone (for POST /respond)
          <textarea
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            disabled={!canWrite}
            placeholder="e.g. Warm, concise, first names, no corporate jargon."
            rows={2}
            maxLength={500}
            className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-200 disabled:opacity-50"
          />
        </label>
        <p className="mt-0.5 text-right text-[10px] font-mono text-zinc-600">{persona.length}/500</p>
      </div>

      <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
        Rate limit (requests/minute — blank for platform default)
        <input
          type="number"
          min={1}
          max={6000}
          value={rateLimit}
          onChange={(e) => setRateLimit(e.target.value)}
          disabled={!canWrite}
          placeholder="platform default"
          className="w-40 rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-200 disabled:opacity-50"
        />
      </label>

      {canWrite && (
        <button
          onClick={saveSettings}
          disabled={savingSettings}
          className="flex w-fit items-center gap-1.5 rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 font-mono text-[11px] uppercase text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {savingSettings ? "Saving…" : "Save settings"}
        </button>
      )}

      <div className="border-t border-white/5 pt-3">
        <h3 className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
          <MessageSquareText className="h-3.5 w-3.5" /> Context for /respond
        </h3>
        <p className="mt-1 text-[11px] text-zinc-500">
          Facts this key's <span className="font-mono">POST /respond</span> answers from — never leaks into any other key.
        </p>

        {entriesLoading ? (
          <p className="mt-2 font-mono text-[10px] uppercase text-zinc-600">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="mt-2 text-[11px] text-zinc-600">No context entries yet.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {entries.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-2 rounded border border-white/5 bg-white/[0.02] px-2 py-1.5">
                <span className="flex-1 text-[11px] text-zinc-300">{e.entry_text}</span>
                {canWrite && (
                  <button
                    onClick={() => deleteEntry(e.id)}
                    disabled={deletingEntryId === e.id}
                    className="shrink-0 text-zinc-500 hover:text-rose-400 disabled:opacity-50"
                    aria-label="Remove entry"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canWrite && (
          <div className="mt-2 flex items-start gap-2">
            <textarea
              value={newEntryText}
              onChange={(e) => setNewEntryText(e.target.value)}
              placeholder="e.g. Refunds are processed within 5-7 business days."
              rows={2}
              maxLength={2000}
              className="flex-1 rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-200"
            />
            <button
              onClick={addEntry}
              disabled={addingEntry || !newEntryText.trim()}
              className="flex shrink-0 items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/10 px-2 py-1.5 font-mono text-[10px] uppercase text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
