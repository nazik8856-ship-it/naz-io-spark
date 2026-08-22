// Pure — turns a config_changes row's before/after jsonb into a short,
// human-readable summary of what actually changed.

const IGNORED_KEYS = new Set(["id", "user_id", "created_at", "updated_at"]);

// agents.manifest is a large nested JSON blob (systemPrompt, tools,
// triggers, guardrails, kpis) -- printing its full before/after JSON
// inline would make a single field change unreadable. Every other config
// table's columns are plain scalars small enough to print as-is.
const formatValue = (key: string, value: unknown): string =>
  key === "manifest" ? (value === undefined ? "(none)" : "(updated)") : JSON.stringify(value);

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
      changed.push(`${key}: ${formatValue(key, before[key])} → ${formatValue(key, after[key])}`);
    }
  }
  return changed.length ? changed.join("; ") : "No field changes";
}
