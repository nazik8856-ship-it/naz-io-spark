// "Policy autonomy" plan, item 13: opt-in, coarse anonymized precedent
// sharing across accounts. A brand-new API key starts with zero history
// of its own -- if OTHER accounts opt in, a new key can benefit from
// real, coarse patterns across those accounts for the same category of
// action, instead of a cold start with nothing.
//
// Per the user's own explicit scope decision, this carries ONLY
// action_type + provider + aggregate verdict shares across the account
// boundary -- never free text, never params, never the embedding vector
// itself. Reuses isNonAllowDecision (control-api-abuse.ts) -- the exact
// same "does this decision text start with ALLOW" classification already
// proven for that sibling per-key aggregation, applied here across
// opted-in accounts instead of within one account's own keys.
//
// Never blended into or confused with an account's own real precedent
// (precedent-search.ts's findPrecedent, precedent-advice.ts's
// evaluatePrecedentForAutoApprove) -- always presented as a distinct,
// coarser signal, and never itself auto-resolves anything: read-only.
import { isNonAllowDecision } from "./control-api-abuse.ts";

export type CrossAccountDecisionRow = { user_id: string; action_type: string; provider: string | null; decision: string };

export type CrossAccountStat = {
  action_type: string;
  provider: string | null;
  total_count: number;
  non_allow_count: number;
  contributing_account_count: number;
};

/**
 * Pure -- aggregates a batch of opted-in accounts' own decisions into
 * one coarse stat per (action_type, provider) shape. `contributing_
 * account_count` is a DISTINCT count of accounts that had at least one
 * decision of that exact shape -- the anonymity safeguard this whole
 * feature depends on: a single contributor's own numbers must never be
 * exposed as if they were "the" cross-account average (see
 * MIN_CONTRIBUTING_ACCOUNTS below, enforced at read time).
 */
export function aggregateCrossAccountStats(rows: CrossAccountDecisionRow[]): CrossAccountStat[] {
  const groups = new Map<string, { action_type: string; provider: string | null; total: number; nonAllow: number; accounts: Set<string> }>();
  for (const r of rows) {
    if (!r.action_type || !r.user_id) continue;
    const key = `${r.action_type}::${r.provider ?? ""}`;
    const g = groups.get(key) ?? { action_type: r.action_type, provider: r.provider ?? null, total: 0, nonAllow: 0, accounts: new Set<string>() };
    g.total += 1;
    if (isNonAllowDecision(r.decision)) g.nonAllow += 1;
    g.accounts.add(r.user_id);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({
    action_type: g.action_type,
    provider: g.provider,
    total_count: g.total,
    non_allow_count: g.nonAllow,
    contributing_account_count: g.accounts.size,
  }));
}

/** Never share a stat contributed by fewer than this many distinct accounts -- a lone contributor's own real numbers must never be exposed as if they were a cross-account pattern. */
export const MIN_CONTRIBUTING_ACCOUNTS = 2;
/** Below this many total decisions, even with enough contributing accounts, the share is too noisy to call a real pattern. */
export const MIN_TOTAL_SAMPLE = 5;

export type CoarsePrecedentLookup =
  | { available: false; reason: "no_data" | "too_few_contributing_accounts" | "too_small_sample" }
  | { available: true; nonAllowShare: number; totalCount: number; contributingAccountCount: number };

/** Pure -- is this stored aggregate row real enough to actually share, or does it stay hidden until more accounts/volume opt in? */
export function evaluateCoarsePrecedentLookup(stat: CrossAccountStat | null): CoarsePrecedentLookup {
  if (!stat) return { available: false, reason: "no_data" };
  if (stat.contributing_account_count < MIN_CONTRIBUTING_ACCOUNTS) return { available: false, reason: "too_few_contributing_accounts" };
  if (stat.total_count < MIN_TOTAL_SAMPLE) return { available: false, reason: "too_small_sample" };
  return {
    available: true,
    nonAllowShare: Math.round((stat.non_allow_count / stat.total_count) * 100) / 100,
    totalCount: stat.total_count,
    contributingAccountCount: stat.contributing_account_count,
  };
}

export function summarizeCoarsePrecedentLookup(lookup: CoarsePrecedentLookup, actionType: string, provider: string | null): string {
  const scope = provider ? `${actionType} on ${provider}` : actionType;
  if (!lookup.available) {
    if (lookup.reason === "too_few_contributing_accounts") {
      return `Not enough OTHER opted-in accounts have real history for "${scope}" yet to share a coarse pattern anonymously.`;
    }
    if (lookup.reason === "too_small_sample") {
      return `Opted-in accounts have too few real decisions for "${scope}" yet to share a meaningful coarse pattern.`;
    }
    return `No opted-in cross-account data available yet for "${scope}".`;
  }
  return (
    `Across ${lookup.contributingAccountCount} opted-in accounts' real history, ${Math.round(lookup.nonAllowShare * 100)}% of ` +
    `${lookup.totalCount} similar "${scope}" actions were NOT clean allows -- a coarse, anonymized signal, not this account's own precedent.`
  );
}
