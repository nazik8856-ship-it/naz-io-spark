import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { hasPermission } from "@/lib/account-switcher";
import { friendlyErrorMessage } from "@/lib/friendly-errors";
import { toast } from "@/hooks/use-toast";
import {
  buildOuterTaskTags,
  countRules,
  taskActivity,
  toActivity,
  toRuleItems,
  type DecisionRow,
  type HardRuleRow,
  type OuterTaskTag,
  type RuleItem,
  type SafetyRuleRow,
} from "@/lib/inner-control-ui";
import { rulesFor, type InnerProject } from "@/lib/inner-projects";
// Stale generated types: control-system tables aren't in types.ts yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

const ACTIVITY_LIMIT = 8;

/**
 * Actions of a NazAI agent that an Outer Control Task asked to run are tagged with that Task: its goal, the tools it asked and,
 * once it completed, its cleaned result. Also returns the recent runs that carry a Task, so a Task whose agent recorded no
 * decision still gets a row. Read-only. Any failure (the columns may not exist yet) just means no tags.
 */
async function loadOuterTasks(accountId: string, rows: DecisionRow[], project?: InnerProject | null): Promise<{ tags: Map<string, OuterTaskTag>; runs: { id: string; started_at: string }[] }> {
  const none = { tags: new Map<string, OuterTaskTag>(), runs: [] as { id: string; started_at: string }[] };
  try {
    // A website makes no agent runs. An agent shows only the Tasks its own runs took part in.
    if (project?.kind === "website") return none;
    const decisionRuns = [...new Set(rows.map((r) => r.agent_run_id).filter((x): x is string => !!x))];
    let recentQ = anyDb.from("agent_runs").select("id, outer_task_id, started_at").eq("user_id", accountId).not("outer_task_id", "is", null);
    if (project?.kind === "agent") recentQ = recentQ.eq("agent_id", project.id);
    const [recent, ofDecisions] = await Promise.all([
      recentQ.order("started_at", { ascending: false }).limit(10),
      decisionRuns.length ? anyDb.from("agent_runs").select("id, outer_task_id, started_at").in("id", decisionRuns).not("outer_task_id", "is", null) : Promise.resolve({ data: [], error: null }),
    ]);
    const all = [...(recent.error ? [] : recent.data ?? []), ...(ofDecisions.error ? [] : ofDecisions.data ?? [])] as { id: string; outer_task_id: string | null; started_at: string }[];
    const linked = [...new Map(all.map((r) => [r.id, r])).values()];
    if (!linked.length) return none;
    const taskIds = [...new Set(linked.map((r) => r.outer_task_id).filter((x): x is string => !!x))];
    const [tasks, legs] = await Promise.all([
      anyDb.from("outer_control_workflows").select("id, objective, status, final_output").in("id", taskIds),
      anyDb.from("outer_control_sessions").select("workflow_id, leg_no, tool_id").in("workflow_id", taskIds),
    ]);
    const legRows = (legs.data ?? []) as { workflow_id: string; leg_no: number; tool_id: string }[];
    const tools = await anyDb.from("external_tools").select("id, name").in("id", [...new Set(legRows.map((l) => l.tool_id))]);
    const tags = buildOuterTaskTags({
      runs: linked, tasks: (tasks.data ?? []) as { id: string; objective: string; status: string; final_output: string | null }[],
      legs: legRows, tools: (tools.data ?? []) as { id: string; name: string }[],
    });
    return { tags, runs: linked.map((r) => ({ id: r.id, started_at: r.started_at })) };
  } catch { return none; }
}

/**
 * The rules list and the recent-activity list behind the Inner Control page.
 * Reads the same two tables the rule editors write (hard_rules, safety_rules) and the
 * same decision log the history page reads; changing a rule here writes the same columns
 * the editors do, including the second-owner request when dual control is on.
 */
