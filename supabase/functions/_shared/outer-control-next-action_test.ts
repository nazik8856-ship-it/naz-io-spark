// Run with: deno test --allow-env supabase/functions/_shared/outer-control-next-action_test.ts
import { decideNextAction, type NextActionInput } from "./outer-control-next-action.ts";

function assertEquals<T>(a: T, b: T, m?: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const base: NextActionInput = {
  verdict: "allow", toolStatus: "done", stepNo: 1, maxSteps: 5, retriesUsed: 0, maxRetries: 1,
  failuresUsed: 0, maxFailures: 2, elapsedMs: 1000, maxMs: 600_000,
};
const kind = (o: Partial<NextActionInput>) => decideNextAction({ ...base, ...o }).kind;

Deno.test("allow + done -> finish; allow + continue -> continue; allow without a contract -> finish", () => {
  assertEquals(kind({}), "finish");
  assertEquals(kind({ toolStatus: "continue" }), "continue");
  assertEquals(kind({ toolStatus: null }), "finish");
});

Deno.test("modify behaves like allow (the cleaned text is what continues)", () => {
  assertEquals(kind({ verdict: "modify", toolStatus: "continue" }), "continue");
  assertEquals(kind({ verdict: "modify", toolStatus: "done" }), "finish");
});

Deno.test("block -> retry with correction while retries remain, then reject", () => {
  assertEquals(kind({ verdict: "block" }), "retry_with_correction");
  assertEquals(kind({ verdict: "block", retriesUsed: 1 }), "reject");
  assertEquals(kind({ verdict: "block", retriesUsed: 0, maxRetries: 0 }), "reject");
});

Deno.test("escalate -> pause for a person, regardless of the tool's own status", () => {
  assertEquals(kind({ verdict: "escalate" }), "pause_human");
  assertEquals(kind({ verdict: "escalate", toolStatus: "continue" }), "pause_human");
});

Deno.test("need_info on a usable reply -> pause for a person", () => {
  assertEquals(kind({ toolStatus: "need_info" }), "pause_human");
  assertEquals(kind({ verdict: "modify", toolStatus: "need_info" }), "pause_human");
});

Deno.test("a blocked need_info is still a block, not a question", () => {
  assertEquals(kind({ verdict: "block", toolStatus: "need_info" }), "retry_with_correction");
});

Deno.test("failure -> retry unchanged up to the limit, then fail", () => {
  assertEquals(kind({ verdict: null, toolStatus: null }), "retry_same");
  assertEquals(kind({ verdict: null, toolStatus: null, failuresUsed: 1 }), "retry_same");
  assertEquals(kind({ verdict: null, toolStatus: null, failuresUsed: 2 }), "fail");
});

Deno.test("step limit stops an unfinished session; a finished one at the limit still finishes", () => {
  assertEquals(kind({ toolStatus: "continue", stepNo: 5 }), "stop");
  assertEquals(kind({ toolStatus: "done", stepNo: 5 }), "finish");
});

Deno.test("the time limit wins over everything", () => {
  assertEquals(kind({ elapsedMs: 600_001 }), "stop");
  assertEquals(kind({ elapsedMs: 600_001, verdict: "escalate" }), "stop");
  assertEquals(kind({ elapsedMs: 600_001, verdict: null, toolStatus: null }), "stop");
});

// ---- recovery, fallback and hand-off ----------------------------------------------
import { classifyFailure } from "./outer-control-recovery.ts";

Deno.test("a failure that asking again cannot fix ends the retries at once", () => {
  const auth = classifyFailure({ httpStatus: 401, attempt: 1 });
  assertEquals(kind({ verdict: null, toolStatus: null, failure: auth }), "fail");
  assertEquals(kind({ verdict: null, toolStatus: null, failure: auth, onExhausted: "handoff" }), "handoff");
  assertEquals(kind({ verdict: null, toolStatus: null, failure: classifyFailure({ httpStatus: 503, attempt: 1 }) }), "retry_same");
});

Deno.test("exhausted failures use the fallback tool first, then ask a person, then fail", () => {
  const exhausted = { verdict: null, toolStatus: null, failuresUsed: 2 } as Partial<NextActionInput>;
  assertEquals(kind({ ...exhausted, canFallback: true, onExhausted: "handoff" }), "switch_tool");
  assertEquals(kind({ ...exhausted, onExhausted: "handoff" }), "handoff");
  assertEquals(kind({ ...exhausted, onExhausted: "reject" }), "fail");
});

Deno.test("a reply that keeps breaking a rule is handed to a person when asked to, otherwise rejected", () => {
  assertEquals(kind({ verdict: "block", retriesUsed: 1, onExhausted: "handoff" }), "handoff");
  assertEquals(kind({ verdict: "block", retriesUsed: 1, onExhausted: "reject" }), "reject");
  assertEquals(kind({ verdict: "block", retriesUsed: 0, onExhausted: "handoff" }), "retry_with_correction");
});
