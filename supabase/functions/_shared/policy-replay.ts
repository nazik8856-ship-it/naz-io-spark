// Scenario replay for policy versions.
//
// Re-evaluates the 30 control scenarios against a policy SNAPSHOT (the exact
// artifact a policy version pins) using only the deterministic layers of the
// gate — hard rules and the content safety scanner. No model calls, no writes,
// no provider traffic, so a replay is cheap enough to run before every
// activation.
//
// It answers one question: does this draft policy change how the control
// system judges the scenarios, and does it break anything that used to pass?
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CONTROL_SCENARIOS, type Scenario, type Verdict } from "./control-scenarios.ts";
import { BUILTIN_SAFETY_RULES, scanWithRules, type SafetyRule } from "./safety-scanner.ts";
import {
  diffRealAction,
  summarizeRealTrafficReplay,
  type RealActionDiff,
  type RealDecisionRow,
  type RealTrafficReplaySummary,
} from "./real-traffic-replay.ts";

export type PolicySnapshot = {
  hard_rules?: unknown;
  safety_rules?: unknown;
  thresholds?: unknown;
  spend_cap?: unknown;
  captured_at?: string;
};

type HardRule = {
  id: string;
  rule_text: string;
  action_type_pattern: string;
  effect: "always_block" | "always_require_approval";
  provider: string | null;
  enabled?: boolean;
  shadow_mode?: boolean;
};

/** Deterministic outcome of the policy layers for one scenario. */
export type GateOutcome = "block" | "require_approval" | "pass_through";

export type ScenarioResult = {
  id: string;
  name: string;
  category: string;
  expected: Verdict;
  also_acceptable: Verdict[];
  gate_outcome: GateOutcome;
  gate_source: "hard_rule" | "safety_scanner" | null;
  gate_detail: string | null;
  status: "pass" | "fail";
};

const globToRe = (p: string) =>
  new RegExp(
    "^" + p.trim().split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$",
    "i",
  );

const asHardRules = (snapshot: PolicySnapshot): HardRule[] =>
  (Array.isArray(snapshot.hard_rules) ? (snapshot.hard_rules as HardRule[]) : [])
    .filter((r) => r && r.enabled !== false && !r.shadow_mode);

const asSafetyRules = (snapshot: PolicySnapshot): SafetyRule[] => [
  ...BUILTIN_SAFETY_RULES,
  ...(Array.isArray(snapshot.safety_rules) ? (snapshot.safety_rules as SafetyRule[]) : [])
    // Same exclusion asHardRules already applies to shadow_mode hard rules
    // -- a replay answers "what does this draft policy actually enforce,"
    // and a shadow-mode rule never enforces anything.
    .filter((r) => r && r.enabled !== false && !r.shadow_mode),
];

/** Deterministic outcome of just the gate layers -- no expected/status
 * grading, since a real action (unlike a scenario) has no "correct
 * answer" to grade against, only a diff against what another policy
 * snapshot would have decided. `evaluateScenario` below wraps this with
 * that grading; real-traffic-replay.ts calls this directly. */
export function evaluateAction(
  action: { action_type: string; provider: string; description: string; params: unknown },
  snapshot: PolicySnapshot,
): { gate_outcome: GateOutcome; gate_source: ScenarioResult["gate_source"]; gate_detail: string | null } {
  let gate_outcome: GateOutcome = "pass_through";
  let gate_source: ScenarioResult["gate_source"] = null;
  let gate_detail: string | null = null;

  const matched = asHardRules(snapshot).find((r) => {
    if (r.provider && r.provider.toLowerCase() !== action.provider.toLowerCase()) return false;
    try { return globToRe(r.action_type_pattern || "*").test(action.action_type); } catch { return false; }
  });
  if (matched) {
    gate_outcome = matched.effect === "always_block" ? "block" : "require_approval";
    gate_source = "hard_rule";
    gate_detail = `Hard rule: "${matched.rule_text}"`;
  } else {
    const scan = scanWithRules(asSafetyRules(snapshot), action.params, action.description);
    if (scan.matched && scan.severity) {
      gate_outcome = scan.severity === "block" ? "block" : "require_approval";
      gate_source = "safety_scanner";
      gate_detail = scan.summary ?? scan.matches.map((m) => m.name).join("; ");
    }
  }

  return { gate_outcome, gate_source, gate_detail };
}

/** Run the deterministic policy layers of the gate over one scenario. */
export function evaluateScenario(s: Scenario, snapshot: PolicySnapshot): ScenarioResult {
  const accepted = new Set<Verdict>([s.expected, ...(s.also_acceptable ?? [])]);
  const { gate_outcome, gate_source, gate_detail } = evaluateAction(s, snapshot);

  // A deterministic stop only counts as correct when the scenario would accept
  // that verdict. A pass-through is correct unless the scenario must be blocked
  // outright — those are the ones a policy has to catch without the model.
  const status: ScenarioResult["status"] =
    gate_outcome === "block"
      ? (accepted.has("block") ? "pass" : "fail")
      : gate_outcome === "require_approval"
        ? (accepted.has("modify") || accepted.has("deferred") || accepted.has("block") ? "pass" : "fail")
        : (s.expected === "block" && !accepted.has("allow") && !accepted.has("modify") && !accepted.has("deferred")
            ? "fail"
            : "pass");

  return {
    id: s.id,
    name: s.name,
    category: s.category,
    expected: s.expected,
    also_acceptable: s.also_acceptable ?? [],
    gate_outcome,
    gate_source,
    gate_detail,
    status,
  };
}

