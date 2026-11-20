// Inner Control Day 3 (#174): each rule shows what it did. In the rules list, under each rule: when it last matched and how often
// in the last 7 days, or plainly that it never matched. From real records only:
//   a hard rule     the decisions it decided (agent_decisions.hard_rule_id); in shadow mode, what it would have done
//                   (hard_rule_shadow_hits)
//   a safety rule   the reply checks it matched (outer_control_evaluations.matches; in shadow mode, shadow_matches)
//   a rule in plain words   the same reply checks, as "meaning:<id>"
// Looked back over 90 days, so "no match" says how far it looked. Pure.
import { sinceText, type RuleItem } from "@/lib/inner-control-ui";

export const RULE_ACTIVITY_DAYS = 90;
export const RULE_ACTIVITY_WEEK_DAYS = 7;

export type RuleHit = { key: string; at: string };
export type RuleActivity = { last: string | null; week: number };

type Match = { rule_id?: unknown };
const keyOfMatch = (m: Match): string | null => {
  const id = typeof m?.rule_id === "string" ? m.rule_id : "";
  if (!id) return null;
  return id.startsWith("meaning:") ? `meaning:${id.slice("meaning:".length)}` : `safety:${id}`;
};

/** Every recorded match, keyed like the rules list (hard:/safety:/meaning:<id>). A shadow rule's hits are its would-have matches. */
export function ruleHitsOf(src: {
  decisions: { hard_rule_id: string | null; created_at: string }[];
  shadowHits: { rule_id: string | null; created_at: string }[];
  evaluations: { matches: unknown; shadow_matches: unknown; created_at: string }[];
}): RuleHit[] {
  const out: RuleHit[] = [];
  for (const d of src.decisions) if (d.hard_rule_id) out.push({ key: `hard:${d.hard_rule_id}`, at: d.created_at });
  for (const h of src.shadowHits) if (h.rule_id) out.push({ key: `hard:${h.rule_id}`, at: h.created_at });
  for (const e of src.evaluations) {
    // One reply counts once per rule, however many times the rule matched in it.
    const keys = new Set<string>();
    for (const list of [e.matches, e.shadow_matches]) {
      if (!Array.isArray(list)) continue;
      for (const m of list as Match[]) { const k = keyOfMatch(m); if (k) keys.add(k); }
    }
    for (const k of keys) out.push({ key: k, at: e.created_at });
  }
  return out;
}

/** Per rule: the newest match and how many in the last 7 days. */
export function ruleActivityOf(hits: RuleHit[], now: number): Map<string, RuleActivity> {
  const weekStart = now - RULE_ACTIVITY_WEEK_DAYS * 86_400_000;
  const out = new Map<string, RuleActivity>();
  for (const h of hits) {
    const t = Date.parse(h.at);
    if (!Number.isFinite(t)) continue;
    const a = out.get(h.key) ?? { last: null, week: 0 };
    if (!a.last || t > Date.parse(a.last)) a.last = h.at;
    if (t >= weekStart) a.week++;
    out.set(h.key, a);
  }
  return out;
}

const times = (n: number) => (n === 1 ? "once" : `${n} times`);

/**
 * The line under a rule. A shadow rule says what it would have done; a rule that never matched says so, and how far back that was
 * looked ("never matched yet" for a rule younger than the look-back).
 */
export function ruleActivityLine(r: Pick<RuleItem, "shadow" | "createdAt">, a: RuleActivity | undefined, now: number): string {
  const verb = r.shadow ? "Would have matched" : "Matched";
  if (!a?.last) {
    const young = now - Date.parse(r.createdAt) < RULE_ACTIVITY_DAYS * 86_400_000;
    if (young) return r.shadow ? "Has not matched anything yet." : "Never matched yet.";
    return `No match in the last ${RULE_ACTIVITY_DAYS} days.`;
  }
  const last = `last ${sinceText(a.last, now)}`;
  if (a.week > 0) return `${verb} ${times(a.week)} in the last ${RULE_ACTIVITY_WEEK_DAYS} days · ${last}`;
  return `${r.shadow ? "Would have last matched" : "Last matched"} ${sinceText(a.last, now)} · none in the last ${RULE_ACTIVITY_WEEK_DAYS} days`;
}
