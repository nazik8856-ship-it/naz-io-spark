// "15 more items" plan, item 15: a paginated decision-export endpoint on
// the public Control API, so a customer's own reporting/monitoring tools
// can pull new decisions on their own schedule instead of a person
// manually re-downloading a one-shot file. Pure cursor/limit handling
// lives here so it's testable without a live DB -- the actual Supabase
// query composition lives in control-api/index.ts.
//
// Keyset pagination on (created_at, id) rather than an OFFSET: an offset
// page shifts underneath a caller if new decisions land between polls
// (skipping or duplicating rows); a keyset cursor -- "everything strictly
// after this exact row" -- can't.
export type DecisionExportCursor = { createdAt: string; id: string };

const CURSOR_PREFIX = "dxc1:";

/** Opaque, versioned so a future cursor shape change can be detected and rejected rather than misparsed. */
export function encodeExportCursor(c: DecisionExportCursor): string {
  return CURSOR_PREFIX + btoa(`${c.createdAt}|${c.id}`);
}

/** Returns null for anything malformed or from an unrecognized cursor version -- callers must
 * treat that as "start from the beginning," never crash or silently misinterpret it. */
export function decodeExportCursor(raw: string | null | undefined): DecisionExportCursor | null {
  if (!raw || !raw.startsWith(CURSOR_PREFIX)) return null;
  try {
    const decoded = atob(raw.slice(CURSOR_PREFIX.length));
    const sep = decoded.indexOf("|");
    if (sep < 0) return null;
    const createdAt = decoded.slice(0, sep);
    const id = decoded.slice(sep + 1);
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export const DEFAULT_EXPORT_LIMIT = 100;
export const MAX_EXPORT_LIMIT = 500;

/** Never trusts caller input past MAX_EXPORT_LIMIT, and falls back to the default for
 * anything non-numeric, zero, or negative rather than erroring the request out. */
export function clampExportLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_EXPORT_LIMIT;
  return Math.min(MAX_EXPORT_LIMIT, Math.floor(n));
}

/**
 * PostgREST .or() filter string for "strictly after this cursor" under
 * (created_at, id) ordering: either a later created_at, or the same
 * created_at with a later id (the tie-breaker for same-timestamp rows).
 * created_at is always a Postgres-generated ISO timestamp and id always a
 * uuid -- neither can contain a comma or parenthesis, so no escaping is
 * needed for PostgREST's comma/paren-delimited filter syntax.
 */
export function exportCursorFilter(c: DecisionExportCursor): string {
  return `created_at.gt.${c.createdAt},and(created_at.eq.${c.createdAt},id.gt.${c.id})`;
}
