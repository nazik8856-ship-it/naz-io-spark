// Pure classification for integration-revocation-sweep: given the current
// agent_integrations rows in "error" status, decide which ones are newly
// broken (never alerted, or alerted before their most recent break) and so
// need a fresh sendCriticalAlert. No DB dependency so this is fully unit
// testable — the actual query happens in the edge function, which maps rows
// into this shape first.

export type ErroredIntegrationRow = {
  id: string;
  userId: string;
  agentId: string | null;
  provider: string;
  lastError: string | null;
  updatedAt: string;
  revokedAlertedAt: string | null;
};

export type NewlyBrokenIntegration = ErroredIntegrationRow;

/**
 * A row needs a fresh alert when it has never been alerted on, or when it
 * broke again (updated_at moved forward) after the last time it was
 * alerted — e.g. it recovered, then failed a second time, without this
 * sweep ever observing the intermediate "connected" state to clear the flag
 * (a clean reconnect always clears revokedAlertedAt itself; this is the
 * belt-and-suspenders case where that update didn't happen, was missed, or
 * the row broke again inside the same sweep interval).
 */
export function newlyBrokenIntegrations(rows: ErroredIntegrationRow[]): NewlyBrokenIntegration[] {
  return rows.filter((r) => {
    if (!r.revokedAlertedAt) return true;
    return new Date(r.updatedAt).getTime() > new Date(r.revokedAlertedAt).getTime();
  });
}

export function summarizeRevokedIntegration(r: ErroredIntegrationRow): string {
  const reason = (r.lastError || "").trim();
  return reason
    ? `The ${r.provider} connection${r.agentId ? " for one of your agents" : ""} stopped working: ${reason}`
    : `The ${r.provider} connection${r.agentId ? " for one of your agents" : ""} was revoked or expired and needs to be reconnected.`;
}
