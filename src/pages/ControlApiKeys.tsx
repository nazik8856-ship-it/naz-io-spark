import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, KeyRound, Plus, Copy, Ban, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
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
};

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
  const { user } = useAuth();
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [justCreated, setJustCreated] = useState<{ key: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await anyDb
      .from("api_keys")
      .select("id, name, key_prefix, scopes, last_used_at, revoked_at, expires_at, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) toast({ title: "Couldn't load API keys", description: error.message, variant: "destructive" });
    setKeys((data ?? []) as unknown as ApiKeyRow[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast({ title: "Name it first", description: "e.g. \"Production integration\"", variant: "destructive" });
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("api-keys", { body: { name: trimmed } });
    setBusy(false);
    const res = (data ?? {}) as { ok?: boolean; key?: string; name?: string; error?: string };
    if (error || !res.ok || !res.key) {
      toast({ title: "Couldn't create the key", description: res.error || error?.message, variant: "destructive" });
      return;
    }
    setName("");
    setJustCreated({ key: res.key, name: res.name || trimmed });
    setCopied(false);
    load();
  };

  const revoke = async (row: ApiKeyRow) => {
    const { data, error } = await supabase.functions.invoke(`api-keys/${row.id}/revoke`, { body: {} });
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
                          onClick={() => revoke(k)}
                          className="flex items-center gap-1 rounded border border-rose-500/30 px-2 py-1.5 text-[10px] font-mono uppercase text-rose-300 hover:bg-rose-500/10"
                        >
                          <Ban className="h-3.5 w-3.5" /> Revoke
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