export function useInnerControlRules(project?: InnerProject | null) {
  const { user } = useAuth();
  const { accountId, role, permissions } = useActiveAccount();
  const canWrite = hasPermission(role, permissions, "policy");
  const [loading, setLoading] = useState(true);
  const [hard, setHard] = useState<HardRuleRow[]>([]);
  const [safety, setSafety] = useState<SafetyRuleRow[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [taskTags, setTaskTags] = useState<Map<string, OuterTaskTag>>(new Map());
  const [taskRuns, setTaskRuns] = useState<{ id: string; started_at: string }[]>([]);
  const [dualControl, setDualControl] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const scopeKey = project === undefined ? "account" : project === null ? "none" : project.key;

  const load = useCallback(async () => {
    // null: the project has not been chosen yet (or the account has none), so there is nothing to load.
    if (!accountId || project === null) return;
    // A website makes no decisions of its own: it is checked once, when it is generated.
    const decisionsQuery = project?.kind === "website" ? Promise.resolve({ data: [] }) : (() => {
      let q = anyDb.from("agent_decisions")
        .select("id, created_at, decision, source, action_type, description, reasoning, hard_rule_id, escalated, agent_run_id")
        .eq("user_id", accountId).eq("is_test", false);
      if (project?.kind === "agent") q = q.eq("agent_id", project.id);
      return q.order("created_at", { ascending: false }).limit(ACTIVITY_LIMIT);
    })();
    const [h, s, a, d, p] = await Promise.all([
      anyDb.from("hard_rules")
        .select("id, rule_text, action_type_pattern, effect, enabled, shadow_mode, agent_id, required_approvals, created_at")
        .eq("user_id", accountId).order("created_at", { ascending: false }),
      anyDb.from("safety_rules")
        .select("id, name, pattern, severity, redact, enabled, shadow_mode, agent_id, api_key_id, created_at")
        .eq("user_id", accountId).order("created_at", { ascending: false }),
      anyDb.from("agents").select("id, name").eq("user_id", accountId),
      decisionsQuery,
      anyDb.from("profiles").select("require_dual_control_for_policy").eq("id", accountId).maybeSingle(),
    ]);
    setHard(rulesFor(project, (h.data ?? []) as HardRuleRow[]));
    setSafety(rulesFor(project, (s.data ?? []) as SafetyRuleRow[]));
    setAgents((a.data ?? []) as { id: string; name: string }[]);
    const decisionRows = (d.data ?? []) as DecisionRow[];
    setDecisions(decisionRows);
    const linked = await loadOuterTasks(accountId, decisionRows, project);
    setTaskTags(linked.tags);
    setTaskRuns(linked.runs);
    setDualControl(!!(p.data as { require_dual_control_for_policy?: boolean } | null)?.require_dual_control_for_policy);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, scopeKey]);

  // A different project starts from "loading", so the previous project's rules and decisions never show under the new name.
  useEffect(() => { setLoading(true); }, [scopeKey]);
  useEffect(() => { void load(); }, [load]);

  const agentName = useCallback(
    (id: string) => agents.find((x) => x.id === id)?.name ?? "Unknown agent",
    [agents],
  );
  const rules: RuleItem[] = useMemo(() => toRuleItems(hard, safety, agentName), [hard, safety, agentName]);
  const counts = useMemo(() => countRules(rules), [rules]);
  const activity = useMemo(() => {
    const items = toActivity(decisions, (id) => hard.find((r) => r.id === id)?.rule_text ?? null, (runId) => taskTags.get(runId) ?? null);
    const covered = new Set(items.map((i) => i.task?.id).filter((x): x is string => !!x));
    return [...items, ...taskActivity({ runs: taskRuns, tags: taskTags, covered })].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }, [decisions, hard, taskTags, taskRuns]);

  const table = (r: RuleItem) => (r.kind === "hard" ? "hard_rules" : "safety_rules");

  /** Disable or re-enable: writes the `enabled` column the gate reads. */
  const setEnabled = async (r: RuleItem, enabled: boolean) => {
    if (!user || !canWrite || busyKey) return;
    setBusyKey(r.key);
    const { error } = await anyDb.from(table(r)).update({ enabled }).eq("id", r.id);
    setBusyKey(null);
    if (error) {
      toast({ title: enabled ? "Could not enable rule" : "Could not disable rule", description: friendlyErrorMessage(error.message), variant: "destructive" });
      return;
    }
    toast({ title: enabled ? "Rule enabled" : "Rule disabled", description: enabled ? undefined : "It no longer applies. You can enable it again any time." });
    void load();
  };

  /** Delete, or ask a second owner to approve the deletion when dual control is on. */
  const remove = async (r: RuleItem) => {
    if (!user || !canWrite || busyKey) return;
    setBusyKey(r.key);
    if (dualControl) {
      const { error } = await anyDb.rpc("request_policy_change", {
        _change_type: r.kind === "hard" ? "delete_hard_rule" : "delete_safety_rule",
        _row_id: r.id,
        _description: `Delete ${r.kind === "hard" ? "rule" : "safety rule"} "${r.name}"`,
      });
      setBusyKey(null);
      if (error) {
        toast({ title: "Could not request deletion", description: friendlyErrorMessage(error.message), variant: "destructive" });
        return;
      }
      toast({ title: "Deletion requested", description: "A second owner needs to approve this from Policy change requests before it's removed." });
      return;
    }
    const { error } = await anyDb.from(table(r)).delete().eq("id", r.id);
    setBusyKey(null);
    if (error) {
      toast({ title: "Could not delete rule", description: friendlyErrorMessage(error.message), variant: "destructive" });
      return;
    }
    toast({ title: "Rule deleted" });
    void load();
  };

  return { loading, rules, counts, activity, canWrite, dualControl, busyKey, setEnabled, remove, refetch: load };
}
