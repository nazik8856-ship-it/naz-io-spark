import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Webhook, Trash2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { hasPermission } from "@/lib/account-switcher";
import { toast } from "@/hooks/use-toast";

const EVENTS = ["approval_created", "approval_escalated", "incident_opened", "incident_resolved", "decision_logged"] as const;

type WebhookRow = {
  id: string;
  url: string;
  secret: string;
  events: string[];
  enabled: boolean;
  created_at: string;
};

type DeliveryRow = { webhook_id: string; ok: boolean; status_code: number | null; created_at: string };

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * OUTBOUND WEBHOOKS — one general mechanism to notify any external system
 * (PagerDuty, Opsgenie, Teams, a custom endpoint) on approval created,
 * approval escalated, incident opened, or incident resolved. Each
 * delivery is HMAC-SHA256 signed with the webhook's own secret.
 */
export default function ControlWebhooks() {
  const navigate = useNavigate();
  const { accountId, role, permissions } = useActiveAccount();
  const canWrite = hasPermission(role, permissions, "integrations");
  const [hooks, setHooks] = useState<WebhookRow[]>([]);
  const [recentByHook, setRecentByHook] = useState<Record<string, DeliveryRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<Set<string>>(new Set(EVENTS));
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("webhooks")
      .select("id, url, secret, events, enabled, created_at")
      .eq("user_id", accountId)
      .order("created_at", { ascending: false });
    if (error) toast({ title: "Couldn't load webhooks", description: error.message, variant: "destructive" });
    const rows = (data ?? []) as unknown as WebhookRow[];
    setHooks(rows);

    if (rows.length) {
      const { data: deliveries } = await supabase
        .from("webhook_deliveries")
        .select("webhook_id, ok, status_code, created_at")
        .eq("user_id", accountId)
        .order("created_at", { ascending: false })
        .limit(50);
      const grouped: Record<string, DeliveryRow[]> = {};
      for (const d of (deliveries ?? []) as unknown as DeliveryRow[]) {
        (grouped[d.webhook_id] ??= []).push(d);
      }
      setRecentByHook(grouped);
    }
    setLoading(false);
  }, [accountId]);

  useEffect(() => { load(); }, [load]);

  const toggleEvent = (e: string) =>
    setEvents((prev) => {
      const next = new Set(prev);
      if (next.has(e)) next.delete(e); else next.add(e);
      return next;
    });

  const create = async () => {
    if (!accountId || !canWrite) return;
    if (!/^https:\/\//.test(url)) {
      toast({ title: "Needs an https:// URL", variant: "destructive" });
      return;
    }
    if (events.size === 0) {
      toast({ title: "Pick at least one event", variant: "destructive" });
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("webhooks").insert({
      user_id: accountId,
      url,
      secret: randomSecret(),
      events: [...events],
      enabled: true,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Couldn't create it", description: error.message, variant: "destructive" });
      return;
    }
    setUrl("");
    toast({ title: "Webhook created" });
    load();
  };

  const toggleEnabled = async (h: WebhookRow) => {
    if (!canWrite) return;
    const { error } = await supabase.from("webhooks").update({ enabled: !h.enabled }).eq("id", h.id);
    if (error) { toast({ title: "Couldn't update it", description: error.message, variant: "destructive" }); return; }
    load();
  };

  const remove = async (id: string) => {
    if (!canWrite) return;
    const { error } = await supabase.from("webhooks").delete().eq("id", id);
    if (error) { toast({ title: "Couldn't delete it", description: error.message, variant: "destructive" }); return; }
    load();
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
          <Webhook className="h-5 w-5 text-cyan-400" /> Webhooks
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Notify any external system — PagerDuty, Opsgenie, Teams, or your own endpoint — when an approval is
          created or escalated, or an incident opens or resolves. Each delivery is HMAC-SHA256 signed.
        </p>

        {canWrite ? (
          <div className="mt-6 space-y-3 rounded border border-white/10 bg-white/[0.02] p-4">
            <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              Endpoint URL
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/webhooks/nazai"
                className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-200"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {EVENTS.map((e) => (
                <label key={e} className="flex items-center gap-1.5 text-xs text-zinc-300" title={e === "decision_logged" ? "Fires on every decision, not just the rare ones — high volume by design (SIEM/observability export)." : undefined}>
                  <input type="checkbox" checked={events.has(e)} onChange={() => toggleEvent(e)} className="accent-cyan-500" />
                  {e}
                  {e === "decision_logged" && <span className="text-[10px] text-amber-300/70">(high volume)</span>}
                </label>
              ))}
            </div>
            <button
              disabled={busy}
              onClick={create}
              className="flex items-center gap-1.5 rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 font-mono text-[11px] uppercase text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Add webhook
            </button>
          </div>
        ) : (
          <p className="mt-6 rounded border border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-500">
            Only an account owner can add, enable/disable, or delete webhooks. You can view them below.
          </p>
        )}

        {loading ? (
          <p className="mt-8 font-mono text-xs uppercase text-zinc-500">Loading…</p>
        ) : hooks.length === 0 ? (
          <p className="mt-6 rounded border border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-500">
            No webhooks configured yet.
          </p>
        ) : (
          <ul className="mt-6 space-y-3">
            {hooks.map((h) => {
              const recent = recentByHook[h.id] ?? [];
              const lastFailed = recent.length > 0 && !recent[0].ok;
              return (
                <li key={h.id} className="rounded border border-white/10 bg-white/[0.02] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs text-zinc-200">{h.url}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {h.events.map((e) => (
                          <span key={e} className="rounded border border-white/10 px-1.5 py-0.5 text-[9px] font-mono uppercase text-zinc-400">{e}</span>
                        ))}
                      </div>
                      <div className="mt-1 text-[10px] font-mono text-zinc-500">
                        secret: {h.secret.slice(0, 8)}… (use this to verify X-NazAI-Signature)
                      </div>
                      {recent.length > 0 && (
                        <div className={`mt-1 text-[10px] font-mono ${lastFailed ? "text-rose-400" : "text-emerald-400"}`}>
                          Last delivery: {lastFailed ? `failed (${recent[0].status_code ?? "network error"})` : `ok (${recent[0].status_code})`}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        onClick={() => toggleEnabled(h)}
                        disabled={!canWrite}
                        className={`rounded border px-2 py-1 text-[10px] font-mono uppercase disabled:opacity-50 ${h.enabled ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-white/15 text-zinc-400"}`}
                      >
                        {h.enabled ? "Enabled" : "Disabled"}
                      </button>
                      {canWrite && (
                        <button onClick={() => remove(h.id)} className="rounded border border-rose-500/30 p-1.5 text-rose-300 hover:bg-rose-500/10">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
