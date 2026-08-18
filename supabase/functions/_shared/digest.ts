// Pure "is there anything worth emailing about" check for the daily
// control-system digest — an empty digest every single day is worse than
// no digest at all, so this only fires when there's real signal: an open
// incident, a pending approval waiting on a human, or spend meaningfully
// close to the daily cap.
export type DigestSignal = {
  openIncidents: number;
  pendingApprovals: number;
  spendPct: number;
};

const SPEND_WARN_PCT = 80;

/** Pure — should today's digest actually be sent? */
export function digestHasContent(signal: DigestSignal): boolean {
  return signal.openIncidents > 0 || signal.pendingApprovals > 0 || signal.spendPct >= SPEND_WARN_PCT;
}
