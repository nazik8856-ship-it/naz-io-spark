// Scheduled canary for website generation. Two modes, two cadences:
//
//   mode "provider"   (every few hours, ~$0.01): one tiny chat call and one
//                     LOW-quality image call against the real provider. Catches
//                     the failure that actually happened -- the account running
//                     out of credits -- within hours instead of at the next
//                     customer's failed generation.
//   mode "generation" (daily, ~$0.15): a real generation of a fixed brief with a
//                     chosen structure (nothing saved, nobody charged), judged
//                     against the same deterministic quality floor customers get.
//                     Catches silent quality/structure regressions and provider
//                     or model drift.
//
// A failure opens a platform incident (once -- not one per run); a later pass
// resolves it automatically, so the incident list reflects the present, not
// history. Every run is also recorded in generation_canary_runs.
// Service-role only. Honors the consequential-sweep pause switch because it
// spends provider credit.
import "../_shared/redact-console.ts"; // first: secrets never reach the function logs
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { aiGatewayHeaders, pickAiGateway } from "../_shared/ai-gateway.ts";
import { areConsequentialSweepsPaused } from "../_shared/consequential-sweep-pause.ts";
import { CANARY_BRIEF, CANARY_STRUCTURE, judgeGeneration, judgeProbe, type CanaryVerdict } from "../_shared/canary-judge.ts";
import {
  CANARY_FAILED_KIND, isProviderOutOfCredits, openIncidentOnce, OUTAGE_SUMMARY, PROVIDER_OUTAGE_KIND, resolveIncidents,
} from "../_shared/provider-health.ts";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

type Probe = { name: string; ok: boolean; status: number; detail: string };

async function probe(name: string, url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<Probe & { outOfCredits: boolean }> {
  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) { await res.arrayBuffer().catch(() => undefined); return { name, ok: true, status: res.status, detail: "", outOfCredits: false }; }
    const text = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
    return { name, ok: false, status: res.status, detail: text, outOfCredits: isProviderOutOfCredits(res.status, text) };
  } catch (e) {
    return { name, ok: false, status: 0, detail: e instanceof Error ? e.message : "request failed", outOfCredits: false };
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if ((req.headers.get("Authorization") ?? "") !== `Bearer ${serviceKey}`) return json({ error: "unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, serviceKey);
  if (await areConsequentialSweepsPaused(admin)) return json({ ok: true, skipped: true, reason: "consequential sweeps are paused" });

  const body = await req.json().catch(() => ({}));
  const mode = body?.mode === "generation" ? "generation" : "provider";
  const gw = pickAiGateway();
  const started = Date.now();
  let verdict: CanaryVerdict;
  let outOfCredits = false;
  let estCost = 0;

  if (!gw) {
    verdict = { ok: false, checks: [{ id: "gateway", ok: false, detail: "no AI gateway key configured" }], failures: ["gateway: no AI gateway key configured"] };
  } else if (mode === "provider") {
    const probes: (Probe & { outOfCredits: boolean })[] = [];
    probes.push(await probe("chat", gw.url, aiGatewayHeaders(gw), { model: gw.model, messages: [{ role: "user", content: "Reply with OK" }], max_tokens: 3 }, 30_000));
    if (gw.provider === "openai") {
      probes.push(await probe("image", "https://api.openai.com/v1/images/generations", aiGatewayHeaders(gw),
        { model: "gpt-image-1", prompt: "A single flat yellow circle centred on a plain white background", size: "1024x1024", quality: "low", n: 1 }, 90_000));
      estCost = 0.011;
    }
    outOfCredits = probes.some((p) => p.outOfCredits);
    verdict = judgeProbe(probes);
  } else {
    const res = await fetch(`${url}/functions/v1/compile-website-manifest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", apikey: serviceKey },
      body: JSON.stringify({ prompt: CANARY_BRIEF, structure: CANARY_STRUCTURE, save: false }),
      signal: AbortSignal.timeout(170_000),
    }).catch((e) => ({ status: 0, json: async () => ({ error: e instanceof Error ? e.message : "request failed" }) } as unknown as Response));
    const parsed = await res.json().catch(() => null);
    outOfCredits = res.status === 503 && parsed?.code === "generation_unavailable";
    verdict = judgeGeneration({ status: res.status, json: parsed });
    estCost = 0.15;
  }

  // Incidents: one open incident per kind; resolved automatically on a clean pass.
  let incident: string | null = null;
  if (!verdict.ok) {
    if (outOfCredits) {
      if (await openIncidentOnce(admin, PROVIDER_OUTAGE_KIND, OUTAGE_SUMMARY, { source: `canary:${mode}`, failures: verdict.failures })) incident = PROVIDER_OUTAGE_KIND;
    } else if (await openIncidentOnce(admin, CANARY_FAILED_KIND, `Generation canary (${mode}) failed: ${verdict.failures.slice(0, 2).join("; ")}`, { mode, failures: verdict.failures })) {
      incident = CANARY_FAILED_KIND;
    }
  } else {
    await resolveIncidents(admin, mode === "generation" ? [CANARY_FAILED_KIND, PROVIDER_OUTAGE_KIND] : [PROVIDER_OUTAGE_KIND], `Resolved automatically: the ${mode} canary passed at ${new Date().toISOString()}.`);
  }

  await admin.from("generation_canary_runs").insert({
    mode, ok: verdict.ok, checks: verdict.checks, duration_ms: Date.now() - started, est_cost_usd: estCost, out_of_credits: outOfCredits,
  }).then(() => undefined, (e: unknown) => console.error("generation-canary: could not record run", e));

  return json({ ok: verdict.ok, mode, failures: verdict.failures, out_of_credits: outOfCredits, incident_opened: incident, duration_ms: Date.now() - started });
});
