// Business Integrations & Setup — single entry point. The agent card shows ONE
// "Connect Business Tools" button. Clicking it opens a hub modal listing all
// supported integrations (Shopify, QuickBooks, Xero, Stripe, GA4, …). From the
// hub, each row opens the per-integration connect form (API keys, store URLs,
// tokens, OAuth one-clicks).
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plug, KeyRound, Webhook, ShieldCheck, Lock, CheckCircle2, X, Search, Sparkles,
} from "lucide-react";
import IntegrationConnectModal from "./IntegrationConnectModal";
import { supabase } from "@/integrations/supabase/client";

type Integration = {
  name: string;
  category: string;
  method: string;
  scopes?: string;
  examples: string[];
  steps: string[];
  status?: "recommended" | "optional";
};

export type IntegrationsSpec = {
  summary?: string;
  integrations: Integration[];
  security?: string[];
};

const ROLE_DEFAULTS: Record<string, IntegrationsSpec> = {
  sales_ops: {
    summary: "Plug into your CRM, mailbox and revenue tools so the agent prospects, drafts outreach and updates your pipeline against real data.",
    integrations: [
      { name: "HubSpot", category: "CRM", method: "OAuth", scopes: "contacts.read/write, deals.read/write", status: "recommended", examples: ["Create/update contacts", "Move deals through stages", "Score leads vs ICP"], steps: ["Sign in to HubSpot", "Pick workspace", "Grant contact + deal scopes"] },
      { name: "Salesforce", category: "CRM", method: "OAuth", scopes: "api, refresh_token", status: "optional", examples: ["Sync accounts and opportunities", "Run SOQL reports"], steps: ["Create Connected App", "Paste keys", "Authorize sandbox first"] },
      { name: "Pipedrive", category: "CRM", method: "API key", status: "optional", examples: ["Sync deals + activities"], steps: ["Settings → Personal → API", "Paste key"] },
      { name: "Gmail / Outlook", category: "Email", method: "OAuth", scopes: "send + drafts", status: "recommended", examples: ["Draft personalised outbound (queued for approval)", "Auto follow-ups"], steps: ["Choose mailbox", "Approve drafts scope", "Pick sender alias"] },
      { name: "Slack", category: "Notifications", method: "OAuth", status: "recommended", examples: ["Ping on hot replies", "Daily pipeline digest"], steps: ["Connect workspace", "Pick channel"] },
    ],
    security: ["Outbound emails require one-click approval.", "Discounts above ceiling are escalated.", "Tokens encrypted; minimum scopes only."],
  },
  support: {
    summary: "Plug the agent into your inbox/helpdesk so it triages tickets, drafts brand-tone replies and escalates the right things.",
    integrations: [
      { name: "Zendesk", category: "Support", method: "OAuth + Webhook", scopes: "tickets.read/write", status: "recommended", examples: ["Triage + tag tickets", "Draft brand-tone replies", "Auto-escalate refund/legal"], steps: ["Sign in", "Authorize scopes", "Subscribe to ticket events"] },
      { name: "Intercom", category: "Support", method: "OAuth", status: "optional", examples: ["Reply suggestions", "Tag conversations"], steps: ["Connect workspace", "Approve scopes"] },
      { name: "Gmail (shared inbox)", category: "Email", method: "OAuth", status: "recommended", examples: ["Read hello@ inbox", "Draft replies"], steps: ["Connect mailbox", "Grant read + drafts"] },
      { name: "Slack", category: "Notifications", method: "OAuth", status: "recommended", examples: ["Page on-call for P1", "SLA reports"], steps: ["Connect workspace", "Pick channel"] },
      { name: "Stripe", category: "Payments", method: "API key", scopes: "read-only", status: "optional", examples: ["Attach plan + LTV to tickets"], steps: ["Create restricted key", "Save"] },
    ],
    security: ["Replies drafted, never sent without approval.", "PII redacted in logs.", "Refund/legal always escalate."],
  },
  marketing: {
    summary: "Connect CMS, social and analytics so the agent ships content and reports on real growth.",
    integrations: [
      { name: "WordPress", category: "CMS", method: "API key", status: "recommended", examples: ["Schedule blog drafts", "Update meta + OG"], steps: ["Create API token", "Save"] },
      { name: "Webflow", category: "CMS", method: "API key", status: "optional", examples: ["Push CMS items", "Update SEO fields"], steps: ["Generate site token", "Save"] },
      { name: "X / Twitter", category: "Social", method: "OAuth", status: "optional", examples: ["Draft platform posts", "Schedule cadence"], steps: ["Connect account", "Pick posting window"] },
      { name: "LinkedIn", category: "Social", method: "OAuth", status: "optional", examples: ["Draft company posts"], steps: ["Connect page", "Authorize posting"] },
      { name: "Google Analytics 4", category: "Analytics", method: "OAuth", scopes: "read-only", status: "recommended", examples: ["Weekly traffic + conversion brief"], steps: ["Connect property", "Grant Viewer"] },
      { name: "Slack", category: "Notifications", method: "OAuth", status: "optional", examples: ["Mention alerts", "Weekly brief"], steps: ["Connect", "Pick channel"] },
    ],
    security: ["No public posts without approval.", "Brand tone enforced before drafts.", "Analytics scopes read-only."],
  },
  ops_finance: {
    summary: "Wire the agent into books, payments and bank feeds for real KPIs, anomaly alerts and overdue-invoice chasing.",
    integrations: [
      { name: "Stripe", category: "Payments", method: "API key + Webhook", scopes: "read-only key + events", status: "recommended", examples: ["Daily MRR / churn / failed-payment digest", "Refund anomaly alerts"], steps: ["Create restricted key", "Save", "Add webhook for charge.failed + invoice.*"] },
      { name: "QuickBooks", category: "Accounting", method: "OAuth", scopes: "accounting.read", status: "recommended", examples: ["Nudge overdue invoices", "Monthly P&L snapshot"], steps: ["Connect company file", "Authorize read scope"] },
      { name: "Xero", category: "Accounting", method: "OAuth", scopes: "accounting.read", status: "recommended", examples: ["Reconcile invoices", "Cashflow brief"], steps: ["Connect organisation", "Authorize read scope"] },
      { name: "Plaid", category: "Bank", method: "OAuth", scopes: "transactions.read", status: "optional", examples: ["Reconcile incoming payments", "Cash-runway alert"], steps: ["Connect institution", "Pick operating account"] },
      { name: "Shopify", category: "Commerce", method: "OAuth / API key", status: "optional", examples: ["Daily orders + AOV report", "Low-stock alerts"], steps: ["Install connector or paste keys", "Set thresholds"] },
      { name: "WooCommerce", category: "Commerce", method: "API key", status: "optional", examples: ["Orders + refunds report"], steps: ["Generate consumer key/secret", "Save"] },
      { name: "Slack", category: "Notifications", method: "OAuth", status: "recommended", examples: ["Anomaly alerts", "Weekly KPI digest"], steps: ["Connect", "Pick channel"] },
    ],
    security: ["Financial keys are read-only by default.", "No funds move without approval.", "Anomalies > 25% flagged, not auto-actioned."],
  },
  custom: {
    summary: "The agent can connect to any of your business systems. Start with the essentials below; add more later.",
    integrations: [
      { name: "Gmail / Outlook", category: "Email", method: "OAuth", status: "recommended", examples: ["Read & draft messages", "Send digests"], steps: ["Connect mailbox", "Approve scopes"] },
      { name: "HubSpot", category: "CRM", method: "OAuth", status: "optional", examples: ["Sync contacts and deals"], steps: ["Connect workspace", "Authorize"] },
      { name: "Salesforce", category: "CRM", method: "OAuth", status: "optional", examples: ["Sync accounts + opps"], steps: ["Connected App", "Authorize"] },
      { name: "Stripe", category: "Payments", method: "API key", status: "optional", examples: ["Revenue + churn KPIs"], steps: ["Restricted key", "Save"] },
      { name: "QuickBooks", category: "Accounting", method: "OAuth", status: "optional", examples: ["Invoice + P&L brief"], steps: ["Connect company file"] },
      { name: "Xero", category: "Accounting", method: "OAuth", status: "optional", examples: ["Reconciliation + cashflow"], steps: ["Connect organisation"] },
      { name: "Shopify", category: "Commerce", method: "OAuth / API key", status: "optional", examples: ["Orders + inventory"], steps: ["Connect store"] },
      { name: "Google Analytics 4", category: "Analytics", method: "OAuth", status: "optional", examples: ["Traffic + conversion reports"], steps: ["Connect property"] },
      { name: "Slack", category: "Notifications", method: "OAuth", status: "recommended", examples: ["Notifications + digests"], steps: ["Connect workspace", "Pick channel"] },
    ],
    security: ["External actions queued for one-click approval.", "Tokens encrypted; minimum scopes.", "Agent asks before broadening permissions."],
  },
};

