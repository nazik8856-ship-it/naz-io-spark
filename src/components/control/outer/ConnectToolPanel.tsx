// The one "Connect a tool" panel (Outer Control and Generator). Two groups: AI models (a key; only where the caller can save one)
// and Productivity & Data (sign-in connectors). Search finds a connector by name, company or what it is known for; featured tools
// only need a key (the address, format and header are filled in); a custom connector needs a name and an https address.
// Nothing is called "connected" until the server saved it; the caller then runs the connection test so the status is real.
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, Database, ExternalLink, Loader2, Plug, Plus, Search } from "lucide-react";
import { IntegrationLogo } from "@/components/IntegrationLogos";
import { useProductivityIntegrations, type ProductivityRow } from "@/hooks/useProductivityIntegrations";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { checkConnector, FEATURED_TOOLS, featuredPayload, keyPageUrl, searchConnectors, toolHealth, type Featured, type ToolHealthInput } from "@/lib/outer-control-tools-ui";

const inputCls = "w-full rounded-xl border border-cyan-400/20 bg-[#071226]/80 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-slate-500 outline-none transition focus:border-cyan-300/70 focus:shadow-[0_0_0_3px_rgba(34,211,238,0.15)]";
const ACTION = "rounded-full border border-cyan-300/40 bg-cyan-400/10 px-2.5 py-0.5 text-[11px] font-medium text-cyan-100 transition hover:bg-cyan-400/20 disabled:opacity-50";
const DOT: Record<string, string> = { working: "bg-emerald-400", failed: "bg-rose-400", attention: "bg-amber-400" };

export type ConnectedTool = ToolHealthInput & { id: string; name: string; endpoint_url: string };
export type ConnectPayload = { name: string; endpoint_url: string; request_format: string; model?: string; token?: string; auth_header?: string; auth_scheme?: string };

type View = { kind: "home" } | { kind: "featured"; tool: Featured } | { kind: "custom" };

/** The service's real logo on a light tile (most logos are dark); its short mark if the logo can not be loaded. */
function Tile({ icon, label }: { icon: string; label: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-cyan-300/30 bg-gradient-to-br from-cyan-400/25 to-blue-600/25 text-sm font-semibold text-cyan-100" aria-hidden>{label}</span>;
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white shadow-[0_0_18px_rgba(34,211,238,0.22)] ring-1 ring-cyan-200/40" aria-hidden>
      <img src={icon} alt="" className="h-6 w-6 object-contain" onError={() => setBroken(true)} />
    </span>
  );
}

