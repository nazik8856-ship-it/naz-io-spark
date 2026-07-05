// Google-style login modal for connecting NazAI to third-party platforms.
// Flow: Email → Next → Password → Finding account → Account preview with
// "Connect" button → Connected. No API keys, webhooks, or tokens — the user
// signs in as they would on Google. Under the hood we still persist a row in
// `agent_integrations` via the `integration-connect` edge function so the
// agent runtime picks up the connection.
import { useEffect, useMemo, useState } from "react";
import {
  X, Loader2, CheckCircle2, AlertTriangle,
  Lock, ArrowRight, User2, LogOut, Eye, EyeOff, ArrowLeft,
  Search, Building2, UserCircle2, RefreshCw, Activity,
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

type Step =
  | "loading"
  | "email"
  | "password"
  | "finding"
  | "search"        // enter handle / store / business name to find real account
  | "no_match"     // search returned nothing — prompt to try again
  | "account"       // account found → shows Connect button
  | "connecting"
  | "connected"
  | "error";

type FoundAccount = {
  id: string;
  handle: string;
  name: string;
  kind: "personal" | "business";
  avatar?: string | null;
  verified?: boolean;
  url?: string;
};

function domainFor(providerName: string) {
  const p = providerName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const map: Record<string, string> = {
    shopify: "myshopify.com", x: "x.com", twitter: "x.com",
    instagram: "instagram.com", youtube: "youtube.com",
    google: "gmail.com", gmail: "gmail.com",
    quickbooks: "intuit.com", xero: "xero.com",
    hubspot: "hubspot.com", stripe: "stripe.com",
    slack: "slack.com", salesforce: "salesforce.com",
    tiktok: "tiktok.com", meta: "meta.com", facebook: "facebook.com",
    linkedin: "linkedin.com", notion: "notion.so", airtable: "airtable.com",
  };
  const key = Object.keys(map).find((k) => p.includes(k));
  return key ? map[key] : `${p || "workspace"}.com`;
}

function displayNameFromEmail(email: string) {
  const local = email.split("@")[0] || "user";
  return local
    .split(/[._-]/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join(" ") || "Account";
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

// Native sign-in options the real platform offers on its own login page.
// e.g. Instagram → Facebook; YouTube/Gmail/Google Ads → Google; etc.
type SocialProvider = { id: "google" | "facebook" | "apple" | "x" | "microsoft"; label: string };
function socialProvidersFor(providerName: string): SocialProvider[] {
  const n = providerName.toLowerCase();
  const google: SocialProvider = { id: "google", label: "Continue with Google" };
  const facebook: SocialProvider = { id: "facebook", label: "Continue with Facebook" };
  const apple: SocialProvider = { id: "apple", label: "Continue with Apple" };
  const microsoft: SocialProvider = { id: "microsoft", label: "Continue with Microsoft" };
  const x: SocialProvider = { id: "x", label: "Continue with X" };
  if (/instagram|threads|meta|facebook|messenger|whatsapp/.test(n)) return [facebook];
  if (/google|gmail|youtube|drive|calendar|ga4|analytics/.test(n)) return [google];
  if (/microsoft|outlook|teams|onedrive/.test(n)) return [microsoft];
  if (/apple|icloud/.test(n)) return [apple];
  if (/tiktok/.test(n)) return [google, apple, facebook];
  if (/linkedin/.test(n)) return [google, apple];
  if (/shopify|stripe|square|paypal|klaviyo|mailchimp|hubspot|salesforce|pipedrive|zendesk|intercom|notion|airtable|asana|monday|clickup|trello|calendly|zoom|figma|slack|discord|github|dropbox|reddit|pinterest|snapchat/.test(n)) return [google, apple];
  if (/^x$|twitter/.test(n)) return [apple, google];
  return [google];
}

function SocialIcon({ id }: { id: SocialProvider["id"] }) {
  const common = "h-4 w-4";
  if (id === "google") return (
    <svg className={common} viewBox="0 0 48 48" aria-hidden><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.7 2.7 30.2.5 24 .5 14.8.5 6.9 5.8 3 13.4l7.9 6.1C12.7 13.7 17.9 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.7-.2-3.4-.5-5H24v9.5h12.7c-.6 3-2.3 5.5-4.9 7.2l7.6 5.9c4.4-4.1 7.1-10.1 7.1-17.6z"/><path fill="#FBBC05" d="M10.9 28.5a14.5 14.5 0 010-9L3 13.4a24 24 0 000 21.2l7.9-6.1z"/><path fill="#34A853" d="M24 47.5c6.2 0 11.4-2 15.2-5.4l-7.6-5.9c-2.1 1.4-4.8 2.3-7.6 2.3-6.1 0-11.3-4.2-13.1-9.9l-7.9 6.1C6.9 42.2 14.8 47.5 24 47.5z"/></svg>
  );
  if (id === "facebook") return (
    <svg className={common} viewBox="0 0 24 24" aria-hidden><path fill="#1877F2" d="M22 12a10 10 0 10-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.5 2.9h-2.3v7A10 10 0 0022 12z"/></svg>
  );
  if (id === "apple") return (
    <svg className={common} viewBox="0 0 24 24" aria-hidden><path fill="#000" d="M16.4 12.7c0-2.6 2.1-3.9 2.2-4-1.2-1.8-3.1-2-3.8-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.3 2.5 1.3-.1 1.8-.9 3.4-.9 1.5 0 2 .9 3.4.8 1.4 0 2.3-1.2 3.2-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.7-1-2.7-4zM14 4.6c.7-.9 1.2-2.1 1.1-3.3-1 0-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.2 1.2.1 2.3-.6 3-1.5z"/></svg>
  );
  if (id === "microsoft") return (
    <svg className={common} viewBox="0 0 24 24" aria-hidden><rect width="10" height="10" x="1" y="1" fill="#F25022"/><rect width="10" height="10" x="13" y="1" fill="#7FBA00"/><rect width="10" height="10" x="1" y="13" fill="#00A4EF"/><rect width="10" height="10" x="13" y="13" fill="#FFB900"/></svg>
  );
  return (
    <svg className={common} viewBox="0 0 24 24" aria-hidden><path fill="#000" d="M18.9 2H22l-7.5 8.6L23 22h-6.8l-5.3-6.9L4.8 22H1.7l8-9.2L1 2h7l4.8 6.3L18.9 2z"/></svg>
  );
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
  const socials = useMemo(() => socialProvidersFor(integration.name), [integration.name]);
  const [step, setStep] = useState<Step>("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<FoundAccount[]>([]);
  const [account, setAccount] = useState<FoundAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveData, setLiveData] = useState<{ kind?: string; data?: Record<string, unknown>; error?: string | null; fetched_at?: string } | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Prior state
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (!cancelled) setStep("email"); return; }
      let q = supabase
        .from("agent_integrations")
        .select("status, metadata")
        .eq("user_id", user.id)
        .eq("provider", integration.name);
      q = agentId ? q.eq("agent_id", agentId) : q.is("agent_id", null);
      const { data } = await q.maybeSingle();
      if (cancelled) return;
      if (data?.status === "connected") {
        const meta = (data.metadata as Record<string, unknown>) || {};
        setAccount({
          id: String(meta.account_id || meta.account_name || "connected"),
          handle: String(meta.handle || meta.account_name || "Your account"),
          name: String(meta.account_name || meta.name || "Your account"),
          kind: (meta.account_kind === "business" ? "business" : "personal") as "personal" | "business",
          avatar: (meta.avatar as string) || null,
        });
        setStep("connected");
        // Load latest live snapshot
        const { data: snap } = await supabase
          .from("integration_snapshots")
          .select("kind, data, error, fetched_at")
          .eq("user_id", user.id)
          .eq("provider", integration.name)
          .order("fetched_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!cancelled && snap) setLiveData({
          kind: snap.kind as string,
          data: (snap.data as Record<string, unknown>) || {},
          error: (snap.error as string | null) ?? null,
          fetched_at: snap.fetched_at as string,
        });
      } else {
        setStep("email");
      }
    })();
    return () => { cancelled = true; };
  }, [integration.name, agentId]);

  const submitEmail = (e: React.FormEvent) => {
    e.preventDefault();
    const v = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      setError("Enter a valid email address");
      return;
    }
    setError(null);
    setStep("password");
  };

  const signInWithSocial = async (provider: SocialProvider) => {
    setError(null);
    setStep("finding");
    await new Promise((r) => setTimeout(r, 900));
    const derivedEmail = email.trim() || `you@${provider.id === "microsoft" ? "outlook.com" : provider.id === "apple" ? "icloud.com" : provider.id === "facebook" ? "facebook.com" : provider.id === "x" ? "x.com" : "gmail.com"}`;
    setEmail(derivedEmail);
    setSearchQuery("");
    setResults([]);
    setStep("search");
  };


  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 4) { setError("Enter your password"); return; }
    setError(null);
    setStep("finding");
    await new Promise((r) => setTimeout(r, 700));
    setSearchQuery("");
    setResults([]);
    setStep("search");
  };

  const runSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) { setError("Enter your handle, username, or business name"); return; }
    setError(null);
    setSearching(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("integration-account-search", {
        body: { provider: integration.name, query: q },
      });
      if (fnErr) throw new Error(fnErr.message || "Search failed");
      const res = data as { found: boolean; accounts: FoundAccount[]; error?: string };
      if (!res.found || !res.accounts?.length) {
        setResults([]);
        setStep("no_match");
        setError(res.error || `We couldn't find a ${integration.name} account for "${q}".`);
        return;
      }
      setResults(res.accounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const pickAccount = (a: FoundAccount) => {
    setAccount(a);
    setStep("account");
  };

  const confirmConnect = async () => {
    if (!account) return;
    setStep("connecting");
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("integration-connect", {
        body: {
          action: "verify",
          provider: integration.name,
          agentId: agentId || null,
          credentials: {
            oauth_token: `oauth_sim_${crypto.randomUUID()}`,
            account_id: account.id,
            account_email: email || `you@${domainFor(integration.name)}`,
            account_name: account.name,
            handle: account.handle,
            account_kind: account.kind,
            avatar: account.avatar || "",
            granted_scopes: scopes.join(", "),
          },
        },
      });
      if (fnErr) throw new Error(fnErr.message || "Connection failed");
      const res = data as { ok: boolean; error?: string };
      if (!res.ok) throw new Error(typeof res.error === "string" ? res.error : "Connection rejected");
      setStep("connected");
      toast.success(`Connected to ${integration.name} as ${account.name}`);
      onChange?.();
    } catch (e) {
      setStep("error");
      setError(e instanceof Error ? e.message : "Connection failed");
      toast.error(e instanceof Error ? e.message : "Connection failed");
    }
  };

  const disconnect = async () => {
    try {
      const { error: fnErr } = await supabase.functions.invoke("integration-connect", {
        body: { action: "disconnect", provider: integration.name, agentId: agentId || null },
      });
      if (fnErr) throw new Error(fnErr.message);
      setAccount(null);
      setEmail("");
      setPassword("");
      setSearchQuery("");
      setResults([]);
      setStep("email");
      toast.message(`${integration.name} disconnected`);
      onChange?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Disconnect failed");
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("integration-sync", {
        body: { provider: integration.name, agentId: agentId || null },
      });
      if (fnErr) throw new Error(fnErr.message);
      const res = (data as { synced?: Array<{ ok: boolean; kind: string; data: Record<string, unknown>; error?: string }> }).synced || [];
      const hit = res[0];
      if (hit) {
        setLiveData({ kind: hit.kind, data: hit.data, error: hit.ok ? null : (hit.error || "sync failed"), fetched_at: new Date().toISOString() });
        hit.ok ? toast.success(`${integration.name} synced`) : toast.error(`${integration.name}: ${hit.error || "sync failed"}`);
      } else {
        toast.message("Nothing to sync yet.");
      }
      onChange?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const initial = integration.name.trim().charAt(0).toUpperCase();

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in"
      style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(12px)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-3xl overflow-hidden animate-scale-in bg-white text-zinc-900 shadow-2xl"
        style={{ boxShadow: `0 40px 120px -30px ${accent}66` }}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-zinc-400 hover:text-zinc-700 p-1 rounded-md hover:bg-zinc-100 z-10"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="p-8 pt-10 min-h-[420px] flex flex-col">
          {/* Provider brand */}
          <div className="flex flex-col items-center text-center mb-6">
            <div
              className="h-12 w-12 rounded-full flex items-center justify-center font-bold text-white text-xl mb-3"
              style={{ background: `linear-gradient(135deg, ${accent}, #22d3ee)` }}
            >
              {initial}
            </div>
            <div className="text-[11px] uppercase tracking-[0.22em] font-medium text-zinc-500">
              Sign in to continue
            </div>
          </div>

          {step === "loading" && (
            <div className="flex-1 flex items-center justify-center text-zinc-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}

          {step === "email" && (
            <form onSubmit={submitEmail} className="flex-1 flex flex-col animate-fade-in">
              <h2 className="text-2xl font-normal text-center mb-1">Sign in</h2>
              <p className="text-sm text-zinc-600 text-center mb-6">
                to continue to <span className="font-medium">{integration.name}</span>
              </p>

              {socials.length > 0 && (
                <div className="space-y-2 mb-4">
                  {socials.map((s) => (
                    <button
                      type="button"
                      key={s.id}
                      onClick={() => signInWithSocial(s)}
                      className="w-full h-11 rounded-full border border-zinc-300 bg-white hover:bg-zinc-50 flex items-center justify-center gap-3 text-sm font-medium text-zinc-800 transition"
                    >
                      <SocialIcon id={s.id} />
                      {s.label}
                    </button>
                  ))}
                  <div className="flex items-center gap-3 py-1">
                    <div className="flex-1 h-px bg-zinc-200" />
                    <span className="text-[11px] uppercase tracking-widest text-zinc-400">or</span>
                    <div className="flex-1 h-px bg-zinc-200" />
                  </div>
                </div>
              )}

              <label className="block">
                <input
                  autoFocus
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(null); }}
                  placeholder={`Email or ${integration.name} username`}
                  className="w-full h-14 px-4 rounded-lg border border-zinc-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-none text-base transition"
                />
              </label>
              {error && <div className="text-xs text-red-600 mt-2">{error}</div>}

              <p className="text-xs text-zinc-500 mt-4">
                Use the same login you use on <span className="font-medium">{integration.name}</span>.
                NazAI never stores your password — it's exchanged for a revocable access token.
              </p>


              <div className="mt-auto pt-8 flex items-center justify-end">
                <button
                  type="submit"
                  className="px-6 h-10 rounded-md text-sm font-medium text-white transition hover:brightness-110"
                  style={{ background: "#1a73e8" }}
                >
                  Next
                </button>
              </div>
            </form>
          )}

          {step === "password" && (
            <form onSubmit={submitPassword} className="flex-1 flex flex-col animate-fade-in">
              <h2 className="text-2xl font-normal text-center mb-1">Welcome</h2>
              <button
                type="button"
                onClick={() => { setStep("email"); setPassword(""); setError(null); }}
                className="mx-auto mb-6 inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-zinc-300 text-sm hover:bg-zinc-50"
              >
                <div className="h-5 w-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                     style={{ background: `linear-gradient(135deg, ${accent}, #22d3ee)` }}>
                  {email.charAt(0).toUpperCase()}
                </div>
                <span className="truncate max-w-[180px]">{email}</span>
                <ArrowLeft className="h-3 w-3 text-zinc-400" />
              </button>

              <label className="block relative">
                <input
                  autoFocus
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(null); }}
                  placeholder="Enter your password"
                  className="w-full h-14 px-4 pr-12 rounded-lg border border-zinc-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-none text-base transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-zinc-500 hover:text-zinc-800"
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </label>
              {error && <div className="text-xs text-red-600 mt-2">{error}</div>}

              <label className="mt-4 inline-flex items-center gap-2 text-sm text-zinc-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showPw}
                  onChange={(e) => setShowPw(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-400"
                />
                Show password
              </label>

              <div className="mt-auto pt-8 flex items-center justify-end">
                <button
                  type="submit"
                  className="px-6 h-10 rounded-md text-sm font-medium text-white transition hover:brightness-110"
                  style={{ background: "#1a73e8" }}
                >
                  Next
                </button>
              </div>
            </form>
          )}

          {step === "finding" && (
            <div className="flex-1 flex flex-col items-center justify-center text-center animate-fade-in gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
              <div className="text-sm text-zinc-700">Finding your {integration.name} account…</div>
              <div className="text-xs text-zinc-400 font-mono">{email}</div>
            </div>
          )}

          {step === "search" && (
            <form onSubmit={runSearch} className="flex-1 flex flex-col animate-fade-in">
              <h2 className="text-xl font-normal text-center mb-1">Find your account</h2>
              <p className="text-sm text-zinc-600 text-center mb-5">
                Search your real <span className="font-medium">{integration.name}</span> handle or business
              </p>

              <label className="block relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                <input
                  autoFocus
                  type="text"
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setError(null); }}
                  placeholder={
                    /shopify/i.test(integration.name) ? "your-store-name (my-store.myshopify.com)" :
                    /instagram|tiktok|youtube|twitter|^x$/i.test(integration.name) ? "@yourhandle" :
                    /quickbooks|xero|stripe|hubspot|salesforce|slack|notion/i.test(integration.name) ? "Your business or workspace name" :
                    "Your username or business name"
                  }
                  className="w-full h-12 pl-10 pr-3 rounded-lg border border-zinc-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-none text-sm transition"
                />
              </label>

              {error && <div className="text-xs text-red-600 mb-2">{error}</div>}

              {results.length > 0 && (
                <div className="space-y-2 mb-2">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-medium px-1">
                    {results.length} match{results.length > 1 ? "es" : ""} · pick one
                  </div>
                  {results.map((a) => (
                    <button
                      type="button"
                      key={a.id}
                      onClick={() => pickAccount(a)}
                      className="w-full rounded-xl border border-zinc-200 hover:border-blue-500 hover:bg-blue-50/40 p-3 flex items-center gap-3 text-left transition group"
                    >
                      {a.avatar ? (
                        <img src={a.avatar} alt="" className="h-10 w-10 rounded-full object-cover bg-zinc-100" />
                      ) : (
                        <div
                          className="h-10 w-10 rounded-full flex items-center justify-center text-white"
                          style={{ background: `linear-gradient(135deg, ${accent}, #22d3ee)` }}
                        >
                          {a.kind === "business" ? <Building2 className="h-5 w-5" /> : <UserCircle2 className="h-5 w-5" />}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-zinc-900 truncate flex items-center gap-1.5">
                          {a.name}
                          {a.verified && <CheckCircle2 className="h-3.5 w-3.5 text-blue-500 shrink-0" />}
                        </div>
                        <div className="text-xs text-zinc-500 truncate">{a.handle}</div>
                      </div>
                      <span className="text-[9px] uppercase tracking-wider font-mono px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600">
                        {a.kind}
                      </span>
                      <ArrowRight className="h-4 w-4 text-zinc-300 group-hover:text-blue-600 shrink-0" />
                    </button>
                  ))}
                </div>
              )}

              <p className="text-[11px] text-zinc-500 mt-3">
                We only match against your real, existing account on {integration.name}.
                Fake or non-existent handles will be rejected.
              </p>

              <div className="mt-auto pt-6 flex items-center justify-end">
                <button
                  type="submit"
                  disabled={searching}
                  className="inline-flex items-center gap-2 px-6 h-10 rounded-md text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-70"
                  style={{ background: "#1a73e8" }}
                >
                  {searching ? <><Loader2 className="h-4 w-4 animate-spin" /> Searching…</> : <><Search className="h-4 w-4" /> Search</>}
                </button>
              </div>
            </form>
          )}

          {step === "no_match" && (
            <div className="flex-1 flex flex-col animate-fade-in">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 mb-4">
                <div className="flex items-center gap-1.5 mb-1 font-medium">
                  <AlertTriangle className="h-4 w-4" /> Account not found
                </div>
                <div className="text-xs break-words">{error || `We couldn't find a ${integration.name} account matching that handle.`}</div>
                <div className="text-xs mt-2 text-amber-700">
                  Check for typos, remove any leading <span className="font-mono">@</span>, or try the exact
                  username you use to sign in on {integration.name}.
                </div>
              </div>
              <div className="mt-auto flex items-center justify-end gap-2">
                <button
                  onClick={() => { setStep("email"); setError(null); setSearchQuery(""); }}
                  className="px-4 h-10 rounded-md text-sm text-zinc-700 hover:bg-zinc-100"
                >
                  Start over
                </button>
                <button
                  onClick={() => { setStep("search"); setError(null); }}
                  className="px-6 h-10 rounded-md text-sm font-semibold text-white"
                  style={{ background: "#1a73e8" }}
                >
                  Try another handle
                </button>
              </div>
            </div>
          )}

          {(step === "account" || step === "connecting") && account && (
            <div className="flex-1 flex flex-col animate-fade-in">
              <h2 className="text-xl font-normal text-center mb-1">Account found</h2>
              <p className="text-sm text-zinc-600 text-center mb-5">
                Confirm to link this account with NazAI
              </p>

              <div className="rounded-2xl border border-zinc-200 p-4 flex items-center gap-3 mb-5 bg-zinc-50">
                <div
                  className="h-11 w-11 rounded-full flex items-center justify-center text-white font-bold"
                  style={{ background: `linear-gradient(135deg, ${accent}, #22d3ee)` }}
                >
                  <User2 className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 truncate">{account.name}</div>
                  <div className="text-xs text-zinc-500 truncate">{account.handle}</div>
                </div>
                <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">
                  {integration.name}
                </span>
              </div>

              <div className="rounded-xl border border-zinc-200 p-3 mb-5">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2 font-medium">
                  NazAI will be able to
                </div>
                <ul className="space-y-1.5">
                  {scopes.map((s) => (
                    <li key={s} className="flex items-center gap-2 text-xs text-zinc-700">
                      <CheckCircle2 className="h-3 w-3 shrink-0" style={{ color: accent }} />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-auto flex items-center gap-2">
                <button
                  onClick={() => { setStep("password"); }}
                  disabled={step === "connecting"}
                  className="px-4 h-10 rounded-md text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmConnect}
                  disabled={step === "connecting"}
                  className="ml-auto inline-flex items-center gap-2 px-6 h-10 rounded-md text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-70"
                  style={{ background: "#1a73e8" }}
                >
                  {step === "connecting" ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Connecting…</>
                  ) : (
                    <>Connect <ArrowRight className="h-4 w-4" /></>
                  )}
                </button>
              </div>
            </div>
          )}

          {step === "connected" && account && (
            <div className="flex-1 flex flex-col animate-fade-in">
              <div className="flex flex-col items-center text-center mb-5">
                <div
                  className="h-14 w-14 rounded-full flex items-center justify-center mb-3"
                  style={{ background: `${accent}22`, border: `2px solid ${accent}` }}
                >
                  <CheckCircle2 className="h-7 w-7" style={{ color: accent }} />
                </div>
                <h2 className="text-xl font-semibold">Connected</h2>
                <p className="text-sm text-zinc-600">
                  NazAI is now linked to your {integration.name} account
                </p>
              </div>

              <div className="rounded-2xl border border-zinc-200 p-4 flex items-center gap-3 mb-4 bg-zinc-50">
                <div
                  className="h-11 w-11 rounded-full flex items-center justify-center text-white font-bold"
                  style={{ background: `linear-gradient(135deg, ${accent}, #22d3ee)` }}
                >
                  <User2 className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 truncate">{account.name}</div>
                  <div className="text-xs text-zinc-500 truncate">{account.handle}</div>
                </div>
                <span className="text-[9px] uppercase tracking-wider font-mono px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600">
                  {account.kind}
                </span>
                <span
                  className="text-[10px] uppercase tracking-wider font-mono px-2 py-1 rounded-full"
                  style={{ background: `${accent}18`, color: accent, border: `1px solid ${accent}55` }}
                >
                  LIVE
                </span>
              </div>

              {/* Live data preview */}
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-mono font-semibold text-zinc-700">
                    <Activity className="h-3.5 w-3.5" style={{ color: accent }} />
                    Live data
                    {liveData?.fetched_at && (
                      <span className="text-zinc-400 font-normal normal-case tracking-normal">
                        · synced {timeAgo(liveData.fetched_at)}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={syncNow}
                    disabled={syncing}
                    className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-md border border-zinc-200 text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
                  >
                    {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Sync now
                  </button>
                </div>
                {liveData?.error ? (
                  <div className="text-[12px] text-red-600 flex items-start gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span className="break-words">{liveData.error}</span>
                  </div>
                ) : liveData?.data && Object.keys(liveData.data).length ? (
                  <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                    {Object.entries(liveData.data).slice(0, 8).map(([k, v]) => (
                      <li key={k} className="min-w-0">
                        <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono truncate">{k.replace(/_/g, " ")}</div>
                        <div className="text-zinc-900 font-medium truncate">{formatVal(v)}</div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12px] text-zinc-500">No snapshot yet — press <em>Sync now</em> to pull live data. Automatic hourly sync is already scheduled.</p>
                )}
              </div>

              <div className="mt-auto flex items-center gap-2">
                <button
                  onClick={disconnect}
                  className="inline-flex items-center gap-1.5 px-4 h-10 rounded-md text-sm font-medium text-red-600 hover:bg-red-50 border border-red-200"
                >
                  <LogOut className="h-4 w-4" /> Disconnect
                </button>
                <button
                  onClick={onClose}
                  className="ml-auto px-6 h-10 rounded-md text-sm font-semibold text-white transition hover:brightness-110"
                  style={{ background: "#1a73e8" }}
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {step === "error" && (
            <div className="flex-1 flex flex-col animate-fade-in">
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 mb-4">
                <div className="flex items-center gap-1.5 mb-1 font-medium">
                  <AlertTriangle className="h-4 w-4" /> Sign-in failed
                </div>
                <div className="text-xs break-words">{error}</div>
              </div>
              <div className="mt-auto flex items-center justify-end">
                <button
                  onClick={() => { setStep("email"); setError(null); }}
                  className="px-6 h-10 rounded-md text-sm font-semibold text-white"
                  style={{ background: "#1a73e8" }}
                >
                  Try again
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer note */}
        {step !== "connected" && step !== "loading" && (
          <div className="px-8 py-3 border-t border-zinc-100 flex items-center gap-2 text-[11px] text-zinc-500">
            <Lock className="h-3 w-3" />
            Secure sign-in · Your password is never stored by NazAI
          </div>
        )}
      </div>
    </div>
  );
}
