// GAP 5 (Final Assembly & Consistency Checker): re-validates the COMPLETE,
// currently-live package against the account's CURRENT rule set -- not
// just what compile-agent-manifest/compile-website-manifest checked once
// at generation time. Two emergent-issue sources this catches that a
// generation-time-only gate structurally cannot:
//   1. a hard/safety rule the account owner added or changed AFTER this
//      agent/website was generated;
//   2. for a website, page content a human hand-edited through the
//      builder after the generation-time scan already ran.
// Reuses the exact same tool-stripping and repair-engine primitives
// compile-agent-manifest/compile-website-manifest use -- just re-run now
// against the CURRENT live row instead of a draft manifest being compiled,
// and persists any fix it makes directly to the live row.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ruleMatchesAction, selectRulesForEntity } from "./rule-matching.ts";
import { loadSafetyRules, scanWithRules, type SafetyMatch } from "./safety-scanner.ts";
import { repairContent } from "./repair-engine.ts";
import { computeTrustScore, isRedactableMatch } from "./outer-control-scoring.ts";

export type AssemblyCheckReport = {
  ok: boolean;
  /** True when this check itself changed something (stripped a tool, redacted prose/content) -- the caller should treat the entity as freshly modified, not just read-checked. */
  repaired: boolean;
  notes: string[];
  /**
   * Problem 1 (Control Gate weak on websites, 2026-10-08): true when a
   * block-severity safety-rule match was found with nothing mechanically
   * redactable -- the caller MUST NOT confirm this publish/deploy
   * succeeded when this is true. Always false for checkAgentAssembly
   * (an agent's real actions are already hard-gated at run time by the
   * full control gate; this first-deploy prose check stays advisory-only,
   * unchanged).
   */
  blocked: boolean;
  blockReason: string | null;
  /**
   * GAP 3 (Trust Score + Provenance + Control Report, 2026-10-09): the
   * exact same computeTrustScore Outer Control's own evaluations already
   * use, applied to this check's own safety-rule matches (prose + memory
   * for an agent; page content for a website) -- not the hard-rule tool
   * removals above, which have no "severity" of the kind this function
   * scores. 100 when nothing matched. Persisted on every call (clean or
   * not) so the score never goes stale once a flagged issue is fixed.
   */
  trustScore: number;
};

type HardRuleRow = { id: string; rule_text: string; action_type_pattern: string; effect: string; provider: string | null; agent_id: string | null; api_key_id: string | null };
type ManifestTool = { name: string; description: string; kind: string; config: Record<string, unknown> };
type ManifestGuardrail = { rule: string; requiresApproval: boolean };
type AgentManifest = {
  tools?: ManifestTool[];
  guardrails?: ManifestGuardrail[];
  systemPrompt?: string;
  decisionPolicy?: string;
  [key: string]: unknown;
};

/**
 * Re-validates one agent's CURRENT manifest (tools + prose) against the
 * account's CURRENT hard_rules/safety_rules. Persists any change directly
 * to agents.manifest.
 */
