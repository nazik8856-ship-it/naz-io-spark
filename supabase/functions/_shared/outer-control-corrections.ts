// Outer Control: the record of what a person did to the brain's decisions (approved, declined,
// rewrote), read back so similar replies are handled with that in mind. Only outcomes, rule ids and
// word-hash fingerprints are stored, never text. Failing to read or write never stops a session.
import type { Correction } from "./outer-control-judgement.ts";

// deno-lint-ignore no-explicit-any
type AnyAdmin = any;

export const CORRECTIONS_FETCH_LIMIT = 200;

type Owner = { id: string; user_id: string; api_key_id: string | null };

/** The most recent corrections for this account (and API key, when the session runs under one). */
export async function loadCorrections(admin: AnyAdmin, s: Pick<Owner, "user_id" | "api_key_id">): Promise<Correction[]> {
  try {
    let q = admin.from("outer_control_corrections").select("outcome, rule_ids, rule_names, fingerprint")
      .eq("user_id", s.user_id).order("created_at", { ascending: false }).limit(CORRECTIONS_FETCH_LIMIT);
    q = s.api_key_id ? q.eq("api_key_id", s.api_key_id) : q.is("api_key_id", null);
    const { data } = await q;
    return ((data ?? []) as Correction[]).filter((c) => c && ["approved", "declined", "edited"].includes(c.outcome) && Array.isArray(c.fingerprint));
  } catch { return []; }
}

/** What a step's stored `decision` must carry for a later correction to be matched back to it. */
export type StoredDecision = {
  rule_ids?: unknown; applied?: unknown; fingerprint?: unknown; risk?: { level?: unknown } | null;
} | null | undefined;

const strings = (v: unknown, max: number): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max) : []);

export async function recordCorrection(
  admin: AnyAdmin, s: Owner, stepNo: number, outcome: Correction["outcome"], decision: StoredDecision,
): Promise<void> {
  try {
    const fingerprint = Array.isArray(decision?.fingerprint) ? (decision!.fingerprint as unknown[]).filter((n): n is number => Number.isInteger(n)).slice(0, 64) : [];
    if (!fingerprint.length) return; // an older step without a fingerprint cannot be matched later
    const risk = decision?.risk?.level;
    await admin.from("outer_control_corrections").insert({
      user_id: s.user_id, api_key_id: s.api_key_id, session_id: s.id, step_no: stepNo, outcome,
      rule_ids: strings(decision?.rule_ids, 10), rule_names: strings(decision?.applied, 10),
      risk: risk === "low" || risk === "medium" || risk === "high" ? risk : null, fingerprint,
    });
  } catch { /* learning is an aid; the run never depends on writing it */ }
}
