// Real-time alerting for safety events only.
//
// Fires ONLY for kill-switch trips (manual or automatic), hard-rule blocks and
// circuit-breaker trips. Routine allow / modify / deferred verdicts never alert.
//
// Delivery: Slack via slack_post_message when the account has a connected Slack
// integration; otherwise a prominent server log. Never throws — alerting must
// never break the decision path.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { slackPostMessage } from "./provider-writes.ts";

export type CriticalAlertEvent =
  | "kill_switch_on"
  | "kill_switch_off"
  | "kill_switch_auto"
  | "hard_rule_block"
  | "circuit_breaker_trip";

const APP_BASE_URL = "https://www.nazai.net";

const LABELS: Record<CriticalAlertEvent, string> = {
  kill_switch_on: "🛑 Kill switch ON",
  kill_switch_off: "✅ Kill switch OFF",
  kill_switch_auto: "🛑 Kill switch auto-tripped",
  hard_rule_block: "⛔ Hard rule blocked an action",
  circuit_breaker_trip: "⚡ Circuit breaker tripped",
};

export function decisionLink(decisionId?: string | null): string | null {
  return decisionId ? `${APP_BASE_URL}/control-system?decision=${decisionId}` : null;
}

export async function sendCriticalAlert(
  admin: SupabaseClient,
  userId: string,
  opts: {
    event: CriticalAlertEvent;
    summary: string;
    decisionId?: string | null;
    actionType?: string | null;
    provider?: string | null;
    actor?: string | null;
  },
): Promise<"slack" | "log"> {
  const link = decisionLink(opts.decisionId);
  const lines = [
    `*${LABELS[opts.event]}*`,
    opts.summary,
    opts.actionType ? `Action: \`${opts.actionType}\`${opts.provider ? ` · ${opts.provider}` : ""}` : null,
    opts.actor ? `By: ${opts.actor}` : null,
    link ? `Decision record: ${link}` : null,
  ].filter(Boolean) as string[];
  const text = lines.join("\n");

  try {
    const { data } = await admin
      .from("agent_integrations")
      .select("provider, metadata")
      .eq("user_id", userId)
      .eq("provider", "slack")
      .eq("status", "connected")
      .maybeSingle();

    if (data) {
      const channel = (data as { metadata?: Record<string, unknown> }).metadata?.default_channel;
      const res = await slackPostMessage(admin, userId, "", {
        channel: String(channel || "#general"),
        text,
      });
      if (res.ok) return "slack";
      console.error(`[CONTROL ALERT] Slack delivery failed: ${res.summary}`);
    }
  } catch (err) {
    console.error("[CONTROL ALERT] Slack delivery threw:", String((err as Error)?.message || err));
  }

  console.error(`[CONTROL ALERT] ${LABELS[opts.event]} — ${text.replace(/\n/g, " | ")}`);
  return "log";
}
