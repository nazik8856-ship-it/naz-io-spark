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

/** Every currently-active (uncleared) flag for this account. Never throws. */
export async function loadActiveConfidenceBucketFlags(
  admin: SupabaseClient,
  userId: string,
): Promise<ActiveConfidenceFlag[]> {
  try {
    const { data } = await admin
      .from("confidence_bucket_flags")
      .select("bucket_min, bucket_max")
      .eq("user_id", userId)
      .is("cleared_at", null);
    return (data ?? []) as ActiveConfidenceFlag[];
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
 */
export async function flagBucketIfNew(
  admin: SupabaseClient,
  userId: string,
  bucketMin: number,
  bucketMax: number,
  incidentId: string | null,
): Promise<boolean> {
  try {
    const { data: existing } = await admin
      .from("confidence_bucket_flags")
      .select("id")
      .eq("user_id", userId)
      .eq("bucket_min", bucketMin)
      .is("cleared_at", null)
      .maybeSingle();
    if (existing) return false;
    const { error } = await admin.from("confidence_bucket_flags").insert({
      user_id: userId,
      bucket_min: bucketMin,
      bucket_max: bucketMax,
      incident_id: incidentId,
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
