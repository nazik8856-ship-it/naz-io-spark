// Pure judgement for the generation canary: given what a real generation of a
// fixed brief returned, say whether the Generator is healthy and, if not, which
// guarantee broke. Kept free of I/O so it is unit-tested and the edge function
// only has to fetch and record.
import { assessProfessionalFloor, type ManifestLike } from "./generation-floor.ts";
import type { StructureId } from "./generation-templates.ts";

/** A fixed, boring, fully-specified brief: the canary measures the system, not the model's creativity. */
export const CANARY_BRIEF =
  "A neighbourhood yoga studio in Lisbon offering group classes, private sessions and monthly memberships. Calm, warm, natural tone.";
export const CANARY_STRUCTURE: StructureId = "pricing-focused";

export type CanaryCheck = { id: string; ok: boolean; detail: string };
export type CanaryVerdict = { ok: boolean; checks: CanaryCheck[]; failures: string[] };

type CompileResponse = {
  status: number;
  json: {
    manifest?: ManifestLike;
    used_fallback?: boolean;
    fallback_reason?: string | null;
    quality_checks?: { id: string; status: string }[];
    error?: string;
  } | null;
};

export function judgeGeneration(res: CompileResponse): CanaryVerdict {
  const checks: CanaryCheck[] = [];
  const add = (id: string, ok: boolean, detail: string) => checks.push({ id, ok, detail });

  add("responded", res.status === 200 && !!res.json?.manifest, res.status === 200 ? "200 with a manifest" : `HTTP ${res.status}${res.json?.error ? `: ${res.json.error}` : ""}`);
  const manifest = res.json?.manifest;
  if (manifest) {
    add("real_generation", res.json?.used_fallback !== true, res.json?.used_fallback ? `starter template used (${res.json?.fallback_reason ?? "unknown reason"})` : "model output used");
    const issues = assessProfessionalFloor(manifest, CANARY_BRIEF, { template: CANARY_STRUCTURE }).issues;
    add("quality_floor", issues.length === 0, issues.length ? issues.slice(0, 3).join(" | ") : "no structural, claim or placeholder issues");
    const pricing = manifest.pages.find((p) => /pric|plan/.test(p.slug));
    const tiers = (pricing?.sections ?? []).filter((s) => s.type === "pricing").flatMap((s) => (Array.isArray((s.content as { tiers?: unknown[] } | null)?.tiers) ? ((s.content as { tiers: unknown[] }).tiers) : []));
    add("chosen_structure", !!pricing && tiers.length >= 3, pricing ? `${tiers.length} pricing tier(s)` : "no pricing page");
    const struct = res.json?.quality_checks?.find((c) => c.id === "structure");
    if (struct) add("structure_check", struct.status === "passed" || struct.status === "fixed", `structure check: ${struct.status}`);
  }
  const failures = checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`);
  return { ok: failures.length === 0, checks, failures };
}

/** Verdict for the cheap provider probe (one low-quality image + one tiny chat call). */
export function judgeProbe(probes: { name: string; ok: boolean; status: number; detail: string }[]): CanaryVerdict {
  const checks = probes.map((p) => ({ id: p.name, ok: p.ok, detail: p.ok ? "ok" : `HTTP ${p.status}${p.detail ? `: ${p.detail}` : ""}` }));
  const failures = checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`);
  return { ok: failures.length === 0, checks, failures };
}
