// Blueprint task #78: ports the pure gating/noise-threshold logic from
// supabase/functions/_shared/cross-account-precedent.ts so the dashboard
// can show the same coarse, anonymized signal the Control API already
// exposes at GET /control-api/v1/precedent/cross-account -- edge-function
// _shared files aren't bundled into the Vite app, so this is a deliberate
// duplicate of that file's pure functions (same values, same behavior),
// not a new concept. Keep MIN_CONTRIBUTING_ACCOUNTS/MIN_TOTAL_SAMPLE in
// sync with the edge-function copy if either ever changes.
export type CrossAccountStat = {
  action_type: string;
  provider: string | null;
  total_count: number;
  non_allow_count: number;
  contributing_account_count: number;
};

export const MIN_CONTRIBUTING_ACCOUNTS = 2;
export const MIN_TOTAL_SAMPLE = 5;

export type CoarsePrecedentLookup =
  | { available: false; reason: "too_few_contributing_accounts" | "too_small_sample" }
  | { available: true; nonAllowShare: number; totalCount: number; contributingAccountCount: number };

/** Pure -- is this stored aggregate row real enough to actually show? */
export function evaluateCoarsePrecedentLookup(stat: CrossAccountStat): CoarsePrecedentLookup {
  if (stat.contributing_account_count < MIN_CONTRIBUTING_ACCOUNTS) return { available: false, reason: "too_few_contributing_accounts" };
  if (stat.total_count < MIN_TOTAL_SAMPLE) return { available: false, reason: "too_small_sample" };
  return {
    available: true,
    nonAllowShare: Math.round((stat.non_allow_count / stat.total_count) * 100) / 100,
    totalCount: stat.total_count,
    contributingAccountCount: stat.contributing_account_count,
  };
}
