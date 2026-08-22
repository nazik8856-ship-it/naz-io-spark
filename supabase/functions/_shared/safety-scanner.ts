// Deterministic, non-LLM content safety scanner.
//
// Runs INSIDE the unified control gate, BEFORE any model judgement. It is a
// second, independent signal: pure pattern matching over the action params so
// a model mistake alone can never let a high-stakes action through.
//
// Matches can force the verdict to "block" or "require_approval".
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { selectRulesForAgent } from "./rule-matching.ts";

export type SafetySeverity = "block" | "require_approval";

export type SafetyRule = {
  id: string;
  name: string;
  category: string;
  pattern: string;
  severity: SafetySeverity;
  enabled: boolean;
  builtin: boolean;
  agent_id?: string | null;
  /** Matched and recorded, but never affects the scan's actual verdict — same meaning as hard_rules.shadow_mode. */
  shadow_mode?: boolean;
};

export type SafetyMatch = {
  rule_id: string;
  name: string;
  category: string;
  severity: SafetySeverity;
  pattern: string;
  matched_on: string;
  sample: string;
};

export type SafetyScan = {
  matched: boolean;
  severity: SafetySeverity | null;
  matches: SafetyMatch[];
  summary: string | null;
  /** Shadow-mode rules that WOULD have matched — never enforced, informational only. */
  shadowMatches: SafetyMatch[];
};

/** Built-in patterns every account gets for free. Not user-deletable. */
export const BUILTIN_SAFETY_RULES: SafetyRule[] = [
  {
    id: "builtin:secret_key",
    name: "API key or secret in payload",
    category: "secrets",
    pattern: "(sk-[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJhbGciOi[A-Za-z0-9_-]{10,})",
    severity: "block",
    enabled: true,
    builtin: true,
  },
  {
    id: "builtin:card_number",
    name: "Payment card number",
    category: "pii",
    pattern: "\\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\\b",
    severity: "block",
    enabled: true,
    builtin: true,
  },
  {
    id: "builtin:national_id",
    name: "National ID / SSN pattern",
    category: "pii",
    pattern: "\\b[0-9]{3}-[0-9]{2}-[0-9]{4}\\b",
    severity: "block",
    enabled: true,
    builtin: true,
  },
  {
    id: "builtin:destructive",
    name: "Destructive wording",
    category: "destructive",
    pattern: "\\b(drop\\s+table|truncate\\s+table|delete\\s+all|wipe\\s+(all|everything)|permanently\\s+delete|deactivate\\s+all|remove\\s+all\\s+(users|customers|products))\\b",
    severity: "block",
    enabled: true,
    builtin: true,
  },
  {
    id: "builtin:refund_no_id",
    name: "Refund or cancellation without a specific reference",
    category: "financial",
    pattern: "\\b(refund|chargeback|cancel(?:\\s+the)?\\s+(?:order|subscription|plan))\\b",
    severity: "require_approval",
    enabled: true,
    builtin: true,
  },
  {
    id: "builtin:mass_audience",
    name: "Mass-audience send",
    category: "reach",
    pattern: "\\b(all\\s+(customers|subscribers|contacts|users)|entire\\s+(list|database)|everyone\\s+on\\s+the\\s+list|blast)\\b",
    severity: "require_approval",
    enabled: true,
    builtin: true,
  },
  {
    id: "builtin:disposable_recipient",
    name: "Disposable or suspicious recipient domain",
    category: "recipients",
    pattern: "@(mailinator\\.com|guerrillamail\\.com|10minutemail\\.com|tempmail\\.[a-z]+|yopmail\\.com|discard\\.email)",
    severity: "block",
    enabled: true,
    builtin: true,
  },
];

/** Refund/cancel wording is only a concern when no concrete id is supplied. */
const hasConcreteReference = (blob: string) =>
  /\b(order[_ -]?id|invoice[_ -]?id|charge[_ -]?id|subscription[_ -]?id|transaction[_ -]?id)\b/i.test(blob) ||
  /#\d{3,}/.test(blob);

function flatten(params: unknown, description: string): { blob: string; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const walk = (v: unknown, path: string) => {
    if (v === null || v === undefined) return;
    if (typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        walk(val, path ? `${path}.${k}` : k);
      }
      return;
    }
    fields[path || "value"] = String(v);
  };
  walk(params, "");
  fields["description"] = description;
  return { blob: Object.values(fields).join("\n"), fields };
}

