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
  enforcementPulse,
  type EnforcementPulse,
  taskAnswerRuleCount,
  taskActivity,
  toActivity,
  toRuleItems,
  type DecisionRow,
  type HardRuleRow,
  type MeaningRuleRow,
  type OuterTaskTag,
  type RuleItem,
  type SafetyRuleRow,
} from "@/lib/inner-control-ui";
import { rulesFor, type InnerProject } from "@/lib/inner-projects";
import { ocRead } from "@/lib/outer-control-read"; // encrypted content is read through the server (data encryption, front 3)
import { hardPatch, meaningPatch, safetyPatch, writeOutcome, type HardEdit, type MeaningEdit, type SafetyEdit } from "@/lib/inner-rule-edit";

/** What each kind of rule is called in a change request, and the table it lives in. */
const KIND_INFO = {
  hard: { table: "hard_rules", word: "rule", type: "hard_rule" },
  safety: { table: "safety_rules", word: "safety rule", type: "safety_rule" },
  meaning: { table: "meaning_rules", word: "rule in plain words", type: "meaning_rule" },
} as const;
export type RuleEditOf = HardEdit | SafetyEdit | MeaningEdit;
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
      ocRead("outer_control_workflows").select("id, objective, status, final_output").in("id", taskIds),
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
  const [meaning, setMeaning] = useState<MeaningRuleRow[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [taskTags, setTaskTags] = useState<Map<string, OuterTaskTag>>(new Map());
  const [taskRuns, setTaskRuns] = useState<{ id: string; started_at: string }[]>([]);
  const [dualControl, setDualControl] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pulse, setPulse] = useState<EnforcementPulse | null>(null);

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
    // What ran under the rules (the status card): today's checks from the viewer's midnight, and the newest answer check.
    // A website makes no checks of its own; an agent shows only its own.
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const since = midnight.toISOString();
    const skipPulse = project?.kind === "website";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const agentOnly = (q: any) => (project?.kind === "agent" ? q.eq("agent_id", project.id) : q);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pulseQueries: Promise<any>[] = skipPulse ? [0, 1, 2, 3].map(() => Promise.resolve({ data: [] })) : [
      agentOnly(anyDb.from("agent_decisions").select("decision, action_type, created_at").eq("user_id", accountId).eq("is_test", false).gte("created_at", since)).limit(2000),
      // Answer checks only: an action check (content_kind action) already has its decision row above.
      agentOnly(anyDb.from("outer_control_evaluations").select("verdict, created_at").eq("user_id", accountId).eq("content_kind", "text").gte("created_at", since)).limit(2000),
      agentOnly(anyDb.from("outer_control_evaluations").select("created_at").eq("user_id", accountId).eq("content_kind", "text")).order("created_at", { ascending: false }).limit(1),
      // The newest decision that is a check (it starts with a verdict word), not an agent step such as Call tool.
      agentOnly(anyDb.from("agent_decisions").select("created_at").eq("user_id", accountId).eq("is_test", false)
        // One word per VERDICT_WORDS entry (held to it by inner-control-ui.test.ts); a fixed text, no input in it.
        .or("decision.ilike.ALLOW%,decision.ilike.BLOCK%,decision.ilike.MODIFY%,decision.ilike.DEFERRED%,decision.ilike.ESCALATE%,decision.ilike.APPROVAL_REQUIRED%,decision.ilike.REQUIRE_APPROVAL%"))
        .order("created_at", { ascending: false }).limit(1),
    ];
    const [h, s, a, d, p, mr, dt, et, el, dl] = await Promise.all([
      anyDb.from("hard_rules")
        .select("id, rule_text, action_type_pattern, effect, provider, enabled, shadow_mode, agent_id, api_key_id, required_approvals, created_at")
        .eq("user_id", accountId).order("created_at", { ascending: false }),
      anyDb.from("safety_rules")
        .select("id, name, pattern, severity, redact, enabled, shadow_mode, agent_id, api_key_id, created_at")
        .eq("user_id", accountId).order("created_at", { ascending: false }),
      anyDb.from("agents").select("id, name").eq("user_id", accountId),
      decisionsQuery,
      anyDb.from("profiles").select("require_dual_control_for_policy").eq("id", accountId).maybeSingle(),
      // Rules in plain words for the whole account (a project's own are on its page).
      anyDb.from("meaning_rules").select("id, name, description, action, enabled, shadow_mode, created_at")
        .eq("user_id", accountId).is("project_id", null).order("created_at", { ascending: false }),
      ...pulseQueries,
    ]);
    setHard(rulesFor(project, (h.data ?? []) as HardRuleRow[]));
    setSafety(rulesFor(project, (s.data ?? []) as SafetyRuleRow[]));
    setMeaning((mr.data ?? []) as MeaningRuleRow[]);
    setAgents((a.data ?? []) as { id: string; name: string }[]);
    const decisionRows = (d.data ?? []) as DecisionRow[];
    setDecisions(decisionRows);
    // A query that failed is not "nothing ran": the pulse stays unknown and the card says it is still checking.
    const pulseFailed = [dt, et, el, dl].some((r) => (r as { error?: unknown }).error);
    setPulse(skipPulse || pulseFailed ? null : enforcementPulse(
      (dt.data ?? []) as { decision: string; action_type: string | null; created_at: string }[],
      (et.data ?? []) as { verdict: string | null; created_at: string }[],
      [((dl.data ?? []) as { created_at: string }[])[0]?.created_at, ((el.data ?? []) as { created_at: string }[])[0]?.created_at],
    ));
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
  const rules: RuleItem[] = useMemo(() => toRuleItems(hard, safety, agentName, meaning), [hard, safety, agentName, meaning]);
  const counts = useMemo(() => countRules(rules), [rules]);
  /** The rules that check the answers of a Task the chat runs (the same choice the server makes). */
  const taskRules = useMemo(() => taskAnswerRuleCount(hard, safety, meaning), [hard, safety, meaning]);
  const activity = useMemo(() => {
    const items = toActivity(decisions, (id) => hard.find((r) => r.id === id)?.rule_text ?? null, (runId) => taskTags.get(runId) ?? null);
    const covered = new Set(items.map((i) => i.task?.id).filter((x): x is string => !!x));
    return [...items, ...taskActivity({ runs: taskRuns, tags: taskTags, covered })].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }, [decisions, hard, taskTags, taskRuns]);

  const table = (r: RuleItem) => KIND_INFO[r.kind].table;
  const word = (r: RuleItem) => KIND_INFO[r.kind].word;
  const changeType = (verb: "disable" | "delete" | "edit" | "promote", r: RuleItem) => `${verb}_${KIND_INFO[r.kind].type}`;

  /** The stored row behind a list item, for the Edit dialog. */
  const rowOf = (r: RuleItem): HardRuleRow | SafetyRuleRow | MeaningRuleRow | null =>
    (r.kind === "hard" ? hard.find((x) => x.id === r.id) : r.kind === "safety" ? safety.find((x) => x.id === r.id) : meaning.find((x) => x.id === r.id)) ?? null;

  /** Asks a second owner to approve a change (dual control). Says why when the request itself could not be made. */
  const requestChange = async (changeType: string, r: RuleItem, description: string, newValue?: Record<string, unknown>): Promise<boolean> => {
    const { error } = await anyDb.rpc("request_policy_change", { _change_type: changeType, _row_id: r.id, _description: description, ...(newValue ? { _new_value: newValue } : {}) });
    if (error) {
      toast({ title: "Could not request the change", description: friendlyErrorMessage(error.message), variant: "destructive" });
      return false;
    }
    return true;
  };

  /** Disable or re-enable: writes the `enabled` column the gate reads. A change the database refused is said, never shown as done. */
  const setEnabled = async (r: RuleItem, enabled: boolean) => {
    if (!user || !canWrite || busyKey) return;
    setBusyKey(r.key);
    // Switching a rule off weakens it like deleting it does: with dual control on, a second owner approves it first.
    if (dualControl && !enabled) {
      const ok = await requestChange(changeType("disable", r), r, `Switch off ${word(r)} "${r.name}"`);
      setBusyKey(null);
      if (ok) toast({ title: "Switch-off requested", description: "A second owner needs to approve this from Policy change requests. The rule applies until then." });
      return;
    }
    const out = writeOutcome(await anyDb.from(table(r)).update({ enabled }).eq("id", r.id).eq("user_id", accountId).select("id"));
    setBusyKey(null);
    if (out.ok === false) {
      toast({ title: enabled ? "Could not enable rule" : "Could not disable rule", description: friendlyErrorMessage(out.message), variant: "destructive" });
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
        _change_type: changeType("delete", r),
        _row_id: r.id,
        _description: `Delete ${word(r)} "${r.name}"`,
      });
      setBusyKey(null);
      if (error) {
        toast({ title: "Could not request deletion", description: friendlyErrorMessage(error.message), variant: "destructive" });
        return;
      }
      toast({ title: "Deletion requested", description: "A second owner needs to approve this from Policy change requests before it's removed." });
      return;
    }
    const out = writeOutcome(await anyDb.from(table(r)).delete().eq("id", r.id).eq("user_id", accountId).select("id"));
    setBusyKey(null);
    if (out.ok === false) {
      toast({ title: "Could not delete rule", description: friendlyErrorMessage(out.message), variant: "destructive" });
      return;
    }
    toast({ title: "Rule deleted" });
    void load();
  };

  /**
   * Edit: changes what the rule says and does, in place (the same columns the Add forms write). Its on/off and shadow state are
   * kept. Resolves true when the database changed the rule.
   */
  const edit = async (r: RuleItem, e: RuleEditOf): Promise<boolean> => {
    if (!user || !canWrite || busyKey) return false;
    setBusyKey(r.key);
    const patch = r.kind === "hard" ? hardPatch(e as HardEdit) : r.kind === "safety" ? safetyPatch(e as SafetyEdit) : meaningPatch(e as MeaningEdit);
    // With dual control on, an edit is a request: the rule keeps working as it is until a second owner approves the change.
    if (dualControl) {
      const ok = await requestChange(changeType("edit", r), r, `Edit ${word(r)} "${r.name}"`, patch);
      setBusyKey(null);
      if (ok) toast({ title: "Edit requested", description: "A second owner needs to approve this from Policy change requests. The rule stays as it is until then." });
      return ok;
    }
    const out = writeOutcome(await anyDb.from(table(r)).update(patch).eq("id", r.id).eq("user_id", accountId).select("id"));
    setBusyKey(null);
    if (out.ok === false) {
      toast({ title: "Could not save the rule", description: friendlyErrorMessage(out.message), variant: "destructive" });
      return false;
    }
    toast({ title: "Rule updated", description: r.shadow ? "It is still in shadow mode: watched and logged only." : "The change applies from the next action." });
    void load();
    return true;
  };

  /**
   * Go live: a rule in shadow mode starts changing outcomes. With dual control on, a second owner approves it first (the database
   * refuses the direct change). Resolves true when it went live or the request was made.
   */
  const promote = async (r: RuleItem): Promise<boolean> => {
    if (!user || !canWrite || busyKey || !r.shadow) return false;
    setBusyKey(r.key);
    if (dualControl) {
      const ok = await requestChange(changeType("promote", r), r, `Make ${word(r)} "${r.name}" live`);
      setBusyKey(null);
      if (ok) toast({ title: "Going live requested", description: "A second owner needs to approve this from Policy change requests. It stays in shadow mode until then." });
      return ok;
    }
    const out = writeOutcome(await anyDb.from(table(r)).update({ shadow_mode: false, promoted_at: new Date().toISOString() }).eq("id", r.id).eq("user_id", accountId).select("id"));
    setBusyKey(null);
    if (out.ok === false) {
      toast({ title: "Could not make the rule live", description: friendlyErrorMessage(out.message), variant: "destructive" });
      return false;
    }
    toast({ title: "Rule is live", description: "It now changes outcomes, from the next reply or action." });
    void load();
    return true;
  };

  return { loading, rules, counts, taskRules, pulse, activity, canWrite, dualControl, busyKey, setEnabled, remove, edit, promote, rowOf, meaning, refetch: load };
}
