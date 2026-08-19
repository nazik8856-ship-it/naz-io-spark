import { useCallback, useEffect, useState } from "react";
import { Archive, Check, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

const DEFAULT_DAYS = 400;
const MIN_DAYS = 30;

/**
 * How long agent_decisions and agent_events are kept before a daily job
 * purges them. Both grow unbounded otherwise — this is the knob, not a
 * "delete everything now" button.
 */
export default function RetentionPanel() {
  const [days, setDays] = useState<number>(DEFAULT_DAYS);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(DEFAULT_DAYS));
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return;
    const { data } = await supabase.from("profiles").select("retention_days").eq("id", uid).maybeSingle();
    const d = Number(data?.retention_days ?? DEFAULT_DAYS);
    setDays(d);
    setDraft(String(d));
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const value = Math.round(Number(draft));
    if (!Number.isFinite(value) || value < MIN_DAYS) {
      toast({ title: "Enter a valid window", description: `Must be at least ${MIN_DAYS} days.`, variant: "destructive" });
      return;
    }
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ retention_days: value }).eq("id", uid);
    setSaving(false);
    if (error) {
      toast({ title: "Couldn't save it", description: error.message, variant: "destructive" });
      return;
    }
    setDays(value);
    setEditing(false);
    toast({ title: "Retention window updated", description: `Decisions and events now kept for ${value} days.` });
  };

  return (
    <div className="px-6 py-3 border-b border-white/5 space-y-1">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-zinc-500">
          <Archive className="h-3.5 w-3.5" />
          Data retention
        </div>
        <div className="flex items-center gap-2 text-xs">
          {editing ? (
            <>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                inputMode="numeric"
                aria-label="Retention window in days"
                className="w-20 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs font-mono text-zinc-100"
              />
              <span className="text-zinc-500">days</span>
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
            <>
              <span className="font-mono text-zinc-300">{days} days</span>
              <button
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/10"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </button>
            </>
          )}
        </div>
      </div>
      <p className="text-[11px] text-zinc-500">
        Decisions and agent events older than this are purged daily. Minimum {MIN_DAYS} days.
      </p>
    </div>
  );
}
