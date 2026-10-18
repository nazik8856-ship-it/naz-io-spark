// The sign-in connectors (Google Drive, Calendar, Analytics, Slack, Notion, Canva, Figma, Shopify): which ones are connected,
// connect (the existing sign-in window) and disconnect (with a confirmation). Used by the shared "Connect a tool" panel, so
// Generator and Outer Control show the same list. The connection logic itself is unchanged from where it used to live.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useIntegrationOAuthMessages } from "@/hooks/useIntegrationOAuthMessages";
import IntegrationConnectModal from "@/components/agents/IntegrationConnectModal";
import { extractFunctionErrorMessage } from "@/lib/supabase-function-error";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const PRODUCTIVITY_TOOLS = [
  { id: "gdrive", label: "Google Drive", providerKey: "Google Drive" },
  { id: "gcal", label: "Google Calendar", providerKey: "Google Calendar" },
  { id: "ganalytics", label: "Google Analytics", providerKey: "Google Analytics" },
  { id: "shopify", label: "Shopify", providerKey: "Shopify" },
  { id: "slack", label: "Slack", providerKey: "Slack" },
  { id: "notion", label: "Notion", providerKey: "Notion" },
  { id: "canva", label: "Canva", providerKey: "Canva" },
  { id: "figma", label: "Figma", providerKey: "Figma" },
] as const;

export type ProductivityTool = (typeof PRODUCTIVITY_TOOLS)[number];
export type ProductivityRow = ProductivityTool & { connected: boolean; hasSnapshot: boolean; snapshotText?: string };
type Connected = { provider: string; hasSnapshot: boolean; snapshotText?: string };

export function useProductivityIntegrations(active: boolean): {
  rows: ProductivityRow[]; disconnecting: Set<string>; connecting: boolean;
  connect: (t: ProductivityTool) => void; askDisconnect: (t: ProductivityTool) => void; node: ReactNode;
} {
  const { user } = useAuth();
  const [connected, setConnected] = useState<Connected[]>([]);
  const [disconnecting, setDisconnecting] = useState<Set<string>>(new Set());
  const [connectTarget, setConnectTarget] = useState<{ name: string; category: string } | null>(null);
  const [confirm, setConfirm] = useState<ProductivityTool | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) { setConnected([]); return; }
    const { data: ints } = await supabase.from("agent_integrations").select("provider, metadata").eq("user_id", user.id).eq("status", "connected");
    const providers = new Set<string>();
    ((ints || []) as Array<{ provider?: string | null; metadata?: { services?: unknown } | null }>).forEach((i) => {
      const p = String(i.provider || "").toLowerCase();
      if (p) providers.add(p);
      // The shared "Gmail" row records each granted Google surface in metadata.services; expand those into their catalogue names.
      if (p === "gmail") {
        const services = Array.isArray(i.metadata?.services) ? (i.metadata.services as string[]) : [];
        services.forEach((s) => {
          const key = String(s).toLowerCase();
          if (key === "drive") providers.add("google drive");
          else if (key === "calendar") providers.add("google calendar");
          else if (key === "analytics") providers.add("google analytics");
        });
      }
    });
    const list = Array.from(providers);
    if (!list.length) { setConnected([]); return; }
    const { data: snaps } = await supabase.from("integration_snapshots").select("provider, kind, data, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50);
    const byProv = new Map<string, string>();
    ((snaps || []) as Array<{ provider: string; data: unknown }>).forEach((s) => {
      const p = String(s.provider).toLowerCase();
      if (!byProv.has(p)) byProv.set(p, JSON.stringify(s.data ?? {}));
    });
    setConnected(list.map((p) => ({ provider: p, hasSnapshot: byProv.has(p), snapshotText: byProv.get(p) })));
  }, [user?.id]);

  useEffect(() => { if (active && user?.id) load(); }, [active, user?.id, load]);

  // Every sign-in window reports back the same way, so the row flips to Connected at once instead of waiting for a refetch.
  useIntegrationOAuthMessages(useCallback((info) => {
    if (!user?.id) return;
    const key = info.provider === "Figma" ? "figma" : info.provider === "Canva" ? "canva" : info.provider === "Notion" ? "notion"
      : info.provider === "Slack" ? "slack" : info.provider === "Shopify" ? "shopify"
      : (() => {
        const svc = (info.service || "").toLowerCase();
        if (svc === "drive") return "google drive";
        if (svc === "calendar") return "google calendar";
        if (svc === "analytics") return "google analytics";
        return "gmail";
      })();
    setConnected((prev) => (prev.some((c) => c.provider === key) ? prev : [...prev, { provider: key, hasSnapshot: false }]));
  }, [user?.id]));

  // The Google surfaces share ONE stored grant (provider "Gmail"), so disconnecting one disconnects the whole Google grant.
  const disconnect = async (t: ProductivityTool) => {
    const google = /^Google/i.test(t.providerKey);
    setDisconnecting((p) => new Set(p).add(t.id));
    try {
      const { error } = await supabase.functions.invoke("integration-connect", { body: { action: "disconnect", provider: google ? "Gmail" : t.providerKey, agentId: null } });
      if (error) throw new Error((await extractFunctionErrorMessage(error)) ?? error.message ?? "Disconnect failed");
      setConnected((prev) => prev.filter((x) => (google ? !x.provider.startsWith("google") && x.provider !== "gmail" : x.provider !== t.providerKey.toLowerCase())));
      toast.success(`${t.label} disconnected`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setDisconnecting((p) => { const n = new Set(p); n.delete(t.id); return n; });
    }
  };

  const rows: ProductivityRow[] = PRODUCTIVITY_TOOLS.map((t) => {
    const c = connected.find((x) => x.provider === t.providerKey.toLowerCase() || x.provider === t.id || x.provider.includes(t.id.split("_")[1] || t.id));
    return { ...t, connected: !!c, hasSnapshot: !!c?.hasSnapshot, snapshotText: c?.snapshotText };
  });

  const node = (
    <>
      {connectTarget && (
        <IntegrationConnectModal
          integration={{ name: connectTarget.name, category: connectTarget.category, method: "Sign in", examples: [], steps: [`Sign in with ${connectTarget.name}`] }}
          agentId={null} accent="#22d3ee" onClose={() => setConnectTarget(null)} onChange={() => { load(); }}
        />
      )}
      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent className="bg-zinc-950 border-white/10 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {confirm?.label}?</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">NazAI will no longer be able to pull data from {confirm?.label}. You can reconnect it again at any time.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent border-white/10 text-zinc-200 hover:bg-white/5 hover:text-white">No</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const t = confirm; setConfirm(null); if (t) disconnect(t); }} className="bg-red-500/20 text-red-200 border border-red-400/30 hover:bg-red-500/30">Yes, disconnect</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  return {
    rows, disconnecting, connecting: !!connectTarget, node,
    connect: (t) => setConnectTarget({ name: t.providerKey, category: /Google|Gmail/i.test(t.providerKey) ? "Google" : t.providerKey }),
    askDisconnect: (t) => setConfirm(t),
  };
}