export default function ConnectToolPanel({ open, onOpenChange, tools = [], busy = false, onConnect, onTest, testingId, onUse, attachedIds = [] }: {
  open: boolean; onOpenChange: (o: boolean) => void; tools?: ConnectedTool[]; busy?: boolean;
  /** Saves the tool and tests it; resolves true when it was saved. Without it the AI models group and custom connector are not shown. */
  onConnect?: (p: ConnectPayload) => Promise<boolean>;
  /** Runs the connection test for a connected AI tool. */
  onTest?: (t: ConnectedTool) => void; testingId?: string | null;
  /** Generator: use a connected productivity tool's data in the prompt. */
  onUse?: (row: ProductivityRow) => void; attachedIds?: string[];
}) {
  const int = useProductivityIntegrations(open);
  const aiModels = !!onConnect;
  const [view, setView] = useState<View>({ kind: "home" });
  const [query, setQuery] = useState("");
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [custom, setCustom] = useState({ name: "", url: "", format: "generic_json", model: "", token: "" });
  const reset = () => { setView({ kind: "home" }); setQuery(""); setKey(""); setModel(""); setCustom({ name: "", url: "", format: "generic_json", model: "", token: "" }); };
  const close = (o: boolean) => { if (!o) reset(); onOpenChange(o); };
  const checked = checkConnector({ name: custom.name, url: custom.url, format: custom.format, token: custom.token, model: custom.model });
  const connectedFor = (f: Featured) => tools.find((t) => t.endpoint_url === f.endpoint_url);
  const found = useMemo(() => searchConnectors(FEATURED_TOOLS, query), [query]);
  const foundConnected = useMemo(() => searchConnectors(tools.map((t) => ({ ...t, blurb: t.endpoint_url })), query), [tools, query]);
  const searching = query.trim().length > 0;
  const foundProductivity = int.rows.filter((r) => !searching || r.label.toLowerCase().includes(query.trim().toLowerCase()));
  const openCustom = () => { setCustom((c) => ({ ...c, name: c.name || (searching ? query.trim().slice(0, 80) : "") })); setView({ kind: "custom" }); };

  return (
    <>
    <Dialog open={open && !int.connecting} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-hidden border border-cyan-400/25 bg-[#050b18] p-0 text-zinc-100 shadow-[0_0_80px_rgba(34,211,238,0.2)] sm:max-w-3xl" data-testid="connect-panel">
        {/* blue fog and fine lines behind everything */}
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-cyan-500/25 blur-[110px]" />
          <div className="absolute -right-32 top-24 h-96 w-96 rounded-full bg-blue-600/25 blur-[120px]" />
          <div className="absolute bottom-[-8rem] left-1/3 h-80 w-80 rounded-full bg-sky-500/15 blur-[110px]" />
          <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "linear-gradient(rgba(125,211,252,1) 1px, transparent 1px), linear-gradient(90deg, rgba(125,211,252,1) 1px, transparent 1px)", backgroundSize: "36px 36px" }} />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent" />
        </div>

        <div className="relative max-h-[90vh] overflow-y-auto p-6 sm:p-8">
          <DialogHeader className="space-y-2 text-left">
            <DialogTitle className="flex items-center gap-3 text-xl font-semibold text-white">
              <span className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-300/40 bg-cyan-400/10 shadow-[0_0_22px_rgba(34,211,238,0.3)]"><Plug className="h-5 w-5 text-cyan-200" /></span>
              Connect a tool
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-slate-400">
              {aiModels
                ? "Outer Control talks to the tool over HTTPS, checks every reply against your rules, and keeps the result. Your key is stored encrypted and never shown again."
                : "Sign in to a tool so NazAI can use its data in your prompt. Connect or disconnect at any time."}
            </DialogDescription>
          </DialogHeader>

          {view.kind === "home" && (
            <div className="mt-6 space-y-7">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-300/80" aria-hidden />
                <input type="search" autoFocus role="searchbox" aria-label="Search connectors" placeholder={aiModels ? "Search connectors: ChatGPT, Claude, Gemini, Drive, Slack…" : "Search connectors: Google Drive, Slack, Notion…"} value={query} onChange={(e) => setQuery(e.target.value)} className={`${inputCls} pl-10`} data-testid="connector-search" />
              </div>
              <p className="sr-only" aria-live="polite" data-testid="search-status">{searching ? `${found.length} connector${found.length === 1 ? "" : "s"} found` : ""}</p>

              {aiModels && (!searching || foundConnected.length > 0) && (
                <section aria-label="Connected">
                  <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300/80">Connected</h3>
                  {tools.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">Nothing connected yet. Pick a tool below.</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {(searching ? foundConnected : tools).map((t) => {
                        const h = toolHealth(t);
                        return (
                          <li key={t.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm backdrop-blur" data-testid="panel-connected">
                            <span className="min-w-0 truncate text-zinc-100">{t.name}</span>
                            <span className="flex shrink-0 items-center gap-3 text-xs text-slate-300">
                              <span className="flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${DOT[h.key]}`} aria-hidden />{h.label}</span>
                              {onTest && <button type="button" disabled={testingId === t.id} onClick={() => onTest(t)} className={ACTION} data-testid="panel-test">{testingId === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}</button>}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              )}

              {aiModels && <section aria-label={searching ? "Search results" : "AI models"}>
                <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300/80">{searching ? `AI models (${found.length})` : "AI models"}</h3>
                {found.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-400" data-testid="no-results">No connector matches "{query.trim()}". You can add it as a custom connector below.</p>
                ) : (
                  <ul className="mt-2 grid gap-2.5 sm:grid-cols-2">
                    {found.map((f) => (
                      <li key={f.id} className="h-full">
                        <button type="button" onClick={() => { setView({ kind: "featured", tool: f }); setModel(f.model); setKey(""); }}
                          className="group flex h-full w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 text-left backdrop-blur transition hover:border-cyan-300/50 hover:bg-cyan-400/[0.07] hover:shadow-[0_0_28px_rgba(34,211,238,0.14)] focus-visible:border-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60" data-testid="featured-tool">
                          <Tile icon={f.icon} label={f.mark} />
                          <span className="min-w-0">
                            <span className="flex items-center gap-2 text-sm font-medium text-white">{f.name}{connectedFor(f) && <span className="flex items-center gap-1 text-[10px] font-normal text-emerald-300"><Check className="h-3 w-3" />Connected</span>}</span>
                            <span className="mt-0.5 block text-xs leading-snug text-slate-400">{f.blurb}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>}

              <section aria-label="Productivity and data" data-testid="productivity-group">
                <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300/80">Productivity &amp; Data</h3>
                {foundProductivity.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-400" data-testid="no-productivity">No productivity tool matches "{query.trim()}".</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {foundProductivity.map((r) => {
                      const used = attachedIds.includes(`int-${r.id}`);
                      return (
                        <li key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm backdrop-blur" data-testid="productivity-tool">
                          <span className="flex min-w-0 items-center gap-3 text-zinc-100">
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white ring-1 ring-cyan-200/40" aria-hidden><IntegrationLogo name={r.label} size={18} fallback={<Database className="h-4 w-4 text-slate-700" />} /></span>
                            <span className="min-w-0"><span className="block truncate">{r.label}</span>
                              <span className="flex items-center gap-1.5 text-[11px] text-slate-400"><span className={`h-1.5 w-1.5 rounded-full ${r.connected ? "bg-emerald-400" : "bg-slate-500"}`} aria-hidden />{r.connected ? "Connected" : "Not connected"}</span>
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            {r.connected && onUse && (used
                              ? <span className="flex items-center gap-1 text-[11px] text-emerald-300"><Check className="h-3 w-3" />In prompt</span>
                              : <button type="button" onClick={() => onUse(r)} className={ACTION} data-testid="use-in-prompt">Use in prompt</button>)}
                            {r.connected
                              ? <button type="button" disabled={int.disconnecting.has(r.id)} onClick={() => int.askDisconnect(r)} className={`${ACTION} border-rose-400/40 text-rose-200 hover:bg-rose-400/10`} data-testid="productivity-disconnect">{int.disconnecting.has(r.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : "Disconnect"}</button>
                              : <button type="button" onClick={() => int.connect(r)} className={ACTION} data-testid="productivity-connect">Connect</button>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {aiModels && <section aria-label="Custom connector">
                <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300/80">Custom</h3>
                <button type="button" onClick={openCustom} className="group mt-2 flex w-full items-center gap-3 rounded-2xl border border-dashed border-cyan-300/35 bg-cyan-400/[0.03] p-3.5 text-left transition hover:border-cyan-300/70 hover:bg-cyan-400/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60" data-testid="custom-connector">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-cyan-300/30 bg-cyan-400/10 text-cyan-200"><Plus className="h-4 w-4" /></span>
                  <span>
                    <span className="block text-sm font-medium text-white">{searching && found.length === 0 ? `Add "${query.trim().slice(0, 40)}" as a custom connector` : "Add custom connector"}</span>
                    <span className="mt-0.5 block text-xs text-slate-400">Any tool with an HTTPS address: a name and the address are enough.</span>
                  </span>
                </button>
              </section>}
            </div>
          )}

          {view.kind === "featured" && (
            <div className="mt-6 space-y-3" data-testid="featured-form">
              <button type="button" onClick={() => setView({ kind: "home" })} className="flex items-center gap-1 text-xs text-slate-400 hover:text-cyan-200"><ArrowLeft className="h-3 w-3" /> Back</button>
              <div className="flex items-center gap-3">
                <Tile icon={view.tool.icon} label={view.tool.mark} />
                <div>
                  <div className="text-base font-medium text-white">{view.tool.name}</div>
                  <p className="break-all font-mono text-[11px] text-slate-500">{view.tool.endpoint_url}</p>
                </div>
              </div>
              <div className="rounded-2xl border border-cyan-300/25 bg-cyan-400/[0.06] p-4" data-testid="get-key">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm font-medium text-white">Get your {view.tool.keyLabel}</div>
                  <a href={keyPageUrl(view.tool)} target="_blank" rel="noopener noreferrer" data-testid="get-key-link"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/50 bg-cyan-400/15 px-3 py-1.5 text-xs font-medium text-cyan-100 transition hover:bg-cyan-400/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
                    Open {view.tool.keysAt.split("/")[0]} <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <ol className="mt-2.5 space-y-1.5 text-xs leading-relaxed text-slate-300">
                  <li className="flex gap-2"><span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-cyan-400/20 text-[10px] font-semibold text-cyan-200">1</span>Open the key page with the button.</li>
                  <li className="flex gap-2"><span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-cyan-400/20 text-[10px] font-semibold text-cyan-200">2</span>{view.tool.keyStep}</li>
                  <li className="flex gap-2"><span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-cyan-400/20 text-[10px] font-semibold text-cyan-200">3</span>Copy the key and paste it below. NazAI stores it encrypted and never shows it again.</li>
                </ol>
              </div>
              <input className={inputCls} type="password" autoComplete="off" autoFocus aria-label={view.tool.keyLabel} placeholder={`Paste your ${view.tool.keyLabel} here`} value={key} onChange={(e) => setKey(e.target.value)} />
              <input className={inputCls} aria-label="Model" placeholder="Model" value={model} onChange={(e) => setModel(e.target.value)} />
              <p className="text-xs text-slate-500">The model name is a starting value. Providers rename models; if the test fails with a model error, change it here.</p>
              <button disabled={busy || !key.trim()} onClick={async () => { if (await onConnect?.(featuredPayload(view.tool, key, model))) close(false); }}
                className="w-full rounded-xl border border-cyan-300/60 bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-[#03101c] shadow-[0_0_24px_rgba(34,211,238,0.35)] transition hover:bg-cyan-300 disabled:opacity-40 disabled:shadow-none">
                {busy ? "Connecting and testing…" : "Connect and test"}
              </button>
            </div>
          )}

          {view.kind === "custom" && (
            <div className="mt-6 space-y-3" data-testid="custom-form">
              <button type="button" onClick={() => setView({ kind: "home" })} className="flex items-center gap-1 text-xs text-slate-400 hover:text-cyan-200"><ArrowLeft className="h-3 w-3" /> Back</button>
              <input className={inputCls} placeholder="Name, e.g. Support bot" aria-label="Tool name" autoFocus value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
              <input className={inputCls} placeholder="https://… (MCP server URL or the tool's endpoint)" aria-label="Tool address" value={custom.url} onChange={(e) => setCustom({ ...custom, url: e.target.value })} />
              <input className={inputCls} type="password" autoComplete="off" placeholder="API key or token (optional; stored encrypted, never shown again)" aria-label="Tool credential" value={custom.token} onChange={(e) => setCustom({ ...custom, token: e.target.value })} />
              <div className="grid gap-2 sm:grid-cols-2">
                <select className={inputCls} aria-label="Request format" value={custom.format} onChange={(e) => setCustom({ ...custom, format: e.target.value })}>
                  <option value="generic_json">Plain JSON</option>
                  <option value="openai_chat">OpenAI-style chat</option>
                  <option value="anthropic_messages">Anthropic messages</option>
                </select>
                <input className={inputCls} placeholder="Model (optional)" aria-label="Model" value={custom.model} onChange={(e) => setCustom({ ...custom, model: e.target.value })} />
              </div>
              {(custom.name || custom.url) && checked.errors.map((m) => <p key={m} className="flex items-center gap-1.5 text-xs text-rose-300"><AlertTriangle className="h-3 w-3" />{m}</p>)}
              {checked.notes.map((m) => <p key={m} className="text-xs text-amber-200/90" data-testid="connector-note">{m}</p>)}
              <button disabled={busy || checked.errors.length > 0}
                onClick={async () => { if (await onConnect?.({ name: custom.name.trim(), endpoint_url: custom.url.trim(), request_format: custom.format, model: custom.model.trim() || undefined, token: custom.token.trim() || undefined })) close(false); }}
                className="w-full rounded-xl border border-cyan-300/60 bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-[#03101c] shadow-[0_0_24px_rgba(34,211,238,0.35)] transition hover:bg-cyan-300 disabled:opacity-40 disabled:shadow-none">
                {busy ? "Connecting and testing…" : "Connect and test"}
              </button>
            </div>
          )}
          <p className="mt-7 text-[10px] leading-relaxed text-slate-600">Logos belong to their owners and are shown only to identify the service.</p>
        </div>
      </DialogContent>
    </Dialog>
    {int.node}
    </>
  );
}