export const evaluateAll = (snapshot: PolicySnapshot): ScenarioResult[] =>
  CONTROL_SCENARIOS.map((s) => evaluateScenario(s, snapshot));

export type ReplayDiffRow = {
  id: string;
  name: string;
  category: string;
  expected: Verdict;
  active: { gate_outcome: GateOutcome; gate_source: string | null; gate_detail: string | null; status: string };
  draft: { gate_outcome: GateOutcome; gate_source: string | null; gate_detail: string | null; status: string };
  change: "regression" | "improvement" | "changed_but_ok" | "unchanged";
};

export type ReplayReport = {
  ok: boolean;
  safe_to_activate: boolean;
  active_version: { id: string | null; version: number | null };
  draft_version: { id: string; version: number; status: string; notes: string | null };
  summary: {
    total: number;
    active_pass: number;
    draft_pass: number;
    regressions: number;
    improvements: number;
    changed: number;
  };
  regressions: ReplayDiffRow[];
  diff: ReplayDiffRow[];
  results: ReplayDiffRow[];
  markdown: string;
};

const cell = (r: ScenarioResult) => ({
  gate_outcome: r.gate_outcome,
  gate_source: r.gate_source,
  gate_detail: r.gate_detail,
  status: r.status,
});

export function buildReport(
  activeInfo: { id: string | null; version: number | null; snapshot: PolicySnapshot },
  draftInfo: { id: string; version: number; status: string; notes: string | null; snapshot: PolicySnapshot },
): ReplayReport {
  const activeResults = evaluateAll(activeInfo.snapshot);
  const draftResults = evaluateAll(draftInfo.snapshot);

  const rows: ReplayDiffRow[] = activeResults.map((a, i) => {
    const d = draftResults[i];
    const change: ReplayDiffRow["change"] =
      a.status === "pass" && d.status === "fail"
        ? "regression"
        : a.status === "fail" && d.status === "pass"
          ? "improvement"
          : a.gate_outcome !== d.gate_outcome
            ? "changed_but_ok"
            : "unchanged";
    return {
      id: a.id,
      name: a.name,
      category: a.category,
      expected: a.expected,
      active: cell(a),
      draft: cell(d),
      change,
    };
  });

  const regressions = rows.filter((r) => r.change === "regression");
  const improvements = rows.filter((r) => r.change === "improvement");
  const diff = rows.filter((r) => r.change !== "unchanged");
  const summary = {
    total: rows.length,
    active_pass: activeResults.filter((r) => r.status === "pass").length,
    draft_pass: draftResults.filter((r) => r.status === "pass").length,
    regressions: regressions.length,
    improvements: improvements.length,
    changed: diff.length,
  };

  const icon = (c: string) =>
    c === "regression" ? "❌" : c === "improvement" ? "✅" : c === "changed_but_ok" ? "🟡" : "·";
  const lines: string[] = [
    `# Policy replay — draft v${draftInfo.version} vs active ${activeInfo.version ? `v${activeInfo.version}` : "(none)"}`,
    "",
    `${summary.total} scenarios · active passes ${summary.active_pass}, draft passes ${summary.draft_pass} · ` +
      `**${summary.regressions} regressions**, ${summary.improvements} improvements, ${summary.changed} changed`,
    "",
  ];
  if (diff.length) {
    lines.push("| | ID | Scenario | Expected | Active | Draft |", "|---|---|---|---|---|---|");
    for (const r of diff) {
      lines.push(
        `| ${icon(r.change)} | ${r.id} | ${r.name} | ${r.expected} | ${r.active.gate_outcome} | ${r.draft.gate_outcome} |`,
      );
    }
  } else {
    lines.push("No scenario changed behaviour under this draft.");
  }
  if (regressions.length) {
    lines.push("", "## Regressions (activation blocked)", "");
    for (const r of regressions) {
      lines.push(
        `- **${r.id} ${r.name}** — expected \`${r.expected}\`; active gate \`${r.active.gate_outcome}\` ` +
          `(${r.active.gate_detail ?? "—"}) becomes \`${r.draft.gate_outcome}\` under the draft.`,
      );
    }
  }

  return {
    ok: true,
    safe_to_activate: regressions.length === 0,
    active_version: { id: activeInfo.id, version: activeInfo.version },
    draft_version: { id: draftInfo.id, version: draftInfo.version, status: draftInfo.status, notes: draftInfo.notes },
    summary,
    regressions,
    diff,
    results: rows,
    markdown: lines.join("\n"),
  };
}

