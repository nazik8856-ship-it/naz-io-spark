import { useCallback, useEffect, useState } from "react";
import { Gauge, Check, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

const DEFAULT_CAP = 5;
const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

/**
 * Daily AI-gateway spend for this account: today's usage against the cap.
 * At 90% the system warns (Slack if connected), at 100% it auto-trips the
 * kill switch until the next UTC day.
 */
export default function SpendCapPanel() {
  const [cap, setCap] = useState<number>(DEFAULT_CAP);
  const [enabled, setEnabled] = useState(true);
  const [spent, setSpent] = useState(0);
  const [calls, setCalls] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(DEFAULT_CAP));
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return;
    const day = new Date().toISOString().slice(0, 10);
    const [{ data: capRow }, { data: usageRow }] = await Promise.all([
      supabase.from("ai_spend_caps").select("daily_cap_usd, enabled").eq("user_id", uid).maybeSingle(),
      supabase.from("ai_spend_daily").select("cost_usd, calls").eq("user_id", uid).eq("day", day).maybeSingle(),
    ]);
    const c = Number(capRow?.daily_cap_usd ?? DEFAULT_CAP);
    setCap(c);
    setDraft(c.toFixed(2));
    setEnabled(capRow?.enabled ?? true);
    setSpent(Number(usageRow?.cost_usd ?? 0));
    setCalls(Number(usageRow?.calls ?? 0));
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const value = Number(draft);
    if (!Number.isFinite(value) || value <= 0) {
      toast({ title: "Enter a valid cap", description: "The daily cap must be more than $0.", variant: "destructive" });
      return;
    }
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return;
    setSaving(true);
    const { error } = await supabase
      .from("ai_spend_caps")
      .upsert({ user_id: uid, daily_cap_usd: value, enabled }, { onConflict: "user_id" });
    setSaving(false);
    if (error) {
      toast({ title: "Couldn't save the cap", description: error.message, variant: "destructive" });
      return;
    }
    setCap(value);
    setEditing(false);
    toast({ title: "Daily AI spend cap updated", description: `Now ${money(value)} per day.` });
  };

  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
  const color = pct >= 100 ? "#ef4444" : pct >= 90 ? "#f59e0b" : "#22c55e";

  return (
    <div className="px-6 py-3 border-b border-white/5 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-zinc-500">
          <Gauge className="h-3.5 w-3.5" />
          Daily AI spend
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="font-mono" style={{ color }}>
            {money(spent)} / {money(cap)}
          </span>
          <span className="text-zinc-500">· {calls} calls today</span>
          {editing ? (
            <>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                inputMode="decimal"
                aria-label="Daily AI spend cap in dollars"
                className="w-20 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs font-mono text-zinc-100"
              />
              <button
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-zinc-200 hover:bg-white/10 disabled:opacity-50"
              >
                <Check className="h-3 w-3" />
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/10"
            >
              <Pencil className="h-3 w-3" />
              Edit cap
            </button>
          )}
        </div>
      </div>

      <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>

      {pct >= 90 && (
        <p className="text-[11px]" style={{ color }}>
          {pct >= 100
            ? "Cap reached — AI actions are halted until tomorrow (UTC) or until an owner turns the kill switch off."
            : "Over 90% of today's cap used. At 100% the kill switch trips automatically."}
        </p>
      )}
    </div>
  );
}
