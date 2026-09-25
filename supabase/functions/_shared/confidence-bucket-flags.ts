// Confidence-miscalibration corrective action.
//
// calibrate-confidence's weekly job already flags a bucket "severe" when
// real measured outcomes trail the model's claimed confidence by more than
// its tolerance -- until now that flag was a one-time alert + incident with
// zero downstream effect on how future decisions in that same range are
// judged. A row here widens (never narrows) that bucket's effective
// escalation threshold in control-engine, until a human clears the flag by
// setting cleared_at. Deliberately conservative: no automatic
// threshold-narrowing, no silent recovery.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type ActiveConfidenceFlag = { bucket_min: number; bucket_max: number };

type StoredConfidenceFlag = ActiveConfidenceFlag & { api_key_id: string | null };

/**
 * Every currently-active (uncleared) flag that actually applies to THIS
 * decision -- a genuine account-wide flag (api_key_id null), or one scoped
 * to this exact api key. Never throws.
 *
 * Correctness-audit fix: flagBucketIfNew has always correctly scoped a flag
 * to one specific api key when given one (item 5's own stated intent --
 * "so it's never confused with an account-wide flag or another key's"), but
 * this loader never filtered by api_key_id at all -- every caller (control-
 * engine) got every active flag for the whole account, so a miscalibration
 * flag raised for API Key A's own traffic silently widened the escalation
 * threshold for API Key B's completely unrelated decisions too, and even
 * for internal/chat-driven decisions with no api key at all.
 */
export async function loadActiveConfidenceBucketFlags(
  admin: SupabaseClient,
  userId: string,
  apiKeyId: string | null = null,
): Promise<ActiveConfidenceFlag[]> {
  try {
    const { data } = await admin
      .from("confidence_bucket_flags")
      .select("bucket_min, bucket_max, api_key_id")
      .eq("user_id", userId)
      .is("cleared_at", null);
    const rows = (data ?? []) as StoredConfidenceFlag[];
    return rows.filter((f) => f.api_key_id == null || f.api_key_id === apiKeyId);
  } catch {
    return [];
  }
}

/**
 * Records a new flag for this bucket, unless one is already active (the
 * unique partial index on the table is the real guarantee under
 * concurrent runs; this check-then-insert just avoids a needless insert
 * attempt in the common case). Returns whether a new flag was created.
 * Never throws.
 *
 * "Policy autonomy" plan, item 5: `apiKeyId` (optional, defaults to
 * null -- today's exact account-wide behavior, unchanged for internal-
 * agent decisions) scopes the flag to one external api key's own
 * miscalibration specifically, so it's never confused with an
 * account-wide flag or another key's.
 */
export async function flagBucketIfNew(
  admin: SupabaseClient,
  userId: string,
  bucketMin: number,
  bucketMax: number,
  incidentId: string | null,
  apiKeyId: string | null = null,
): Promise<boolean> {
  try {
    let existingQuery = admin
      .from("confidence_bucket_flags")
      .select("id")
      .eq("user_id", userId)
      .eq("bucket_min", bucketMin)
      .is("cleared_at", null);
    existingQuery = apiKeyId ? existingQuery.eq("api_key_id", apiKeyId) : existingQuery.is("api_key_id", null);
    const { data: existing } = await existingQuery.maybeSingle();
    if (existing) return false;
    const { error } = await admin.from("confidence_bucket_flags").insert({
      user_id: userId,
      bucket_min: bucketMin,
      bucket_max: bucketMax,
      incident_id: incidentId,
      api_key_id: apiKeyId,
    });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Pure — widen (never narrow) the effective escalation threshold when this
 * decision's own score falls inside a bucket flagged as miscalibrated by
 * real measured outcomes. Raises the threshold to the top of the flagged
 * range at most, so every decision scored inside it is treated as
 * escalation-worthy regardless of its own claimed confidence, while a
 * decision outside every flagged range is completely unaffected.
 */
export function widenThresholdForFlags(
  threshold: number,
  score: number,
  flags: ActiveConfidenceFlag[],
): number {
  let widened = threshold;
  for (const f of flags) {
    if (score >= f.bucket_min && score < f.bucket_max) {
      widened = Math.max(widened, f.bucket_max);
    }
  }
  return Math.min(100, widened);
}