export async function checkAgentAssembly(admin: SupabaseClient, userId: string, agentId: string): Promise<AssemblyCheckReport> {
  const notes: string[] = [];
  let repaired = false;

  const { data: agentRow } = await admin.from("agents").select("manifest, generation_notes").eq("id", agentId).eq("user_id", userId).maybeSingle();
  if (!agentRow) return { ok: false, repaired: false, notes: ["Agent not found."], blocked: false, blockReason: null, trustScore: 100 };
  const manifest = ((agentRow as { manifest: AgentManifest | null }).manifest ?? {}) as AgentManifest;
  const existingGenerationNotes = Array.isArray((agentRow as { generation_notes: string[] | null }).generation_notes)
    ? (agentRow as { generation_notes: string[] }).generation_notes
    : [];
  const tools = Array.isArray(manifest.tools) ? manifest.tools : [];
  const guardrails = Array.isArray(manifest.guardrails) ? manifest.guardrails : [];
  // GAP 3: every safety-rule match found below (prose + memory), fed to
  // computeTrustScore at the end -- kept separate from the hard-rule tool
  // removals above, which this function already tracks via `notes` but
  // which have no comparable "severity" to score.
  const allSafetyMatches: SafetyMatch[] = [];

  const { data: hardRuleRows } = await admin.from("hard_rules")
    .select("id, rule_text, action_type_pattern, effect, provider, enabled, agent_id, api_key_id")
    .eq("user_id", userId).eq("enabled", true);
  const hardRules = selectRulesForEntity((hardRuleRows ?? []) as HardRuleRow[], "agent", agentId);

  // Same restriction compile-agent-manifest's own pre-save gate applies:
  // only a rule with NO provider restriction can be judged dead-on-arrival
  // for a tool KIND alone -- passing "" as the provider means only a
  // provider-null rule can ever match here, same trick that gate uses.
  const keptTools: ManifestTool[] = [];
  const addedGuardrails: ManifestGuardrail[] = [];
  for (const t of tools) {
    const blocker = hardRules.find((r) =>
      r.effect === "always_block" && ruleMatchesAction({ action_type_pattern: r.action_type_pattern, provider: r.provider }, t.kind, ""),
    );
    if (blocker) {
      const note = `"${t.name}" (${t.kind}) was removed at final-assembly check -- your hard rule "${blocker.rule_text}" always blocks this action and governs this agent now, even though it didn't when this agent was last generated.`;
      notes.push(note);
      addedGuardrails.push({ rule: note, requiresApproval: false });
      repaired = true;
    } else {
      keptTools.push(t);
    }
  }

  const safetyRules = await loadSafetyRules(admin, userId, agentId);
  let systemPrompt = String(manifest.systemPrompt || "");
  let decisionPolicy = String(manifest.decisionPolicy || "");
  const proseFields: { field: "systemPrompt" | "decisionPolicy"; text: string }[] = [
    { field: "systemPrompt", text: systemPrompt },
    { field: "decisionPolicy", text: decisionPolicy },
  ];
  for (const { field, text } of proseFields) {
    if (!text) continue;
    const scan = scanWithRules(safetyRules, text, "");
    if (!scan.matched) continue;
    const fieldLabel = field === "systemPrompt" ? "system prompt" : "decision policy";
    // AUDIT 5 (Trust Score + Provenance + Control Report, 2026-10-07): a
    // field matching BOTH a redactable rule (secrets/pii) and a non-
    // redactable one (destructive wording, etc.) at once used to report
    // ONLY whichever branch `repair.repaired !== null` picked -- repairing
    // the redactable match and silently dropping the separate non-
    // redactable finding in the same scan, since repairContent's own diff
    // only ever covers what it actually redacted. Splitting the matches
    // up front (same pattern checkWebsiteAssembly below already uses)
    // means both groups are reported independently, regardless of
    // whether the other one existed.
    allSafetyMatches.push(...scan.matches);
    const redactableMatches = scan.matches.filter((m) => isRedactableMatch(m));
    const nonRedactableMatches = scan.matches.filter((m) => !isRedactableMatch(m));

    if (redactableMatches.length) {
      const repair = repairContent(text, redactableMatches);
      if (repair.repaired !== null) {
        if (field === "systemPrompt") systemPrompt = repair.repaired; else decisionPolicy = repair.repaired;
        const note = `Your agent's ${fieldLabel} had content matching your safety rule(s) (${repair.diff.map((d) => d.detail).join(", ")}) redacted at final-assembly check.`;
        notes.push(note);
        // This redaction used to be reported ONLY in this function's
        // return value. The one caller that reads it (agent-runtime's
        // first-deploy gate) only ever wrote it to an agent_events row of
        // a kind ("first_deploy_check") nothing in the UI reads --
        // confirmed by searching every agent_events consumer in src/. The
        // finding was real and persisted, but never reached a human.
        // manifest.guardrails is this agent's one channel that both IS
        // already rendered (GeneratedAgentDashboard.tsx's guardrail_panel
        // widget) and is already how this same function reports a
        // blocked TOOL just above -- using it here too, instead of
        // inventing a new surface.
        addedGuardrails.push({ rule: note, requiresApproval: false });
        repaired = true;
      }
    }
    if (nonRedactableMatches.length) {
      // A real safety-rule match with nothing mechanically excisable
      // (destructive wording, etc.) used to be dropped with NO note, NO
      // guardrail, nothing -- the exact same situation for a website
      // (checkWebsiteAssembly's own nonRedactable branch, just below in
      // this file) already surfaces as a visible "worth reviewing" note.
      // Mirrors that here instead of silently discarding the finding.
      const note = `Your agent's ${fieldLabel} touches your safety rule(s) (${nonRedactableMatches.map((m) => m.name).join(", ")}) -- not something this check can mechanically fix, but worth reviewing.`;
      notes.push(note);
      addedGuardrails.push({ rule: note, requiresApproval: false });
    }
  }

  // GAP 1 / GAP 2 (Persistent Ongoing Enforcement / external contributions,
  // 2026-10-09): agent_memory is where a fact survives past every other
  // checkpoint -- written once via the `remember` tool (now scanned at
  // write time in agent-runtime/index.ts) but never re-checked against a
  // rule added AFTER it was written, and never covered by this function
  // at all until now. It's also the one place a fact the agent derived
  // from an external AI's http_post result (gated once at ingestion,
  // tagged source: "external_ai") could persist unexamined -- the
  // "complete package" this function re-validates was never actually
  // complete without it. Same redact-or-flag posture as the prose fields
  // above, applied per memory row.
  const { data: memoryRows } = await admin.from("agent_memory")
    .select("id, key, value, source").eq("agent_id", agentId).eq("user_id", userId);
  for (const row of (memoryRows ?? []) as { id: string; key: string; value: string; source: string | null }[]) {
    if (!row.value) continue;
    const scan = scanWithRules(safetyRules, row.value, "");
    if (!scan.matched) continue;
    allSafetyMatches.push(...scan.matches);
    const redactableMatches = scan.matches.filter((m) => isRedactableMatch(m));
    const nonRedactableMatches = scan.matches.filter((m) => !isRedactableMatch(m));
    const originNote = row.source === "external_ai" ? " (sourced from an external AI's response)" : "";

    if (redactableMatches.length) {
      const repair = repairContent(row.value, redactableMatches);
      if (repair.repaired !== null) {
        await admin.from("agent_memory").update({ value: repair.repaired }).eq("id", row.id);
        const note = `Memory "${row.key}"${originNote} had content matching your safety rule(s) (${repair.diff.map((d) => d.detail).join(", ")}) redacted at final-assembly check.`;
        notes.push(note);
        addedGuardrails.push({ rule: note, requiresApproval: false });
        repaired = true;
      }
    }
    if (nonRedactableMatches.length) {
      const note = `Memory "${row.key}"${originNote} touches your safety rule(s) (${nonRedactableMatches.map((m) => m.name).join(", ")}) -- not something this check can mechanically fix, but worth reviewing.`;
      notes.push(note);
      addedGuardrails.push({ rule: note, requiresApproval: false });
    }
  }

  // GAP 3: computed from this run's own safety-rule matches only -- 100
  // when none matched, same posture a clean checkWebsiteAssembly run
  // takes below.
  const trustScore = computeTrustScore(allSafetyMatches);
  // Deduped the same way websites.generation_notes already merges (never
  // re-append a note this exact check already recorded on a prior run).
  const newGenerationNotes = notes.filter((n) => !existingGenerationNotes.includes(n));
  const mergedGenerationNotes = [...existingGenerationNotes, ...newGenerationNotes];

  // Persisted on every call, not only when something changed -- the
  // manifest write stays conditional on addedGuardrails (nothing to
  // rewrite there otherwise), but trust_score/generation_notes must
  // always reflect THIS run's result, including a clean run resetting a
  // previously-bad score back to 100 once the offending rule is gone.
  await admin.from("agents").update({
    ...(addedGuardrails.length
      ? { manifest: { ...manifest, tools: keptTools, guardrails: [...guardrails, ...addedGuardrails], systemPrompt, decisionPolicy } }
      : {}),
    trust_score: trustScore,
    generation_notes: mergedGenerationNotes,
  }).eq("id", agentId);

  return { ok: true, repaired, notes, blocked: false, blockReason: null, trustScore };
}