type DraftRow = { id: string; version: number; status: string; notes: string | null; snapshot: PolicySnapshot };
type ActiveRef = { id: string | null; version: number | null; snapshot: PolicySnapshot };

/**
 * Shared draft + active snapshot lookup -- used by both replayDraft (against
 * the 30 fixed scenarios) and replayRealTraffic (against real decisions)
 * below, so the version-resolution logic only lives once.
 */
async function resolveDraftAndActive(
  admin: SupabaseClient,
  userId: string,
  draftRef: { id?: string; version?: number },
): Promise<{ error: string; status: number } | { draft: DraftRow; active: ActiveRef }> {
  let q = admin
    .from("policy_versions")
    .select("id, version, status, notes, snapshot, user_id")
    .eq("user_id", userId);
  q = draftRef.id ? q.eq("id", draftRef.id) : q.eq("version", draftRef.version!);
  const { data: draftData } = await q.maybeSingle();
  if (!draftData) return { error: "Policy version not found for this account.", status: 404 };
  const draft = draftData as DraftRow;

  let activeId: string | null = null;
  let activeVersion: number | null = null;
  let activeSnapshot: PolicySnapshot = {};
  try {
    const { data: pv } = await admin.rpc("get_active_policy_version", { _user_id: userId });
    const row = (Array.isArray(pv) ? pv[0] : pv) as
      | { id?: string; version?: number; snapshot?: PolicySnapshot }
      | null;
    if (row) {
      activeId = row.id ?? null;
      activeVersion = typeof row.version === "number" ? row.version : null;
      activeSnapshot = (row.snapshot ?? {}) as PolicySnapshot;
    }
  } catch { /* no active version yet — draft is compared against an empty policy */ }

  return { draft, active: { id: activeId, version: activeVersion, snapshot: activeSnapshot } };
}

/** Load the draft + active snapshots for a user and produce the replay report. */
export async function replayDraft(
  admin: SupabaseClient,
  userId: string,
  draftRef: { id?: string; version?: number },
): Promise<{ error: string; status: number } | ReplayReport> {
  const resolved = await resolveDraftAndActive(admin, userId, draftRef);
  if ("error" in resolved) return resolved;
  const { draft: d, active } = resolved;

  return buildReport(
    active,
    { id: d.id, version: d.version, status: d.status, notes: d.notes, snapshot: d.snapshot ?? {} },
  );
}

export type RealTrafficReplayReport = {
  ok: true;
  active_version: { id: string | null; version: number | null };
  draft_version: { id: string; version: number };
  summary: RealTrafficReplaySummary;
  changed: {
    id: string;
    action_type: string;
    provider: string;
    description: string;
    active: { gate_outcome: GateOutcome; gate_source: ScenarioResult["gate_source"]; gate_detail: string | null };
    draft: { gate_outcome: GateOutcome; gate_source: ScenarioResult["gate_source"]; gate_detail: string | null };
    diff: RealActionDiff;
  }[];
};

/**
 * Replays a draft policy against real historical decisions instead of the
 * 30 fixed scenarios -- "would this draft have decided any of my last N
 * real actions differently than my active policy did." Only decisions
 * with a captured action payload (get_replayable_real_decisions -- block-
 * sourced agent_decisions rows plus every escalated pending_approvals row)
 * are replayable; plain historical ALLOWs have no payload captured and
 * are excluded, by design (see the 2026-08-23 migration).
 */
export async function replayRealTraffic(
  admin: SupabaseClient,
  userId: string,
  draftRef: { id?: string; version?: number },
  limit = 200,
): Promise<{ error: string; status: number } | RealTrafficReplayReport> {
  const resolved = await resolveDraftAndActive(admin, userId, draftRef);
  if ("error" in resolved) return resolved;
  const { draft, active } = resolved;

  const { data: rows, error } = await admin.rpc("get_replayable_real_decisions", { _user_id: userId, _limit: limit });
  if (error) return { error: error.message, status: 500 };

  const changed: RealTrafficReplayReport["changed"] = [];
  const diffs: RealActionDiff[] = [];
  for (const r of (rows ?? []) as RealDecisionRow[]) {
    const actionInput = { action_type: r.action_type, provider: r.provider, description: r.description ?? "", params: r.params };
    const activeResult = evaluateAction(actionInput, active.snapshot);
    const draftResult = evaluateAction(actionInput, draft.snapshot ?? {});
    const diff = diffRealAction(activeResult.gate_outcome, draftResult.gate_outcome);
    diffs.push(diff);
    if (diff !== "same") {
      changed.push({
        id: r.id,
        action_type: r.action_type,
        provider: r.provider,
        description: (r.description ?? "").slice(0, 200),
        active: activeResult,
        draft: draftResult,
        diff,
      });
    }
  }

  return {
    ok: true,
    active_version: { id: active.id, version: active.version },
    draft_version: { id: draft.id, version: draft.version },
    summary: summarizeRealTrafficReplay(diffs),
    changed,
  };
}
