// Pure — turns a config_changes row's before/after jsonb into a short,
// human-readable summary of what actually changed.

const IGNORED_KEYS = new Set(["id", "user_id", "created_at", "updated_at"]);

export function summarizeConfigChange(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string {
  if (!before) return "Created";
  if (!after) return "Deleted";
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (IGNORED_KEYS.has(key)) continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changed.push(`${key}: ${JSON.stringify(before[key])} → ${JSON.stringify(after[key])}`);
    }
  }
  return changed.length ? changed.join("; ") : "No field changes";
}
