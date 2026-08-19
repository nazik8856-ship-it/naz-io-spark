// Pure, dependency-free client-side search — reused across the
// decisions/approvals/incidents pages, all of which are chronological
// lists today with no way to find one specific item once history grows.

/** Pure — case-insensitive substring match, tolerant of null/undefined/non-string values. */
export function matchesSearch(value: unknown, query: string): boolean {
  if (!query.trim()) return true;
  if (value === null || value === undefined) return false;
  return String(value).toLowerCase().includes(query.trim().toLowerCase());
}

/** Pure — keeps a row if the query matches ANY of the given fields. Empty query keeps everything. */
export function filterBySearch<T extends Record<string, unknown>>(
  rows: T[],
  query: string,
  fields: (keyof T)[],
): T[] {
  if (!query.trim()) return rows;
  return rows.filter((row) => fields.some((f) => matchesSearch(row[f], query)));
}
