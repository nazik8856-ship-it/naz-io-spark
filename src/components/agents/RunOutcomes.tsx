import { useEffect, useState } from "react";
import { ExternalLink, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { IntegrationLogo } from "@/components/IntegrationLogos";

export type ArtifactRow = {
  id: string;
  run_id: string | null;
  agent_id: string | null;
  kind: string;
  title: string | null;
  url: string | null;
  provider: string | null;
  account_email: string | null;
  created_at: string;
};

const ARTIFACT_COLS =
  "id, run_id, agent_id, kind, title, url, provider, account_email, created_at";

export function prettyKind(kind: string) {
  return kind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Outcomes (real deliverables) produced by a single agent run. */
export function RunOutcomes({ runId, accent = "#00A3FF" }: { runId: string; accent?: string }) {
  const [items, setItems] = useState<ArtifactRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!runId) return;
      const { data } = await supabase
        .from("agent_artifacts")
        .select(ARTIFACT_COLS)
        .eq("run_id", runId)
        .order("created_at", { ascending: false });
      if (!cancelled) setItems((data ?? []) as ArtifactRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (items.length === 0) return null;

  return (
    <div className="mt-2.5 pt-2.5" style={{ borderTop: `1px solid ${accent}18` }}>
      <div className="text-[9.5px] font-mono uppercase tracking-widest text-zinc-500 mb-1.5">
        Outcomes <span className="text-zinc-300">({items.length})</span>
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {items.map((a) => {
          const clickable = Boolean(a.url);
          const title = a.title || prettyKind(a.kind);
          const body = (
            <>
              <span className="shrink-0">
                <IntegrationLogo
                  name={a.provider}
                  size={14}
                  fallback={<Package className="h-3.5 w-3.5" style={{ color: accent }} />}
                />
              </span>
              <span className="min-w-0 flex-1 text-left">
                <span className="block text-[11.5px] text-white leading-snug truncate" title={title}>
                  {title}
                </span>
                <span className="block text-[9.5px] font-mono uppercase tracking-wider text-zinc-500 truncate">
                  {prettyKind(a.kind)}
                  {a.provider ? ` · ${a.provider}` : ""}
                </span>
              </span>
              {clickable && <ExternalLink className="h-3 w-3 shrink-0 opacity-70" style={{ color: accent }} />}
            </>
          );
          const cls =
            "flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors " +
            (clickable ? "hover:brightness-125 cursor-pointer" : "cursor-default");
          const style = {
            background: "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.015))",
            border: `1px solid ${accent}26`,
          };
          return (
            <li key={a.id}>
              {clickable ? (
                <a href={a.url!} target="_blank" rel="noopener noreferrer" className={cls} style={style}>
                  {body}
                </a>
              ) : (
                <div className={cls} style={style}>
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Compact preview of an agent's most recent real deliverables. */
export function RecentOutcomes({
  agentId,
  limit = 3,
  className = "",
}: {
  agentId: string;
  limit?: number;
  className?: string;
}) {
  const [items, setItems] = useState<ArtifactRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!agentId) return;
      const { data } = await supabase
        .from("agent_artifacts")
        .select(ARTIFACT_COLS)
        .eq("agent_id", agentId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (!cancelled) setItems((data ?? []) as ArtifactRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, limit]);

  if (items.length === 0) return null;

  return (
    <div className={className}>
      <div className="text-[9px] font-mono uppercase tracking-widest text-zinc-500 mb-1">Recent outcomes</div>
      <ul className="space-y-1">
        {items.map((a) => {
          const title = a.title || prettyKind(a.kind);
          const inner = (
            <>
              <IntegrationLogo
                name={a.provider}
                size={12}
                fallback={<Package className="h-3 w-3 text-zinc-500" />}
              />
              <span className="truncate text-[11px] text-zinc-300">{title}</span>
              {a.url && <ExternalLink className="h-2.5 w-2.5 shrink-0 text-zinc-500" />}
            </>
          );
          return (
            <li key={a.id} className="flex items-center gap-1.5 min-w-0">
              {a.url ? (
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1.5 min-w-0 hover:text-white transition-colors"
                  title={title}
                >
                  {inner}
                </a>
              ) : (
                <span className="flex items-center gap-1.5 min-w-0" title={title}>
                  {inner}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
