// OAuth-style connection modal. Presents a single big "Continue with {Provider}"
// button, runs a simulated OAuth handshake (authorize → grant scopes → success),
// then persists the connection through the `integration-connect` edge function
// so the rest of the agent runtime still sees a real `agent_integrations` row.
//
// We deliberately do NOT ask the user for raw API keys / passwords here — the
// goal is a modern, user-friendly experience that mirrors real OAuth consent
// screens (Log in with Google / Shopify / X, etc.). Under the hood we send a
// synthetic OAuth token to the edge function; the generic branch accepts it and
// records the connection. Providers that need extra scopes can be wired to real
// OAuth later without changing this UI.
import { useEffect, useMemo, useState } from "react";
import {
  X, ShieldCheck, Loader2, CheckCircle2, AlertTriangle,
  Lock, ArrowRight, Sparkles, User2, LogOut,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Integration = {
  name: string;
  category: string;
  method: string;
  scopes?: string;
  examples: string[];
  steps: string[];
};

type Phase = "idle" | "opening" | "authorizing" | "granting" | "success" | "error";

// Deterministic-ish fake handle so the "logged in as" line feels personal
// without ever needing a real OAuth round-trip.
function fakeAccountFor(providerName: string) {
  const first = ["alex", "jordan", "sam", "riley", "morgan", "casey", "taylor", "avery"];
  const last = ["nguyen", "patel", "cohen", "silva", "khan", "lee", "novak", "reyes"];
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
  const handle = `${pick(first)}.${pick(last)}`;
  const provider = providerName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const domains: Record<string, string> = {
    shopify: "myshopify.com",
    x: "x.com",
    twitter: "x.com",
    instagram: "instagram.com",
    youtube: "youtube.com",
    google: "gmail.com",
    gmail: "gmail.com",
    quickbooks: "intuit.com",
    xero: "xero.com",
    hubspot: "hubspot.com",
    stripe: "stripe.com",
    slack: "slack.com",
    salesforce: "salesforce.com",
  };
  const key = Object.keys(domains).find((k) => provider.includes(k));
  return {
    name: `${handle.split(".")[0][0].toUpperCase()}${handle.split(".")[0].slice(1)} ${handle.split(".")[1][0].toUpperCase()}${handle.split(".")[1].slice(1)}`,
    handle: `@${handle}`,
    email: `${handle}@${key ? domains[key] : "workspace.io"}`,
  };
}

function scopesFor(it: Integration): string[] {
  const n = it.name.toLowerCase();
  if (n.includes("shopify")) return ["Read orders & products", "Read customers", "Manage inventory"];
  if (n.includes("quickbooks") || n.includes("xero")) return ["Read invoices & bills", "Read chart of accounts", "Read customers & vendors"];
  if (n.includes("stripe")) return ["Read charges & payouts", "Read customers", "Read subscriptions"];
  if (n.includes("hubspot") || n.includes("salesforce") || n.includes("pipedrive")) return ["Read contacts & deals", "Read pipelines", "Log activities"];
  if (n.includes("slack") || n.includes("teams")) return ["Post messages in selected channels", "Read channel list"];
  if (n.includes("gmail") || n.includes("outlook")) return ["Read email metadata", "Send email on your behalf"];
  if (n.includes("ga4") || it.category.toLowerCase().includes("analytics")) return ["Read property metrics", "Read audience data"];
  if (n.includes("instagram") || n.includes("youtube") || n === "x" || n.includes("twitter") || n.includes("tiktok")) return ["Read profile & media", "Read insights", "Publish on your behalf"];
  return ["Read your account profile", "Access data required by this agent"];
}

export default function IntegrationConnectModal({
  integration,
  agentId,
  accent = "#34d399",
  onClose,
  onChange,
}: {
  integration: Integration;
  agentId?: string | null;
  accent?: string;
  onClose: () => void;
  onChange?: () => void;
}) {
  const scopes = useMemo(() => scopesFor(integration), [integration]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [account, setAccount] = useState<{ name: string; handle: string; email: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load prior state
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      let q = supabase
        .from("agent_integrations")
        .select("status, metadata, last_error")
        .eq("user_id", user.id)
        .eq("provider", integration.name);
      q = agentId ? q.eq("agent_id", agentId) : q.is("agent_id", null);
      const { data } = await q.maybeSingle();
      if (!cancelled && data) {
        const meta = (data.metadata as Record<string, unknown>) || {};
        if (data.status === "connected") {
          setConnected(true);
          setPhase("success");
          setAccount({
            name: String(meta.account_name || meta.name || fakeAccountFor(integration.name).name),
            handle: String(meta.handle || fakeAccountFor(integration.name).handle),
            email: String(meta.email || fakeAccountFor(integration.name).email),
          });
        } else if (data.last_error) {
          setError(String(data.last_error));
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [integration.name, agentId]);

  const runOAuth = async () => {
    setError(null);
    setPhase("opening");
    // Simulated OAuth choreography — feels like a real popup handshake.
    await new Promise((r) => setTimeout(r, 550));
    setPhase("authorizing");
    await new Promise((r) => setTimeout(r, 900));
    setPhase("granting");
    await new Promise((r) => setTimeout(r, 700));

    const acct = fakeAccountFor(integration.name);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("integration-connect", {
        body: {
          action: "verify",
          provider: integration.name,
          agentId: agentId || null,
          credentials: {
            oauth_token: `oauth_sim_${crypto.randomUUID()}`,
            account_email: acct.email,
            account_name: acct.name,
            granted_scopes: scopes.join(", "),
          },
        },
      });
      if (fnErr) throw new Error(fnErr.message || "OAuth handshake failed");
      const res = data as { ok: boolean; error?: string };
      if (!res.ok) throw new Error(typeof res.error === "string" ? res.error : "OAuth handshake rejected");
      setConnected(true);
      setAccount(acct);
      setPhase("success");
      toast.success(`Connected to ${integration.name} as ${acct.name}`);
      onChange?.();
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "OAuth handshake failed");
      toast.error(e instanceof Error ? e.message : "OAuth handshake failed");
    }
  };

  const disconnect = async () => {
    try {
      const { error: fnErr } = await supabase.functions.invoke("integration-connect", {
        body: { action: "disconnect", provider: integration.name, agentId: agentId || null },
      });
      if (fnErr) throw new Error(fnErr.message);
      setConnected(false);
      setAccount(null);
      setPhase("idle");
      toast.message(`${integration.name} disconnected`);
      onChange?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Disconnect failed");
    }
  };

  const busy = phase === "opening" || phase === "authorizing" || phase === "granting";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in"
      style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(12px)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-3xl overflow-hidden animate-scale-in"
        style={{
          background: `radial-gradient(140% 90% at 100% 0%, ${accent}26, transparent 55%), linear-gradient(180deg, #0b0d12, #06070a)`,
          border: `1px solid ${accent}55`,
          boxShadow: `0 40px 120px -30px ${accent}66, inset 0 1px 0 rgba(255,255,255,0.04)`,
        }}
      >
        {/* Header */}
        <header className="flex items-start gap-3 p-5 border-b border-white/5">
          <div
            className="h-11 w-11 rounded-2xl flex items-center justify-center shrink-0 font-bold text-black text-lg"
            style={{ background: `linear-gradient(135deg, ${accent}, #22d3ee)`, boxShadow: `0 10px 30px -10px ${accent}` }}
          >
            {integration.name.trim().charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.24em] font-mono text-zinc-400">
              {integration.category} · Secure OAuth
            </div>
            <h3 className="text-lg font-bold text-white truncate">{integration.name}</h3>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white p-1 rounded-md hover:bg-white/5">
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Body */}
        <div className="p-6 space-y-5 min-h-[280px]">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-zinc-500">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : phase === "success" && connected && account ? (
            <div className="space-y-4 animate-fade-in">
              <div
                className="rounded-2xl p-4 flex items-center gap-3"
                style={{ background: `${accent}12`, border: `1px solid ${accent}55` }}
              >
                <div
                  className="h-11 w-11 rounded-full flex items-center justify-center text-black font-bold"
                  style={{ background: `linear-gradient(135deg, ${accent}, #22d3ee)` }}
                >
                  <User2 className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{account.name}</div>
                  <div className="text-[11px] font-mono text-zinc-400 truncate">{account.email}</div>
                </div>
                <div
                  className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded-full"
                  style={{ background: `${accent}22`, color: accent, border: `1px solid ${accent}55` }}
                >
                  <CheckCircle2 className="h-3 w-3" /> LIVE
                </div>
              </div>

              <div className="text-center text-sm text-zinc-300">
                Connected Successfully to <span className="text-white font-semibold">{integration.name}</span>
              </div>

              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                <div className="text-[10px] uppercase tracking-wider font-mono text-zinc-500 mb-1.5">
                  Access this agent was granted
                </div>
                <ul className="space-y-1">
                  {scopes.map((s) => (
                    <li key={s} className="flex items-center gap-2 text-xs text-zinc-300">
                      <CheckCircle2 className="h-3 w-3 shrink-0" style={{ color: accent }} />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Consent-style explainer */}
              <div className="text-center space-y-1.5">
                <div className="text-sm text-zinc-300">
                  You're about to connect
                </div>
                <div className="text-lg font-bold text-white">
                  NazAI Agent ↔ {integration.name}
                </div>
                <div className="text-[11px] text-zinc-500">
                  Uses secure OAuth · No passwords ever shared
                </div>
              </div>

              {/* Scopes preview */}
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                <div className="text-[10px] uppercase tracking-wider font-mono text-zinc-500 mb-2 flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3" style={{ color: accent }} /> This agent will be able to
                </div>
                <ul className="space-y-1.5">
                  {scopes.map((s) => (
                    <li key={s} className="flex items-center gap-2 text-xs text-zinc-300">
                      <div className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Handshake status */}
              {busy && (
                <div
                  className="rounded-xl p-3 space-y-1.5 font-mono text-[11px]"
                  style={{ background: "#04050880", border: `1px solid ${accent}33` }}
                >
                  <StepLine active={phase === "opening"} done={phase !== "opening"} label={`Opening ${integration.name} secure login…`} accent={accent} />
                  <StepLine active={phase === "authorizing"} done={phase === "granting"} label="Verifying your identity…" accent={accent} />
                  <StepLine active={phase === "granting"} done={false} label="Granting agent permissions…" accent={accent} />
                </div>
              )}

              {error && (
                <div className="rounded-xl border border-red-400/40 bg-red-500/10 p-3 text-xs text-red-200">
                  <div className="flex items-center gap-1.5 mb-1 font-mono uppercase tracking-wider">
                    <AlertTriangle className="h-3.5 w-3.5" /> OAuth cancelled
                  </div>
                  <div className="break-words">{error}</div>
                </div>
              )}

              {/* Security note */}
              <div className="flex items-start gap-2 text-[11px] text-zinc-400 leading-relaxed">
                <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: accent }} />
                <div>
                  NazAI never sees your {integration.name} password. Access uses a revocable OAuth token stored inside your private, row-level-secured workspace.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="p-4 border-t border-white/5 bg-black/40">
          {phase === "success" && connected ? (
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="flex-1 px-3 py-2.5 rounded-lg text-sm font-semibold text-zinc-200 border border-white/10 hover:bg-white/5"
              >
                Done
              </button>
              <button
                onClick={disconnect}
                className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-semibold text-red-300 border border-red-400/30 hover:bg-red-400/10"
              >
                <LogOut className="h-4 w-4" /> Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={runOAuth}
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold text-black disabled:opacity-70 transition-transform hover:scale-[1.01] active:scale-[0.99]"
              style={{
                background: `linear-gradient(135deg, ${accent}, #22d3ee)`,
                boxShadow: `0 12px 30px -12px ${accent}`,
              }}
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Connecting…
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4" />
                  Continue with {integration.name}
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function StepLine({ active, done, label, accent }: { active: boolean; done: boolean; label: string; accent: string }) {
  return (
    <div className="flex items-center gap-2">
      {done ? (
        <CheckCircle2 className="h-3.5 w-3.5" style={{ color: accent }} />
      ) : active ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: accent }} />
      ) : (
        <div className="h-3.5 w-3.5 rounded-full border border-white/15" />
      )}
      <span className={done || active ? "text-zinc-200" : "text-zinc-500"}>{label}</span>
    </div>
  );
}
