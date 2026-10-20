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
  toActivity,
  toRuleItems,
  type DecisionRow,
  type HardRuleRow,
  type OuterTaskTag,
  type RuleItem,
  type SafetyRuleRow,
} from "@/lib/inner-control-ui";
// Stale generated types: control-system tables aren't in types.ts yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = supabase as any;

const ACTIVITY_LIMIT = 8;

/**
 * Decisions made by a NazAI agent that an Outer Control Task asked to run are tagged with that Task: its goal, the tools it asked
 * and, once it completed, its cleaned result. Read-only. Any failure (the columns may not exist yet) just means no tags.
 */
async function loadOuterTaskTags(rows: DecisionRow[]): Promise<Map<string, OuterTaskTag>> {
  try {
    const runIds = [...new Set(rows.map((r) => r.agent_run_id).filter((x): x is string => !!x))];
    if (!runIds.length) return new Map();
    const runs = await anyDb.from("agent_runs").select("id, outer_task_id").in("id", runIds).not("outer_task_id", "is", null);
    const linked = (runs.error ? [] : runs.data ?? []) as { id: string; outer_task_id: string | null }[];
    if (!linked.length) return new Map();
    const taskIds = [...new Set(linked.map((r) => r.outer_task_id).filter((x): x is string => !!x))];
    const [tasks, legs] = await Promise.all([
      anyDb.from("outer_control_workflows").select("id, objective, status, final_output").in("id", taskIds),
      anyDb.from("outer_control_sessions").select("workflow_id, leg_no, tool_id").in("workflow_id", taskIds),
    ]);
    const legRows = (legs.data ?? []) as { workflow_id: string; leg_no: number; tool_id: string }[];
    const tools = await anyDb.from("external_tools").select("id, name").in("id", [...new Set(legRows.map((l) => l.tool_id))]);
    return buildOuterTaskTags({
      runs: linked, tasks: (tasks.data ?? []) as { id: string; objective: string; status: string; final_output: string | null }[],
      legs: legRows, tools: (tools.data ?? []) as { id: string; name: string }[],
    });
  } catch { return new Map(); }
}

/**
 * The rules list and the recent-activity list behind the Inner Control page.
 * Reads the same two tables the rule editors write (hard_rules, safety_rules) and the
 * same decision log the history page reads; changing a rule here writes the same columns
 * the editors do, including the second-owner request when dual control is on.
 */
export function useInnerControlRules() {
  const { user } = useAuth();
  const { accountId, role, permissions } = useActiveAccount();
  const canWrite = hasPermission(role, permissions, "policy");
  const [loading, setLoading] = useState(true);
  const [hard, setHard] = useState<HardRuleRow[]>([]);
  const [safety, setSafety] = useState<SafetyRuleRow[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [taskTags, setTaskTags] = useState<Map<string, OuterTaskTag>>(new Map());
  const [dualControl, setDualControl] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    const [h, s, a, d, p] = await Promise.all([
      anyDb.from("hard_rules")
        .select("id, rule_text, action_type_pattern, effect, enabled, shadow_mode, agent_id, required_approvals, created_at")
        .eq("user_id", accountId).order("created_at", { ascending: false }),
      anyDb.from("safety_rules")
        .select("id, name, pattern, severity, redact, enabled, shadow_mode, agent_id, api_key_id, created_at")
        .eq("user_id", accountId).order("created_at", { ascending: false }),
      anyDb.from("agents").select("id, name").eq("user_id", accountId),
      anyDb.from("agent_decisions")
        .select("id, created_at, decision, source, action_type, description, reasoning, hard_rule_id, escalated, agent_run_id")
        .eq("user_id", accountId).eq("is_test", false)
        .order("created_at", { ascending: false }).limit(ACTIVITY_LIMIT),
      anyDb.from("profiles").select("require_dual_control_for_policy").eq("id", accountId).maybeSingle(),
    ]);
    setHard((h.data ?? []) as HardRuleRow[]);
    setSafety((s.data ?? []) as SafetyRuleRow[]);
    setAgents((a.data ?? []) as { id: string; name: string }[]);
    const decisionRows = (d.data ?? []) as DecisionRow[];
    setDecisions(decisionRows);
    setTaskTags(await loadOuterTaskTags(decisionRows));
    setDualControl(!!(p.data as { require_dual_control_for_policy?: boolean } | null)?.require_dual_control_for_policy);
    setLoading(false);
  }, [accountId]);

  useEffect(() => { void load(); }, [load]);

  const agentName = useCallback(
    (id: string) => agents.find((x) => x.id === id)?.name ?? "Unknown agent",
    [agents],
  );
  const rules: RuleItem[] = useMemo(() => toRuleItems(hard, safety, agentName), [hard, safety, agentName]);
  const counts = useMemo(() => countRules(rules), [rules]);
  const activity = useMemo(
    () => toActivity(decisions, (id) => hard.find((r) => r.id === id)?.rule_text ?? null, (runId) => taskTags.get(runId) ?? null),
    [decisions, hard, taskTags],
  );

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
