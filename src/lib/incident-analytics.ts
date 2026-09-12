// Pure incident analytics: MTTA (mean time to acknowledge) and MTTR (mean
// time to resolve), plus a root-cause-category breakdown across resolved
// incidents. Computed from whatever incident rows the caller passes in --
// ControlIncidents.tsx fetches every incident regardless of the page's own
// status-filter tab, since MTTA/MTTR/breakdown are account-wide numbers,
// not scoped to whichever tab happens to be selected.

export type IncidentForAnalytics = {
  status: string;
  opened_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  root_cause_category: string | null;
};

export type RootCauseBreakdownEntry = { category: string; count: number };

export type IncidentAnalytics = {
  mtta_hours: number | null;
  mttr_hours: number | null;
  acknowledged_count: number;
  resolved_count: number;
  root_cause_breakdown: RootCauseBreakdownEntry[];
};

function hoursBetween(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / (1000 * 60 * 60);
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

/**
 * Pure -- MTTA is measured across every incident that has been
 * acknowledged at least once (regardless of current status: acknowledged
 * or resolved both count, since both passed through acknowledgment).
 * MTTR is measured across resolved incidents only. A resolved incident
 * with no root_cause_category recorded falls into an explicit
 * "uncategorized" bucket rather than being silently dropped from the
 * breakdown -- an account should be able to see how much of its own
 * history was never categorized, not just the categorized slice.
 */
export function computeIncidentAnalytics(incidents: IncidentForAnalytics[]): IncidentAnalytics {
  const ackHours = incidents
    .filter((i): i is IncidentForAnalytics & { acknowledged_at: string } => i.acknowledged_at != null)
    .map((i) => hoursBetween(i.opened_at, i.acknowledged_at));

  const resolved = incidents.filter((i) => i.status === "resolved" && i.resolved_at != null);
  const resolveHours = resolved.map((i) => hoursBetween(i.opened_at, i.resolved_at!));

  const counts = new Map<string, number>();
  for (const i of resolved) {
    const key = i.root_cause_category ?? "uncategorized";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const root_cause_breakdown = [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  return {
    mtta_hours: mean(ackHours),
    mttr_hours: mean(resolveHours),
    acknowledged_count: ackHours.length,
    resolved_count: resolveHours.length,
    root_cause_breakdown,
  };
}
