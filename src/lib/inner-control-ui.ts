// Inner Control page: the plain wording and small decisions behind the dashboard.
// Pure, so the page stays a layout and these rules are tested alone.

export type RuleKind = "hard" | "safety";
export type RuleStatus = "active" | "disabled";

export type HardRuleRow = {
  id: string;
  rule_text: string;
  action_type_pattern: string;
  effect: "always_block" | "always_require_approval";
  enabled: boolean | null;
  shadow_mode: boolean;
  agent_id: string | null;
  required_approvals: number | null;
  created_at: string;
};

export type SafetyRuleRow = {
  id: string;
  name: string;
  pattern: string;
  severity: "block" | "require_approval";
  redact: boolean | null;
  enabled: boolean;
  shadow_mode: boolean;
  agent_id: string | null;
  api_key_id: string | null;
  created_at: string;
};

/** One line in "Your rules", whichever table the rule lives in. */
export type RuleItem = {
  key: string;
  id: string;
  kind: RuleKind;
  name: string;
  /** What a match does, in words. */
  effect: string;
  /** Where it applies, in words. */
  scope: string;
  status: RuleStatus;
  /** A shadow rule is watched and logged only; it never changes an outcome. */
  shadow: boolean;
  createdAt: string;
};

export const SCOPE_LABELS: Record<string, string> = {
  "*": "Any action",
  send_email: "Sending email",
  reply_email: "Replying to email",
  "slack_*": "Posting to Slack",
  "notion_*": "Notion writes",
  "canva_*": "Canva writes",
  "shopify_*": "Shopify writes",
  "figma_*": "Figma writes",
  create_calendar_event: "Calendar events",
  "*_doc*": "Docs & sheets",
};

export const KIND_LABEL: Record<RuleKind, string> = { hard: "Hard rule", safety: "Safety rule" };

function approverText(n: number | null): string {
  const c = n ?? 2;
  return `${c} approver${c === 1 ? "" : "s"}`;
}

export function toRuleItems(
  hard: HardRuleRow[],
  safety: SafetyRuleRow[],
  agentName: (id: string) => string,
): RuleItem[] {
  const h: RuleItem[] = hard.map((r) => ({
    key: `hard:${r.id}`,
    id: r.id,
    kind: "hard",
    name: r.rule_text,
    effect: r.effect === "always_block" ? "Always blocks" : `Needs approval (${approverText(r.required_approvals)})`,
    scope: `${SCOPE_LABELS[r.action_type_pattern] ?? r.action_type_pattern} · ${r.agent_id ? agentName(r.agent_id) : "All agents"}`,
    // `enabled` is null on rows older than the column: treat as on, as the gate does.
    status: r.enabled === false ? "disabled" : "active",
    shadow: !!r.shadow_mode,
    createdAt: r.created_at,
  }));
  const s: RuleItem[] = safety.map((r) => ({
    key: `safety:${r.id}`,
    id: r.id,
    kind: "safety",
    name: r.name,
    effect: r.redact ? "Removes the matched text" : r.severity === "block" ? "Blocks on a match" : "Needs approval on a match",
    scope: r.agent_id ? agentName(r.agent_id) : r.api_key_id ? "One API key" : "All agents and API keys",
    status: r.enabled ? "active" : "disabled",
    shadow: !!r.shadow_mode,
    createdAt: r.created_at,
  }));
  // Rules that apply come first, newest first, so a rule just added is the first thing seen
  // and disabled ones sink to the bottom.
  const rank = (r: RuleItem) => (r.status === "active" ? 0 : 1);
  return [...h, ...s].sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt));
}

export type RuleCounts = { enforcing: number; shadow: number; disabled: number; total: number };

export function countRules(items: RuleItem[]): RuleCounts {
  const enforcing = items.filter((r) => r.status === "active" && !r.shadow).length;
  const shadow = items.filter((r) => r.status === "active" && r.shadow).length;
  const disabled = items.filter((r) => r.status === "disabled").length;
  return { enforcing, shadow, disabled, total: items.length };
}

