// Run with: deno test supabase/functions/_shared/provider-health_test.ts
import { isProviderOutOfCredits, openIncidentOnce, resolveIncidents, GENERATION_UNAVAILABLE_MESSAGE } from "./provider-health.ts";
import { CANARY_BRIEF, judgeGeneration, judgeProbe } from "./canary-judge.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("an OpenAI 429 'no credits' is an outage on our side; an ordinary 429 is a rate limit; 402 is always an outage", () => {
  assert(isProviderOutOfCredits(429, '{ "error": { "message": "You have no credits remaining. Add credits..." } }'));
  assert(isProviderOutOfCredits(429, "You exceeded your current quota, please check your plan and billing details"));
  assert(!isProviderOutOfCredits(429, "Rate limit reached for gpt-4o in organization on tokens per min"));
  assert(isProviderOutOfCredits(402, ""));
  assert(!isProviderOutOfCredits(500, "no credits"));
});

Deno.test("the user-facing outage message is honest: our side, not their account, not charged", () => {
  assert(/on our side/.test(GENERATION_UNAVAILABLE_MESSAGE) && /not charged/.test(GENERATION_UNAVAILABLE_MESSAGE) && !/credit/i.test(GENERATION_UNAVAILABLE_MESSAGE));
});

// A minimal in-memory stand-in for the admin client's platform_incidents table.
function fakeAdmin() {
  const rows: Record<string, unknown>[] = [];
  const admin = {
    from: (_t: string) => {
      let filters: ((r: Record<string, unknown>) => boolean)[] = [];
      let mode: "select" | "insert" | "update" = "select";
      let payload: Record<string, unknown> = {};
      const q: Record<string, unknown> = {
        select: () => q,
        insert: (p: Record<string, unknown>) => { mode = "insert"; payload = p; return q; },
        update: (p: Record<string, unknown>) => { mode = "update"; payload = p; return q; },
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
        is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return q; },
        limit: () => q,
        then: (res: (v: unknown) => unknown) => {
          if (mode === "insert") { rows.push({ id: `i${rows.length + 1}`, resolved_at: null, ...payload }); return Promise.resolve({ data: null, error: null }).then(res); }
          const m = rows.filter((r) => filters.every((f) => f(r)));
          if (mode === "update") { m.forEach((r) => Object.assign(r, payload)); return Promise.resolve({ data: null, error: null }).then(res); }
          return Promise.resolve({ data: m.map((r) => ({ ...r })), error: null }).then(res);
        },
      };
      return q;
    },
  };
  return { admin: admin as never, rows };
}

Deno.test("openIncidentOnce: one incident per kind however many failures; a new one only after it was resolved", async () => {
  const { admin, rows } = fakeAdmin();
  assertEquals(await openIncidentOnce(admin, "ai_provider_out_of_credits", "s", {}), true);
  assertEquals(await openIncidentOnce(admin, "ai_provider_out_of_credits", "s", {}), false);
  assertEquals(await openIncidentOnce(admin, "generation_canary_failed", "s2", {}), true);
  assertEquals(rows.length, 2);
  assertEquals(await resolveIncidents(admin, ["ai_provider_out_of_credits"], "ok now"), 1);
  assert(rows[0].resolved_at !== null && rows[0].resolution_note === "ok now");
  assert(rows[1].resolved_at === null, "other kinds stay open");
  assertEquals(await openIncidentOnce(admin, "ai_provider_out_of_credits", "s", {}), true);
});

Deno.test("openIncidentOnce / resolveIncidents never throw, even if the table is unavailable", async () => {
  const broken = { from: () => { throw new Error("db down"); } } as never;
  assertEquals(await openIncidentOnce(broken, "k", "s"), false);
  assertEquals(await resolveIncidents(broken, ["k"], "n"), 0);
});

// ---- canary judgement ---------------------------------------------------------

const tier = (n: string) => ({ name: n, price: "Ask for a quote", features: ["f"], cta: "Go", cta_href: "contact" });
const goodManifest = () => ({
  name: "Lisbon Yoga Studio",
  theme: {},
  pages: [
    { slug: "home", title: "Home", sections: [
      { type: "hero", variant: "split-image", content: { headline: "Calm", cta_primary: "See plans", cta_primary_href: "pricing" } },
      { type: "about", content: { heading: "A" } }, { type: "feature-split", content: { heading: "B" } },
      { type: "services", content: { heading: "S", items: [{ title: "a" }, { title: "b" }, { title: "c" }] } },
      { type: "faq", content: { heading: "F" } }, { type: "cta", content: { headline: "Join", cta_primary: "Plans", cta_primary_href: "pricing" } } ] },
    { slug: "pricing", title: "Pricing", sections: [{ type: "pricing", content: { heading: "Plans", tiers: [tier("A"), tier("B"), tier("C")] } }, { type: "faq", content: { heading: "Q" } }, { type: "cta", content: { headline: "Go", cta_primary: "Contact", cta_primary_href: "contact" } }] },
    { slug: "classes", title: "Classes", sections: [{ type: "about", content: { heading: "C" } }, { type: "process", content: { heading: "P" } }] },
    { slug: "contact", title: "Contact", sections: [{ type: "contact", content: { heading: "Contact" } }] },
  ],
});

Deno.test("judgeGeneration: a healthy generation passes every check", () => {
  const v = judgeGeneration({ status: 200, json: { manifest: goodManifest(), used_fallback: false, quality_checks: [{ id: "structure", status: "passed" }] } });
  assert(v.ok, v.failures.join(" | "));
  assert(v.checks.length >= 4);
});

Deno.test("judgeGeneration: the starter template, a missing pricing page and an HTTP error are each caught and named", () => {
  const fb = judgeGeneration({ status: 200, json: { manifest: goodManifest(), used_fallback: true, fallback_reason: "The AI gateway was unreachable." } });
  assert(!fb.ok && fb.failures.some((f) => /real_generation: starter template used \(The AI gateway was unreachable\.\)/.test(f)));
  const m = goodManifest(); m.pages = m.pages.filter((p) => p.slug !== "pricing");
  const np = judgeGeneration({ status: 200, json: { manifest: m, used_fallback: false } });
  assert(np.failures.some((f) => /chosen_structure: no pricing page/.test(f)));
  const err = judgeGeneration({ status: 503, json: { error: "Generation is temporarily unavailable" } });
  assert(!err.ok && /responded: HTTP 503/.test(err.failures[0]));
});

Deno.test("judgeProbe: any failed probe fails the verdict and is named with its status", () => {
  assert(judgeProbe([{ name: "chat", ok: true, status: 200, detail: "" }, { name: "image", ok: true, status: 200, detail: "" }]).ok);
  const bad = judgeProbe([{ name: "chat", ok: true, status: 200, detail: "" }, { name: "image", ok: false, status: 429, detail: "You have no credits remaining" }]);
  assert(!bad.ok && /image: HTTP 429: You have no credits remaining/.test(bad.failures[0]));
});

Deno.test("the canary brief is a fixed, fully specified brief", () => {
  assert(/yoga studio in Lisbon/i.test(CANARY_BRIEF));
});