/**
 * Re-validates one website's CURRENT, fully assembled page tree (every
 * page, as currently stored -- including any hand-edit made through the
 * builder after generation) against the account's CURRENT safety_rules.
 * Persists any redaction directly to website_pages.sections.
 */
export async function checkWebsiteAssembly(admin: SupabaseClient, userId: string, websiteId: string): Promise<AssemblyCheckReport> {
  const { data: websiteRow } = await admin.from("websites").select("id").eq("id", websiteId).eq("user_id", userId).maybeSingle();
  if (!websiteRow) return { ok: false, repaired: false, notes: ["Website not found."], blocked: false, blockReason: null, trustScore: 100 };

  const { data: pageRows } = await admin.from("website_pages").select("id, slug, sections").eq("website_id", websiteId);
  const pages = (pageRows ?? []) as { id: string; slug: string; sections: unknown }[];
  if (!pages.length) {
    // GAP 3 verification follow-up (2026-10-09): a website whose pages were
    // all deleted through the builder (the row itself survives independently
    // of website_pages) used to leave trust_score exactly as stale as before
    // those pages were removed -- the one early return in this function that
    // skipped the "always write, never go stale" persist the clean-scan
    // branch just below already does for the exact same "nothing to flag"
    // outcome.
    await admin.from("websites").update({ trust_score: 100 }).eq("id", websiteId);
    return { ok: true, repaired: false, notes: [], blocked: false, blockReason: null, trustScore: 100 };
  }

  // Websites have no agent_id of their own -- the account-wide rule set is
  // the only one that ever governs them, same as compile-website-manifest's
  // own applySafetyGate already established.
  const safetyRules = await loadSafetyRules(admin, userId, null);
  const scan = scanWithRules(safetyRules, pages.map((p) => p.sections), "");
  if (!scan.matched) {
    // GAP 3: persisted even on a clean run -- resets a previously-bad
    // score back to 100 once the offending rule/content is gone, same
    // "always write, never go stale" posture checkAgentAssembly takes.
    await admin.from("websites").update({ trust_score: 100 }).eq("id", websiteId);
    return { ok: true, repaired: false, notes: [], blocked: false, blockReason: null, trustScore: 100 };
  }
  const trustScore = computeTrustScore(scan.matches);
  await admin.from("websites").update({ trust_score: trustScore }).eq("id", websiteId);

  const redactDeep = (value: unknown, matches: SafetyMatch[]): unknown => {
    if (typeof value === "string") return repairContent(value, matches).repaired ?? value;
    if (Array.isArray(value)) return value.map((v) => redactDeep(v, matches));
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v, matches);
      return out;
    }
    return value;
  };

  const redactable = scan.matches.filter((m) => isRedactableMatch(m));
  const nonRedactable = scan.matches.filter((m) => !isRedactableMatch(m));
  const notes: string[] = [];
  let repaired = false;

  if (redactable.length) {
    for (const page of pages) {
      const newSections = redactDeep(page.sections, redactable);
      if (JSON.stringify(newSections) !== JSON.stringify(page.sections)) {
        await admin.from("website_pages").update({ sections: newSections }).eq("id", page.id);
        repaired = true;
      }
    }
    notes.push(`Content matching your safety rule(s) (${redactable.map((m) => m.name).join(", ")}) was redacted across this site at final-assembly check -- it may have been added or edited after this site was first generated.`);
  }
  // Problem 1 (Control Gate weak on websites, 2026-10-08): mirrors
  // compile-website-manifest's own applySafetyGate -- a block-severity
  // match with nothing mechanically redactable used to get the exact same
  // "not blocked... worth reviewing" note as a require_approval match, at
  // the one checkpoint (publish/republish) a website ever passes through.
  // The caller (GeneratedDashboard.tsx's confirmPublish) must refuse to
  // confirm the publish when this fires, instead of treating it as just
  // another FYI note next to the require_approval ones.
  const blockSeverityNonRedactable = nonRedactable.filter((m) => m.severity === "block");
  const requireApprovalNonRedactable = nonRedactable.filter((m) => m.severity !== "block");
  if (requireApprovalNonRedactable.length) {
    notes.push(`This site's assembled content touches your safety rule(s) (${requireApprovalNonRedactable.map((m) => m.name).join(", ")}) -- not blocked (descriptive content, not an action), but worth reviewing before publishing.`);
  }
  if (blockSeverityNonRedactable.length) {
    notes.push(`This site's assembled content matches your safety rule(s) (${blockSeverityNonRedactable.map((m) => m.name).join(", ")}) -- a block-severity rule with nothing mechanically redactable, so this publish is NOT confirmed.`);
    return {
      ok: true,
      repaired,
      notes,
      blocked: true,
      blockReason: `This site's content matches your safety rule(s) (${blockSeverityNonRedactable.map((m) => m.name).join(", ")}) -- fix or remove that content before republishing.`,
      trustScore,
    };
  }

  return { ok: true, repaired, notes, blocked: false, blockReason: null, trustScore };
}
