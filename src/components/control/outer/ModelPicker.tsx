// Connecting an AI tool: which model it uses. A list, never a blank text box: NazAI's suggestions (one that works on the
// provider's free or entry plan first) until a key is pasted, then the models the provider says that key can use, read
// through outer-control-drive list_models (the key goes to the provider only and is not stored). "Other" still takes any name.
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { callDrive } from "@/lib/outer-control-drive";
import { modelOptions, pickModel } from "@/lib/outer-control-tool-url";

const OTHER = "__other__";
const selectCls = "w-full rounded-xl border border-cyan-400/20 bg-[#071226]/80 px-3.5 py-2.5 text-sm text-zinc-100 outline-none transition focus:border-cyan-300/70";

export type ModelSource = { endpoint_url: string; request_format: string; auth_header: string; auth_scheme: string; model: string; models: string[] };
type ListState = { kind: "idle" } | { kind: "loading" } | { kind: "live"; count: number } | { kind: "failed"; reason: string };

export default function ModelPicker({ source, apiKey, value, onChange }: { source: ModelSource; apiKey: string; value: string; onChange: (m: string) => void }) {
  const [live, setLive] = useState<string[] | null>(null);
  const [list, setList] = useState<ListState>({ kind: "idle" });
  const [other, setOther] = useState(false);
  const asked = useRef(0);

  // Read the key's model list shortly after the key stops changing; an answer to an older key is ignored.
  useEffect(() => {
    setLive(null);
    const key = apiKey.trim();
    if (key.length < 8) { setList({ kind: "idle" }); return; }
    const n = ++asked.current;
    setList({ kind: "loading" });
    const t = setTimeout(async () => {
      const r = await callDrive("list_models", {
        endpoint_url: source.endpoint_url, request_format: source.request_format, auth_header: source.auth_header, auth_scheme: source.auth_scheme, token: key,
      });
      if (n !== asked.current) return;
      const models = (r.data as { models?: unknown } | null)?.models;
      if (r.ok && Array.isArray(models) && models.length) { setLive(models.map(String)); setList({ kind: "live", count: models.length }); }
      else setList({ kind: "failed", reason: r.message || "The provider listed no chat models." });
    }, 600);
    return () => clearTimeout(t);
  }, [apiKey, source.endpoint_url, source.request_format, source.auth_header, source.auth_scheme]);

  // Once the key's list is known, keep a model it can use selected (the safe default when the current one is not in it).
  useEffect(() => {
    if (!live || other) return;
    const pick = pickModel(value, source.models, live);
    if (pick !== value) onChange(pick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const options = modelOptions(source.models, live);
  const typed = other || (!!value && !options.includes(value));
  const label = (m: string) => `${m}${m === source.model ? " (recommended)" : source.models.includes(m) ? " (suggested)" : ""}`;

  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-300" htmlFor="model-select">Model</label>
      <select id="model-select" className={selectCls} aria-label="Model" data-testid="model-select" value={typed ? OTHER : value}
        onChange={(e) => { if (e.target.value === OTHER) { setOther(true); } else { setOther(false); onChange(e.target.value); } }}>
        {options.map((m) => <option key={m} value={m}>{label(m)}</option>)}
        <option value={OTHER}>Other (type a model name)</option>
      </select>
      {typed && (
        <input className={selectCls} aria-label="Model name" data-testid="model-other" placeholder="Exact model name from the provider" value={value}
          onChange={(e) => onChange(e.target.value)} />
      )}
      <p className="flex items-center gap-1.5 text-xs text-slate-500" data-testid="model-status">
        {list.kind === "loading" && <><Loader2 className="h-3 w-3 animate-spin" />Checking which models your key can use…</>}
        {list.kind === "idle" && "Paste your key to see the models it can use. Until then these are NazAI's suggestions."}
        {list.kind === "live" && `${list.count} model${list.count === 1 ? "" : "s"} available for this key, as the provider lists them. Suggested ones come first.`}
        {list.kind === "failed" && <span className="text-amber-200/90">Could not read the model list: {list.reason} You can still pick a suggested model; the test will say if it works.</span>}
      </p>
    </div>
  );
}