export async function loadSafetyRules(
  admin: SupabaseClient,
  userId: string,
  agentId?: string | null,
): Promise<SafetyRule[]> {
  let custom: SafetyRule[] = [];
  try {
    const { data } = await admin
      .from("safety_rules")
      .select("id, name, category, pattern, severity, enabled, agent_id, shadow_mode")
      .eq("user_id", userId)
      .eq("enabled", true);
    custom = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      name: String(r.name ?? "Custom rule"),
      category: String(r.category ?? "custom"),
      pattern: String(r.pattern ?? ""),
      severity: (r.severity === "block" ? "block" : "require_approval") as SafetySeverity,
      enabled: true,
      builtin: false,
      agent_id: (r.agent_id as string | null | undefined) ?? null,
      shadow_mode: Boolean(r.shadow_mode),
    }));
  } catch { /* custom rules are optional */ }
  // Builtins are always account-wide (agent_id undefined -> treated as
  // null by selectRulesForAgent, so they're never filtered out).
  return [...BUILTIN_SAFETY_RULES.filter((r) => r.enabled), ...selectRulesForAgent(custom, agentId).filter((r) => r.pattern)];
}

/** Pure pattern scan — no model involved. */
export function scanWithRules(
  rules: SafetyRule[],
  params: unknown,
  description: string,
): SafetyScan {
  const { blob, fields } = flatten(params, description);
  const matches: SafetyMatch[] = [];

  for (const rule of rules) {
    let re: RegExp;
    try { re = new RegExp(rule.pattern, "i"); } catch { continue; }
    let hitField: string | null = null;
    let sample = "";
    for (const [field, value] of Object.entries(fields)) {
      const m = re.exec(value);
      if (m) { hitField = field; sample = String(m[0]).slice(0, 60); break; }
    }
    if (!hitField) continue;
    if (rule.id === "builtin:refund_no_id" && hasConcreteReference(blob)) continue;
    matches.push({
      rule_id: rule.id,
      name: rule.name,
      category: rule.category,
      severity: rule.severity,
      pattern: rule.pattern,
      matched_on: hitField,
      // Secrets and PII are never echoed back in full.
      sample: rule.category === "secrets" || rule.category === "pii"
        ? `${sample.slice(0, 4)}…redacted`
        : sample,
    });
  }

  if (!matches.length) return { matched: false, severity: null, matches: [], summary: null, shadowMatches: [] };
  const severity: SafetySeverity = matches.some((m) => m.severity === "block") ? "block" : "require_approval";
  const worst = matches.filter((m) => m.severity === severity);
  const summary = severity === "block"
    ? `Blocked by the safety scanner: ${worst.map((m) => m.name).join("; ")}. This is a pattern check, not a model judgement.`
    : `Needs your approval — the safety scanner flagged: ${worst.map((m) => m.name).join("; ")}.`;
  return { matched: true, severity, matches, summary, shadowMatches: [] };
}

export async function scanAction(
  admin: SupabaseClient,
  userId: string,
  params: unknown,
  description: string,
  /**
   * Optional pinned rules (from an active policy version snapshot). When given,
   * the live safety_rules table is NOT read — the snapshot is the source of truth.
   */
  pinnedRules?: SafetyRule[] | null,
  agentId?: string | null,
): Promise<SafetyScan> {
  const rules = pinnedRules
    ? [...BUILTIN_SAFETY_RULES, ...selectRulesForAgent(pinnedRules.filter((r) => r.enabled !== false), agentId)]
    : await loadSafetyRules(admin, userId, agentId);
  // Shadow-mode custom rules (builtins are never shadow) are matched and
  // recorded, but must never change the real verdict — same split
  // hard_rules already gets in control-gate.ts. Scanned separately so a
  // shadow rule can never leak into `matches`/`severity`/`summary`.
  const liveRules = rules.filter((r) => !r.shadow_mode);
  const shadowRules = rules.filter((r) => r.shadow_mode);
  const live = scanWithRules(liveRules, params, description);
  const shadowMatches = shadowRules.length ? scanWithRules(shadowRules, params, description).matches : [];
  return { ...live, shadowMatches };
}

