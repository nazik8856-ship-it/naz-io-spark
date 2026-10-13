// AI-provider health: recognising an outage that is OURS (no credits left, quota
// exhausted) as opposed to a rate limit the user can wait out, telling the user
// the truth about it, and raising -- then later clearing -- a platform incident
// so the operator finds out in minutes instead of from a customer.
//
// Why a separate notion from "rate limited": OpenAI answers an exhausted account
// with HTTP 429 ("You have no credits remaining"). Showing that as "Rate limited,
// retry in a moment" is wrong: retrying cannot help until the account is topped
// up. And "AI credits exhausted for this workspace" reads as the CUSTOMER's own
// balance, sending them to buy credits for a problem that is not theirs.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const OUT_OF_CREDITS = /no credits|insufficient[_ ]quota|exceeded your current quota|billing[_ ]hard[_ ]limit|billing/i;

export const PROVIDER_OUTAGE_KIND = "ai_provider_out_of_credits";
export const CANARY_FAILED_KIND = "generation_canary_failed";

/** What a signed-in user is told. Honest, not alarming, and it says nothing was charged. */
export const GENERATION_UNAVAILABLE_MESSAGE =
  "Generation is temporarily unavailable on our side — this is not a problem with your account, and you were not charged. Please try again in a little while.";

/** True when the provider's refusal means our account is out of credit/quota (402, or 429 whose body says so). */
export function isProviderOutOfCredits(status: number, body: string): boolean {
  if (status === 402) return true;
  return status === 429 && OUT_OF_CREDITS.test(body);
}

/**
 * Opens a platform incident of `kind` unless one is already open (so a long
 * outage is one incident, not one per failed request). Best-effort: never throws.
 * Returns true when a new incident was opened.
 */
export async function openIncidentOnce(
  admin: SupabaseClient,
  kind: string,
  summary: string,
  detail: Record<string, unknown> = {},
): Promise<boolean> {
  try {
    const { data: open } = await admin.from("platform_incidents").select("id").eq("kind", kind).is("resolved_at", null).limit(1);
    if (open && open.length > 0) return false;
    const { error } = await admin.from("platform_incidents").insert({ kind, summary, detail });
    return !error;
  } catch (e) {
    console.error("provider-health: could not open incident", kind, e instanceof Error ? e.message : e);
    return false;
  }
}

/** Resolves every open incident of the given kinds. Returns how many were resolved. Best-effort. */
export async function resolveIncidents(admin: SupabaseClient, kinds: string[], note: string): Promise<number> {
  let resolved = 0;
  try {
    for (const kind of kinds) {
      const { data: open } = await admin.from("platform_incidents").select("id").eq("kind", kind).is("resolved_at", null);
      for (const row of (open ?? []) as { id: string }[]) {
        const { error } = await admin.from("platform_incidents").update({ resolved_at: new Date().toISOString(), resolution_note: note }).eq("id", row.id);
        if (!error) resolved++;
      }
    }
  } catch (e) {
    console.error("provider-health: could not resolve incidents", e instanceof Error ? e.message : e);
  }
  return resolved;
}

export const OUTAGE_SUMMARY =
  "The AI provider reports no credits remaining. Website generation, chat edits and image generation are failing for every user until the account is topped up.";
