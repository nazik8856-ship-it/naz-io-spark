// Outer Control: which tools a request will ask, before it starts. Combines the tools named in the request (outer-control-mentions)
// with the ones chosen in the form, says where each came from, and lists what must be settled first: a named tool that was not
// chosen, a word that fits two tools, or a chosen tool whose connection needs attention.
import { detectMentions, namedButNotChosen, type Ambiguous, type MentionTool, type Mentions, type NotConnected } from "@/lib/outer-control-mentions";
import { toolHealth, type ToolHealth, type ToolHealthInput } from "@/lib/outer-control-tools-ui";

export type PlanTool = MentionTool & ToolHealthInput;
export type PlanStep = { tool: PlanTool; source: "named" | "chosen" };
/** test: pressing Test can fix it (never tested, old test, failed). approve: it works; the first session asks you to approve contact. */
export type FixKind = "test" | "approve";
export type PlanWarning = { tool: PlanTool; health: ToolHealth; fix: FixKind };
export type ToolPlan = {
  found: Mentions;
  /** Named in the request, connected, but not chosen; in the order named. */
  missing: PlanTool[];
  ambiguous: Ambiguous[];
  notConnected: NotConnected[];
  /** What will be asked, in order. */
  steps: PlanStep[];
  warnings: PlanWarning[];
  /** More tools were named than this form can take. */
  tooMany: boolean;
  summary: string;
};

/** What a person can do about a tool that is not Working. Mirrors toolHealth: only an unapproved, recently tested tool is "approve". */
export function fixKind(t: ToolHealthInput, now = Date.now()): FixKind | null {
  const h = toolHealth(t, now);
  if (h.key === "working") return null;
  if (h.key === "attention" && t.last_ok_at && !t.last_error && !t.approved_at && h.reason.startsWith("The first session")) return "approve";
  return "test";
}

export function buildToolPlan({ text, tools, chosen, max, now = Date.now() }: { text: string; tools: PlanTool[]; chosen: string[]; max: number; now?: number }): ToolPlan {
  const found = detectMentions(text, tools);
  const { missing, ambiguous } = namedButNotChosen(found, chosen);
  const namedIds = new Set(found.mentions.map((m) => m.tool.id));
  const byId = new Map(tools.map((t) => [t.id, t]));
  const steps: PlanStep[] = chosen.map((id) => byId.get(id)).filter((t): t is PlanTool => !!t).map((tool) => ({ tool, source: namedIds.has(tool.id) ? "named" : "chosen" }));
  const warnings: PlanWarning[] = [];
  for (const s of steps) {
    const fix = fixKind(s.tool, now);
    if (fix) warnings.push({ tool: s.tool, health: toolHealth(s.tool, now), fix });
  }
  const summary = steps.length === 0 ? "" : `Will ask: ${steps.map((s, i) => `${steps.length > 1 ? `${i + 1}. ` : ""}${s.tool.name} (${s.source === "named" ? "named in your request" : "chosen by you"})`).join(" → ")}`;
  return { found, missing: missing as PlanTool[], ambiguous, notConnected: found.notConnected, steps, warnings, tooMany: found.mentions.length > max, summary };
}

/** Why Start must wait, or null. kept: the person chose to keep their own choice. acked: warnings they decided to go ahead with. */
export function planBlock(plan: ToolPlan, kept: boolean, acked: Set<string>): string | null {
  if ((plan.missing.length || plan.ambiguous.length) && !kept) return "Choose which tool to use first.";
  const open = plan.warnings.find((w) => !acked.has(w.tool.id));
  if (open) return `Decide what to do about ${open.tool.name} first.`;
  return null;
}

/** A stable key for what needs settling, so a decision is asked again when the request names something new. */
export const settleKey = (plan: ToolPlan) => [...plan.missing.map((t) => t.id), ...plan.ambiguous.map((a) => a.word)].join(",");
