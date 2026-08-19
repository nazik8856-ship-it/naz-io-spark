// Pure structural diff between two policy_versions.snapshot objects (see
// build_policy_snapshot() in the migrations). No DB access — the page
// already fetches both snapshots for the version list.

export type HardRuleSnap = { id: string; rule_text: string; action_type_pattern: string; effect: string; provider: string | null; enabled: boolean; shadow_mode?: boolean };
export type SafetyRuleSnap = { id: string; name: string; category: string; pattern: string; severity: string; enabled: boolean };
export type ThresholdSnap = { agent_id: string; slug?: string; confidence_threshold?: number; autonomy?: string; auto_approve_low_risk?: boolean; daily_run_cap?: number; daily_action_cap?: number };
export type SpendCapSnap = { daily_cap_usd?: number; enabled?: boolean };

export type PolicySnapshotShape = {
  hard_rules?: HardRuleSnap[];
  safety_rules?: SafetyRuleSnap[];
  thresholds?: ThresholdSnap[];
  spend_cap?: SpendCapSnap;
};

export type ArrayDiff<T> = {
  added: T[];
  removed: T[];
  changed: { id: string; before: T; after: T }[];
};

function diffById<T extends Record<string, unknown>>(before: T[], after: T[], idKey: keyof T): ArrayDiff<T> {
  const beforeMap = new Map(before.map((x) => [x[idKey] as string, x]));
  const afterMap = new Map(after.map((x) => [x[idKey] as string, x]));
  const added: T[] = [];
  const changed: { id: string; before: T; after: T }[] = [];
  for (const [id, a] of afterMap) {
    const b = beforeMap.get(id);
    if (!b) added.push(a);
    else if (JSON.stringify(b) !== JSON.stringify(a)) changed.push({ id, before: b, after: a });
  }
  const removed: T[] = [];
  for (const [id, b] of beforeMap) {
    if (!afterMap.has(id)) removed.push(b);
  }
  return { added, removed, changed };
}

export type PolicyDiff = {
  hardRules: ArrayDiff<HardRuleSnap>;
  safetyRules: ArrayDiff<SafetyRuleSnap>;
  thresholds: ArrayDiff<ThresholdSnap>;
  spendCapChanged: boolean;
  spendCapBefore: SpendCapSnap | null;
  spendCapAfter: SpendCapSnap | null;
  hasChanges: boolean;
};

/** Pure — diffs two policy snapshots. */
export function diffPolicySnapshots(before: PolicySnapshotShape, after: PolicySnapshotShape): PolicyDiff {
  const hardRules = diffById(before.hard_rules ?? [], after.hard_rules ?? [], "id");
  const safetyRules = diffById(before.safety_rules ?? [], after.safety_rules ?? [], "id");
  const thresholds = diffById(before.thresholds ?? [], after.thresholds ?? [], "agent_id");

  const spendCapBefore = before.spend_cap ?? null;
  const spendCapAfter = after.spend_cap ?? null;
  const spendCapChanged = JSON.stringify(spendCapBefore) !== JSON.stringify(spendCapAfter);

  const anyArrayChange = (d: ArrayDiff<unknown>) => d.added.length > 0 || d.removed.length > 0 || d.changed.length > 0;
  const hasChanges = anyArrayChange(hardRules) || anyArrayChange(safetyRules) || anyArrayChange(thresholds) || spendCapChanged;

  return { hardRules, safetyRules, thresholds, spendCapChanged, spendCapBefore, spendCapAfter, hasChanges };
}
