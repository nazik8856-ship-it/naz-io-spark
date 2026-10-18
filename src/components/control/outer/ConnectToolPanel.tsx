// Outer Control: the "Connect a tool" panel. Three parts: what is already connected, featured tools (the address and format
// are filled in; the person adds a key), and a custom connector (name + address). Nothing is called "connected" until the
// server saved it; the caller then runs the connection test so the status shown is real.
import { useState } from "react";
import { Plug, Check, AlertTriangle, ArrowLeft } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { checkConnector, FEATURED_TOOLS, featuredPayload, toolHealth, type Featured, type ToolHealthInput } from "@/lib/outer-control-tools-ui";
import { TONE_DOT } from "@/lib/outer-control-ui";

const inputCls = "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-500/50";
const DOT: Record<string, string> = { working: TONE_DOT.ok, failed: TONE_DOT.bad, attention: TONE_DOT.warn };

export type ConnectedTool = ToolHealthInput & { id: string; name: string; endpoint_url: string };
export type ConnectPayload = { name: string; endpoint_url: string; request_format: string; model?: string; token?: string; auth_header?: string; auth_scheme?: string };

type View = { kind: "home" } | { kind: "featured"; tool: Featured } | { kind: "custom" };

export default function ConnectToolPanel({ open, onOpenChange, tools, busy, onConnect }: {
  open: boolean; onOpenChange: (o: boolean) => void; tools: ConnectedTool[]; busy: boolean;
  /** Saves the tool and tests it; resolves true when it was saved. */
  onConnect: (p: ConnectPayload) => Promise<boolean>;
}) {
  const [view, setView] = useState<View>({ kind: "home" });
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [custom, setCustom] = useState({ name: "", url: "", format: "generic_json", model: "", token: "" });
  const reset = () => { setView({ kind: "home" }); setKey(""); setModel(""); setCustom({ name: "", url: "", format: "generic_json", model: "", token: "" }); };
  const close = (o: boolean) => { if (!o) reset(); onOpenChange(o); };
  const checked = checkConnector({ name: custom.name, url: custom.url, format: custom.format, token: custom.token, model: custom.model });
  const already = (f: Featured) => tools.some((t) => t.endpoint_url === f.endpoint_url);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-white/10 bg-zinc-950 text-zinc-100 sm:max-w-2xl" data-testid="connect-panel">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg"><Plug className="h-4 w-4 text-cyan-300" /> Connect a tool</DialogTitle>
          <DialogDescription className="text-zinc-400">
            Outer Control talks to the tool over HTTPS, checks every reply against your rules, and keeps the result. Your key is stored encrypted and never shown again.
          </DialogDescription>
        </DialogHeader>

        {view.kind === "home" && (
          <div className="space-y-6">
            <section aria-label="Connected">
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Connected</h3>
              {tools.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-500">Nothing connected yet. Pick a tool below.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {tools.map((t) => {
                    const h = toolHealth(t);
                    return (
                      <li key={t.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm" data-testid="panel-connected">
                        <span className="min-w-0 truncate text-zinc-100">{t.name}</span>
                        <span className="flex shrink-0 items-center gap-1.5 text-xs text-zinc-400"><span className={`h-1.5 w-1.5 rounded-full ${DOT[h.key]}`} aria-hidden />{h.label}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section aria-label="Featured tools">
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Featured</h3>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {FEATURED_TOOLS.map((f) => (
                  <button key={f.id} type="button" onClick={() => { setView({ kind: "featured", tool: f }); setModel(f.model); setKey(""); }}
                    className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-left transition hover:border-cyan-500/40 hover:bg-white/[0.06]" data-testid="featured-tool">
                    <div className="flex items-center justify-between gap-2 text-sm font-medium text-zinc-100">
                      {f.name}{already(f) && <span className="flex items-center gap-1 text-[10px] font-normal text-emerald-300"><Check className="h-3 w-3" /> Connected</span>}
                    </div>
                    <p className="mt-1 text-xs text-zinc-400">{f.blurb}</p>
                  </button>
                ))}
              </div>
            </section>

            <section aria-label="Custom connector">
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Custom</h3>
              <button type="button" onClick={() => setView({ kind: "custom" })} className="mt-2 w-full rounded-xl border border-dashed border-white/20 px-3.5 py-3 text-left transition hover:border-cyan-500/40 hover:bg-white/[0.04]" data-testid="custom-connector">
                <div className="text-sm font-medium text-zinc-100">Add custom connector</div>
                <p className="mt-1 text-xs text-zinc-400">Any tool with an HTTPS address: a name and the address are enough.</p>
              </button>
            </section>
          </div>
        )}

        {view.kind === "featured" && (
          <div className="space-y-3" data-testid="featured-form">
            <button type="button" onClick={() => setView({ kind: "home" })} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"><ArrowLeft className="h-3 w-3" /> Back</button>
            <div>
              <div className="text-sm font-medium text-zinc-100">{view.tool.name}</div>
              <p className="mt-0.5 break-all font-mono text-[11px] text-zinc-500">{view.tool.endpoint_url}</p>
            </div>
            <input className={inputCls} type="password" autoComplete="off" aria-label={view.tool.keyLabel} placeholder={`${view.tool.keyLabel} (get one at ${view.tool.keysAt})`} value={key} onChange={(e) => setKey(e.target.value)} />
            <input className={inputCls} aria-label="Model" placeholder="Model" value={model} onChange={(e) => setModel(e.target.value)} />
            <p className="text-xs text-zinc-500">The model name is a starting value. Providers rename models; if the test fails with a model error, change it here.</p>
            <button disabled={busy || !key.trim()} onClick={async () => { if (await onConnect(featuredPayload(view.tool, key, model))) close(false); }}
              className="w-full rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-40">
              {busy ? "Connecting and testing…" : "Connect and test"}
            </button>
          </div>
        )}

        {view.kind === "custom" && (
          <div className="space-y-3" data-testid="custom-form">
            <button type="button" onClick={() => setView({ kind: "home" })} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"><ArrowLeft className="h-3 w-3" /> Back</button>
            <input className={inputCls} placeholder="Name, e.g. Support bot" aria-label="Tool name" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
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
              onClick={async () => { if (await onConnect({ name: custom.name.trim(), endpoint_url: custom.url.trim(), request_format: custom.format, model: custom.model.trim() || undefined, token: custom.token.trim() || undefined })) close(false); }}
              className="w-full rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-40">
              {busy ? "Connecting and testing…" : "Connect and test"}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
