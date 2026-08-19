// Rate limiting for inbound API traffic. Fixed-window counter, atomically
// incremented via the increment_rate_limit() Postgres function (a plain
// client-side upsert can't increment atomically under concurrent
// requests). Deliberately fails OPEN on an infrastructure error — unlike
// the deterministic control gate (which fails closed, because letting an
// unassessed real action through is the worse outcome), a rate limiter
// that can't reach its own counter should not turn into a full outage for
// legitimate traffic. Abuse protection and safety enforcement are
// different risk classes with different correct failure directions.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Pure — floors `now` to the start of its fixed window, as an ISO string. */
export function computeWindowStart(now: Date, windowSeconds: number): string {
  const epochSec = Math.floor(now.getTime() / 1000);
  const bucketStartSec = Math.floor(epochSec / windowSeconds) * windowSeconds;
  return new Date(bucketStartSec * 1000).toISOString();
}

export type RateLimitResult = { allowed: boolean; count: number; limit: number };

export async function checkRateLimit(
  admin: SupabaseClient,
  userId: string,
  endpoint: string,
  limitCount: number,
  windowSeconds: number,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  try {
    const windowStart = computeWindowStart(now, windowSeconds);
    const { data, error } = await admin.rpc("increment_rate_limit", {
      _user_id: userId,
      _endpoint: endpoint,
      _window_start: windowStart,
    });
    if (error) return { allowed: true, count: 0, limit: limitCount };
    const count = Number(data ?? 0);
    return { allowed: count <= limitCount, count, limit: limitCount };
  } catch {
    return { allowed: true, count: 0, limit: limitCount };
  }
}
