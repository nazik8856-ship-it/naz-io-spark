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
import { isRedactableMatch } from "./outer-control-scoring.ts";

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

  const { data: agentRow } = await admin.from("agents").select("manifest").eq("id", agentId).eq("user_id", userId).maybeSingle();
  if (!agentRow) return { ok: false, repaired: false, notes: ["Agent not found."], blocked: false, blockReason: null };
  const manifest = ((agentRow as { manifest: AgentManifest | null }).manifest ?? {}) as AgentManifest;
  const tools = Array.isArray(manifest.tools) ? manifest.tools : [];
  const guardrails = Array.isArray(manifest.guardrails) ? manifest.guardrails : [];

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

  // Persist whenever there's something new to show, not only when
  // `repaired` (actual content change) is true -- a flagged-but-not-fixed
  // guardrail note is still a real finding that must reach the agent's
  // own guardrail list.
  if (addedGuardrails.length) {
    await admin.from("agents").update({
      manifest: { ...manifest, tools: keptTools, guardrails: [...guardrails, ...addedGuardrails], systemPrompt, decisionPolicy },
    }).eq("id", agentId);
  }

  return { ok: true, repaired, notes, blocked: false, blockReason: null };
}

/**
 * Re-validates one website's CURRENT, fully assembled page tree (every
 * page, as currently stored -- including any hand-edit made through the
 * builder after generation) against the account's CURRENT safety_rules.
 * Persists any redaction directly to website_pages.sections.
 */
export async function checkWebsiteAssembly(admin: SupabaseClient, userId: string, websiteId: string): Promise<AssemblyCheckReport> {
  const { data: websiteRow } = await admin.from("websites").select("id").eq("id", websiteId).eq("user_id", userId).maybeSingle();
  if (!websiteRow) return { ok: false, repaired: false, notes: ["Website not found."], blocked: false, blockReason: null };

  const { data: pageRows } = await admin.from("website_pages").select("id, slug, sections").eq("website_id", websiteId);
  const pages = (pageRows ?? []) as { id: string; slug: string; sections: unknown }[];
  if (!pages.length) return { ok: true, repaired: false, notes: [], blocked: false, blockReason: null };

  // Websites have no agent_id of their own -- the account-wide rule set is
  // the only one that ever governs them, same as compile-website-manifest's
  // own applySafetyGate already established.
  const safetyRules = await loadSafetyRules(admin, userId, null);
  const scan = scanWithRules(safetyRules, pages.map((p) => p.sections), "");
  if (!scan.matched) return { ok: true, repaired: false, notes: [], blocked: false, blockReason: null };

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
    };
  }

  return { ok: true, repaired, notes, blocked: false, blockReason: null };
}