/** "3 rules active – Coverage 60%". Shadow rules are named, not counted as active: they enforce nothing. */
export function statusLine(c: RuleCounts, coveragePct: number | null): string {
  const rules = `${c.enforcing} ${c.enforcing === 1 ? "rule" : "rules"} active`;
  const shadow = c.shadow > 0 ? ` (+${c.shadow} in shadow mode)` : "";
  const cov = coveragePct === null ? "Coverage — (no connected capabilities yet)" : `Coverage ${coveragePct}%`;
  return `${rules}${shadow} – ${cov}`;
}

/** Hard/safety rules both missing is the "start from a template" state. */
export function needsTemplate(c: RuleCounts): boolean {
  return c.total === 0;
}

// ---- Recent activity -------------------------------------------------------

export type DecisionRow = {
  id: string;
  created_at: string;
  decision: string;
  source: string;
  action_type: string | null;
  description: string | null;
  reasoning: string | null;
  hard_rule_id: string | null;
  escalated: boolean;
};

export type ActivityTone = "ok" | "warn" | "bad";
export type ActivityItem = {
  id: string;
  at: string;
  verdict: string;
  tone: ActivityTone;
  title: string;
  reason: string;
  /** The hard rule that decided it, when one did and it still exists. */
  ruleId: string | null;
  ruleName: string | null;
  /** A ready-made question for the chat. */
  question: string;
};

const VERDICT_TONE: Record<string, { label: string; tone: ActivityTone }> = {
  allow: { label: "Allowed", tone: "ok" },
  modify: { label: "Changed", tone: "ok" },
  block: { label: "Blocked", tone: "bad" },
  deferred: { label: "Needs approval", tone: "warn" },
  escalate: { label: "Needs approval", tone: "warn" },
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function toActivity(rows: DecisionRow[], hardRuleName: (id: string) => string | null): ActivityItem[] {
  return rows.map((d) => {
    const v = VERDICT_TONE[d.decision] ?? { label: d.decision, tone: "warn" as ActivityTone };
    const what = clip((d.description || d.action_type || "An action").replace(/\s+/g, " ").trim(), 90);
    const ruleName = d.hard_rule_id ? hardRuleName(d.hard_rule_id) : null;
    return {
      id: d.id,
      at: d.created_at,
      verdict: d.escalated && v.tone === "ok" ? `${v.label} after review` : v.label,
      tone: v.tone,
      title: what,
      reason: clip((d.reasoning || "").replace(/\s+/g, " ").trim(), 140),
      ruleId: ruleName ? d.hard_rule_id : null,
      ruleName,
      question: `Why was "${clip(what, 60)}" ${v.label.toLowerCase()}?`,
    };
  });
}

// ---- Chat live status ------------------------------------------------------

/**
 * The steps shown while a message is being handled. They are the real phases the
 * page can see: the message was sent, then the Control System works until its answer
 * arrives. The server does not report sub-steps, so none are invented.
 */
export function chatStepLabels(activeRules: number, dryRun: boolean): { sent: string; working: string } {
  return {
    sent: "Message sent to the Control System",
    working: `${
      activeRules > 0
        ? `Checking ${activeRules} active ${activeRules === 1 ? "rule" : "rules"} and scoring risk`
        : "Running the built-in safety checks and scoring risk"
    }${dryRun ? " (dry run: nothing will be carried out)" : ""}`,
  };
}

export const CHAT_SUGGESTIONS = [
  "Which of my rules are active right now?",
  "Why was my last action blocked?",
  "Should I let this run: send email to all customers",
  "My agent wants to post to #general",
];

export const CHAT_SPEC =
  "Ask about your rules and past decisions, or describe a task or action your AI wants to take. " +
  "The Control System checks it against your rules, scores intent match, risk and confidence, then returns " +
  "Allow, Modify, Block or Needs approval, and logs it to your decision history. " +
  "While it works you see the live status; if a rule needs a person, the approval card appears in this chat.";