function pickRoleFromManifest(manifest: { goal?: string; name?: string }): keyof typeof ROLE_DEFAULTS {
  const p = `${manifest?.name || ""} ${manifest?.goal || ""}`.toLowerCase();
  if (/support|ticket|inbox|helpdesk/.test(p)) return "support";
  if (/sales|lead|prospect|outreach|crm|pipeline/.test(p)) return "sales_ops";
  if (/market|content|seo|social|blog|brand/.test(p)) return "marketing";
  if (/finance|invoice|kpi|revenue|ops|operations|report/.test(p)) return "ops_finance";
  return "custom";
}

function methodIcon(method: string) {
  if (method.toLowerCase().includes("oauth")) return <KeyRound className="h-3 w-3" />;
  if (method.toLowerCase().includes("webhook")) return <Webhook className="h-3 w-3" />;
  return <Lock className="h-3 w-3" />;
}

export default function AgentIntegrationsPanel({
  manifest,
  accent = "#34d399",
}: {
  manifest: { name?: string; goal?: string; integrations?: IntegrationsSpec; role?: string };
  accent?: string;
}) {
  const spec = useMemo<IntegrationsSpec>(() => {
    if (manifest?.integrations?.integrations?.length) return manifest.integrations;
    const role = (manifest as { role?: string })?.role && manifest.role! in ROLE_DEFAULTS
      ? (manifest.role as keyof typeof ROLE_DEFAULTS)
      : pickRoleFromManifest(manifest);
    return ROLE_DEFAULTS[role];
  }, [manifest]);

  const [hubOpen, setHubOpen] = useState(false);
  const [openIntegration, setOpenIntegration] = useState<Integration | null>(null);
  const [query, setQuery] = useState("");
  const [connectedNames, setConnectedNames] = useState<Set<string>>(new Set());

  useEffect(() => {
    const refresh = () => {
      const s = new Set<string>();
      for (const it of spec.integrations) {
        if (localStorage.getItem(`nazai:integration:${it.name}`)) s.add(it.name);
      }
      setConnectedNames(s);
    };
    refresh();
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, [spec.integrations, openIntegration, hubOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return spec.integrations;
    return spec.integrations.filter((i) =>
      i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q),
    );
  }, [query, spec.integrations]);

  const connectedCount = connectedNames.size;
  const total = spec.integrations.length;

  return (
    <section
      className="relative overflow-hidden rounded-3xl p-5 sm:p-6 mt-4"
      style={{
        background: `linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01)), radial-gradient(120% 80% at 100% 0%, ${accent}1f, transparent 60%), #08090c`,
        border: `1px solid ${accent}33`,
        boxShadow: `0 30px 80px -50px ${accent}66`,
      }}
    >
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `linear-gradient(135deg, ${accent}, #22d3ee)`, boxShadow: `0 8px 24px -8px ${accent}99` }}>
          <Plug className="h-5 w-5 text-black" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[0.24em] font-mono text-zinc-400">Business Integrations</div>
          <h3 className="text-lg sm:text-xl font-bold text-white">Connect this agent to your real business systems</h3>
          {spec.summary && <p className="text-[13px] text-zinc-400 mt-1 leading-relaxed">{spec.summary}</p>}
          <div className="mt-3 flex items-center gap-2 text-[11px] font-mono text-zinc-400">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-white/10 bg-white/[0.03]">
              <Sparkles className="h-3 w-3" style={{ color: accent }} /> {total} tools available
            </span>
            {connectedCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded"
                style={{ background: `${accent}22`, color: accent, border: `1px solid ${accent}55` }}>
                <CheckCircle2 className="h-3 w-3" /> {connectedCount} connected
              </span>
            )}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setHubOpen(true)}
        className="mt-4 w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-bold text-black transition-transform hover:-translate-y-0.5"
        style={{ background: `linear-gradient(135deg, ${accent}, #22d3ee)`, boxShadow: `0 14px 36px -12px ${accent}99` }}
      >
        <Plug className="h-4 w-4" />
        Connect Business Tools
      </button>

      {hubOpen && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)" }}
          onClick={() => setHubOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-3xl rounded-3xl overflow-hidden flex flex-col"
            style={{
              maxHeight: "85vh",
              background: `linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01)), radial-gradient(120% 80% at 100% 0%, ${accent}1f, transparent 60%), #08090c`,
              border: `1px solid ${accent}44`,
              boxShadow: `0 40px 120px -40px ${accent}66`,
            }}
          >
            <header className="flex items-start gap-3 p-5 border-b border-white/5">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: `linear-gradient(135deg, ${accent}, #22d3ee)`, boxShadow: `0 8px 24px -8px ${accent}99` }}>
                <Plug className="h-5 w-5 text-black" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-[0.24em] font-mono text-zinc-400">Business Tools</div>
                <h3 className="text-lg font-bold text-white">Connect your business systems</h3>
                <p className="text-xs text-zinc-400 mt-0.5">Pick a tool, paste your credentials, and the agent goes live against your real data.</p>
              </div>
              <button onClick={() => setHubOpen(false)} className="text-zinc-400 hover:text-white p-1 rounded-md hover:bg-white/5">
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="px-5 pt-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search Shopify, Stripe, QuickBooks…"
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-black/40 border border-white/10 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30"
                />
              </div>
            </div>

            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3 overflow-y-auto">
              {filtered.map((it) => {
                const isConnected = connectedNames.has(it.name);
                return (
                  <div key={it.name}
                    className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 hover:border-white/20 hover:bg-white/[0.04] transition-all flex flex-col">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="text-sm font-semibold text-white truncate">{it.name}</div>
                          {isConnected ? (
                            <span className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
                              style={{ background: `${accent}22`, color: accent, border: `1px solid ${accent}55` }}>
                              <CheckCircle2 className="h-2.5 w-2.5" /> Connected
                            </span>
                          ) : it.status === "recommended" && (
                            <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
                              style={{ background: `${accent}22`, color: accent, border: `1px solid ${accent}44` }}>
                              Recommended
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] uppercase tracking-wider font-mono text-zinc-500 mt-0.5">{it.category}</div>
                      </div>
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border border-white/10 bg-black/30 text-zinc-300 shrink-0">
                        {methodIcon(it.method)}
                        {it.method}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 mb-3 line-clamp-2">{it.examples[0]}</p>
                    <button
                      type="button"
                      onClick={() => setOpenIntegration(it)}
                      className="mt-auto inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-black"
                      style={{ background: `linear-gradient(135deg, ${accent}, #22d3ee)`, boxShadow: `0 6px 18px -8px ${accent}99` }}
                    >
                      {isConnected ? "Manage" : "Connect"}
                    </button>
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <div className="col-span-full text-center py-8 text-sm text-zinc-500">
                  No tools match "{query}".
                </div>
              )}
            </div>

            {spec.security && spec.security.length > 0 && (
              <div className="px-5 pb-5">
                <div className="rounded-2xl border p-3"
                  style={{ borderColor: `${accent}33`, background: `${accent}0d` }}>
                  <div className="flex items-center gap-2 mb-1">
                    <ShieldCheck className="h-3.5 w-3.5" style={{ color: accent }} />
                    <div className="text-[10px] uppercase tracking-[0.24em] font-mono font-semibold" style={{ color: accent }}>
                      Security &amp; guardrails
                    </div>
                  </div>
                  <ul className="space-y-0.5">
                    {spec.security.map((s, i) => <li key={i} className="text-[11px] text-zinc-300">• {s}</li>)}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {openIntegration && (
        <IntegrationConnectModal
          integration={openIntegration}
          accent={accent}
          onClose={() => setOpenIntegration(null)}
        />
      )}
    </section>
  );
}
