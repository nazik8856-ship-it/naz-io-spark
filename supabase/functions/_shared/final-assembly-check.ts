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
  if (!agentRow) return { ok: false, repaired: false, notes: ["Agent not found."] };
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
    const repair = repairContent(text, scan.matches);
    const fieldLabel = field === "systemPrompt" ? "system prompt" : "decision policy";
    if (repair.repaired !== null) {
      if (field === "systemPrompt") systemPrompt = repair.repaired; else decisionPolicy = repair.repaired;
      const note = `Your agent's ${fieldLabel} had content matching your safety rule(s) (${repair.diff.map((d) => d.detail).join(", ")}) redacted at final-assembly check.`;
      notes.push(note);
      // AUDIT 5 (Trust Score + Provenance + Control Report, 2026-10-07):
      // this redaction used to be reported ONLY in this function's return
      // value. The one caller that reads it (agent-runtime's first-deploy
      // gate) only ever wrote it to an agent_events row of a kind
      // ("first_deploy_check") nothing in the UI reads -- confirmed by
      // searching every agent_events consumer in src/. The finding was
      // real and persisted, but never reached a human. manifest.guardrails
      // is this agent's one channel that both IS already rendered
      // (GeneratedAgentDashboard.tsx's guardrail_panel widget) and is
      // already how this same function reports a blocked TOOL just above
      // -- using it here too, instead of inventing a new surface.
      addedGuardrails.push({ rule: note, requiresApproval: false });
      repaired = true;
    } else {
      // A real safety-rule match with nothing mechanically excisable
      // (destructive wording, etc.) used to be dropped with NO note, NO
      // guardrail, nothing -- the exact same situation for a website
      // (checkWebsiteAssembly's own nonRedactable branch, just below in
      // this file) already surfaces as a visible "worth reviewing" note.
      // Mirrors that here instead of silently discarding the finding.
      const note = `Your agent's ${fieldLabel} touches your safety rule(s) (${scan.matches.map((m) => m.name).join(", ")}) -- not something this check can mechanically fix, but worth reviewing.`;
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

  return { ok: true, repaired, notes };
}

/**
 * Re-validates one website's CURRENT, fully assembled page tree (every
 * page, as currently stored -- including any hand-edit made through the
 * builder after generation) against the account's CURRENT safety_rules.
 * Persists any redaction directly to website_pages.sections.
 */
export async function checkWebsiteAssembly(admin: SupabaseClient, userId: string, websiteId: string): Promise<AssemblyCheckReport> {
  const { data: websiteRow } = await admin.from("websites").select("id").eq("id", websiteId).eq("user_id", userId).maybeSingle();
  if (!websiteRow) return { ok: false, repaired: false, notes: ["Website not found."] };

  const { data: pageRows } = await admin.from("website_pages").select("id, slug, sections").eq("website_id", websiteId);
  const pages = (pageRows ?? []) as { id: string; slug: string; sections: unknown }[];
  if (!pages.length) return { ok: true, repaired: false, notes: [] };

  // Websites have no agent_id of their own -- the account-wide rule set is
  // the only one that ever governs them, same as compile-website-manifest's
  // own applySafetyGate already established.
  const safetyRules = await loadSafetyRules(admin, userId, null);
  const scan = scanWithRules(safetyRules, pages.map((p) => p.sections), "");
  if (!scan.matched) return { ok: true, repaired: false, notes: [] };

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
  if (nonRedactable.length) {
    notes.push(`This site's assembled content touches your safety rule(s) (${nonRedactable.map((m) => m.name).join(", ")}) -- not blocked (descriptive content, not an action), but worth reviewing before publishing.`);
  }

  return { ok: true, repaired, notes };
}
