// Outer Control (active): decides what a request should carry BEFORE it is sent, so the
// tool is already working inside the account's rules, and refuses to send a request that
// itself breaks a rule that cannot be worked around.
import { scanWithRules, type SafetyRule } from "./safety-scanner.ts";
import { textSafeToStore } from "./outer-control-text-review.ts";
import type { RuleLine } from "./outer-control-tool-request.ts";
import { ruleNamesSeen, type MemoryEntry } from "./outer-control-memory.ts";

export const MAX_RULES_IN_REQUEST = 25;

export type RequestPlan = {
  /** Most relevant first: rules already triggered in this run, then blocking, approval, removal. */
  rules: RuleLine[];
  /** Names of rules replies in this run already triggered. */
  avoid: string[];
  /** Rules that did not fit; replies are still checked against them. */
  omitted: number;
};

const WEIGHT: Record<RuleLine["action"], number> = { block: 0, approval: 1, remove_text: 2 };

export function planRequest(input: { rules: RuleLine[]; memory: MemoryEntry[] }): RequestPlan {
  const avoid = ruleNamesSeen(input.memory);
  const seen = new Set(avoid);
  const tagged = input.rules.map((r, i) => ({ r: { ...r, matchedBefore: seen.has(r.name) }, i }));
  tagged.sort((a, b) =>
    Number(b.r.matchedBefore) - Number(a.r.matchedBefore) || WEIGHT[a.r.action] - WEIGHT[b.r.action] || a.i - b.i
  );
  const kept = tagged.slice(0, MAX_RULES_IN_REQUEST).map((t) => t.r);
  return { rules: kept, avoid, omitted: Math.max(0, tagged.length - kept.length) };
}

export type Preflight = { ok: boolean; names: string[] };

/**
 * Scans the text that is about to leave the platform. Anything the rules can remove is
 * masked first (that is what is actually sent); a blocking match that is still there
 * cannot be worked around, so the request must not go out.
 */
export function preflightRequest(rules: SafetyRule[], texts: (string | null | undefined)[]): Preflight {
  const live = rules.filter((r) => !r.shadow_mode);
  const names: string[] = [];
  for (const t of texts) {
    if (!t) continue;
    const first = scanWithRules(live, t, "");
    const masked = textSafeToStore(t, first.matches);
    // Text that could not be masked is withheld wholesale: whatever blocked it is still a blocker.
    const withheld = masked.startsWith("[content withheld");
    const again = withheld ? first : scanWithRules(live, masked, "");
    for (const m of again.matches) if (m.severity === "block" && !names.includes(m.name)) names.push(m.name);
  }
  return { ok: names.length === 0, names };
}
