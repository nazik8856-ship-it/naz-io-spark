import { useCallback, useEffect, useState } from "react";
import { Bell, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { toast } from "@/hooks/use-toast";

/**
 * NOTIFICATION PREFERENCES — per-user, per-account. Every scheduled email
 * (daily digest, weekly trend) used to go to the account owner only, with
 * no opt-out. This is personal: each person here manages only their own
 * preference for whichever account is currently active, not anyone
 * else's.
 */
export default function NotificationPreferencesPanel() {
  const { user } = useAuth();
  const { accountId } = useActiveAccount();
  const [open, setOpen] = useState(false);
  const [digest, setDigest] = useState(true);
  const [weeklyTrend, setWeeklyTrend] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user || !accountId) return;
    const { data } = await supabase
      .from("notification_preferences")
      .select("digest_enabled, weekly_trend_enabled")
      .eq("account_owner_id", accountId)
      .eq("recipient_id", user.id)
      .maybeSingle();
    // No row yet = the default (enabled for the account owner viewing
    // their own account; a team member with no row simply doesn't
    // receive anything yet, matching the resolver's opt-in default).
    const row = data as { digest_enabled?: boolean; weekly_trend_enabled?: boolean } | null;
    setDigest(row ? row.digest_enabled !== false : accountId === user.id);
    setWeeklyTrend(row ? row.weekly_trend_enabled !== false : accountId === user.id);
  }, [user, accountId]);

  useEffect(() => { void load(); }, [load]);

  const save = async (next: { digest_enabled: boolean; weekly_trend_enabled: boolean }) => {
    if (!user || !accountId) return;
    setSaving(true);
    const { error } = await supabase
      .from("notification_preferences")
      .upsert(
        { account_owner_id: accountId, recipient_id: user.id, ...next },
        { onConflict: "account_owner_id,recipient_id" },
      );
    setSaving(false);
    if (error) {
      toast({ title: "Couldn't save that", description: error.message, variant: "destructive" });
      return;
    }
  };

  const toggleDigest = (checked: boolean) => {
    setDigest(checked);
    void save({ digest_enabled: checked, weekly_trend_enabled: weeklyTrend });
  };
  const toggleWeeklyTrend = (checked: boolean) => {
    setWeeklyTrend(checked);
    void save({ digest_enabled: digest, weekly_trend_enabled: checked });
  };

  if (!user) return null;

  return (
    <section className="mx-6 mb-3 rounded-xl border border-white/10 bg-white/[0.03]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <Bell className="h-4 w-4 text-zinc-400" />
        <span className="flex-1 text-xs font-mono uppercase tracking-wider text-zinc-300">
          My notifications
        </span>
        <ChevronDown className={`h-4 w-4 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-white/10 px-4 py-4 space-y-2">
          <p className="text-[11px] text-zinc-500">
            Just for you, on this account. Doesn't change what anyone else on the team receives.
          </p>
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={digest}
              disabled={saving}
              onChange={(e) => toggleDigest(e.target.checked)}
              className="h-3.5 w-3.5 accent-cyan-500"
            />
            Daily digest (open incidents, pending approvals, spend status)
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={weeklyTrend}
              disabled={saving}
              onChange={(e) => toggleWeeklyTrend(e.target.checked)}
              className="h-3.5 w-3.5 accent-cyan-500"
            />
            Weekly trend summary
          </label>
        </div>
      )}
    </section>
  );
}
