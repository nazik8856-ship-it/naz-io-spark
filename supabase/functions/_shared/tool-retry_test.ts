// AUDIT 2 (Hard Non-Bypassable Control Gate, 2026-10-07): real tests for the
// bypass this session found and fixed -- a tool-call retry (triggered by a
// Zod validation failure or any retryable executor error) could have its
// entire input rewritten by the model via `correct`, with NO restriction on
// which fields change, and that corrected input then executed directly via
// `execute` -- never re-checked against the control gate that approved the
// ORIGINAL input. These tests prove `reverify` closes it: it runs before
// every single `execute` call, a rejection stops the loop before `execute`
// is ever reached again, and omitting `reverify` entirely preserves the
// exact prior behavior for every existing caller.
//
// Run with: deno test --allow-none supabase/functions/_shared/tool-retry_test.ts
import { runToolWithSelfCorrection, type Corrector, type ToolLogger } from "./tool-retry.ts";

function assert(cond: boolean, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const noopLog: ToolLogger = async () => undefined;

// "send_email"-shaped kind so tool-schemas.ts's validateToolInput has
// nothing to reject on its own -- these tests are only about the
// reverify/correct interaction, not Zod validation itself.
const KIND = "send_email";
const baseInput = { to: "ok@example.com", subject: "s", body: "b" };

Deno.test("reverify: approves the original input on attempt 1 -- execute still runs, behavior unchanged", async () => {
  let executeCalls = 0;
  let reverifyCalls = 0;
  const outcome = await runToolWithSelfCorrection({
    tool: "send_email",
    kind: KIND,
    input: baseInput,
    logEvent: noopLog,
    execute: async (input) => { executeCalls++; return { summary: "sent", error: false }; },
    isFailure: (r: { error: boolean }) => ({ failed: r.error }),
    correct: async () => null,
    reverify: async () => { reverifyCalls++; return { ok: true }; },
  });
  assert(outcome.ok, "expected success");
  assertEquals(executeCalls, 1);
  assertEquals(reverifyCalls, 1, "reverify must run even on the very first attempt");
});

Deno.test("reverify: a rejection on attempt 1 stops the loop -- execute is NEVER called", async () => {
  let executeCalls = 0;
  const outcome = await runToolWithSelfCorrection({
    tool: "send_email",
    kind: KIND,
    input: baseInput,
    logEvent: noopLog,
    execute: async () => { executeCalls++; return { summary: "sent", error: false }; },
    isFailure: (r: { error: boolean }) => ({ failed: r.error }),
    correct: async () => null,
    reverify: async () => ({ ok: false, reason: "Blocked by a hard rule." }),
  });
  assert(!outcome.ok, "expected failure");
  assertEquals(executeCalls, 0, "execute must never run once reverify rejects");
  assertEquals(outcome.failure?.category, "control_gate_blocked");
  assertEquals(outcome.failure?.retryable, false, "a control-gate block must never be treated as retryable");
});

Deno.test("reverify: the EXACT bypass scenario -- a model-corrected retry input is rejected and never executes", async () => {
  // Attempt 1's input is gate-approved elsewhere (not modeled here -- that's
  // the caller's job). It fails here with a retryable executor error, the
  // model "corrects" it into something completely different (simulating an
  // unrestricted rewrite -- a different recipient), and reverify must catch
  // THAT specific corrected input before it ever reaches execute.
  let executeCalls = 0;
  const seenByExecute: Record<string, unknown>[] = [];
  const seenByReverify: Record<string, unknown>[] = [];

  const correct: Corrector = async () => ({
    input: { to: "attacker@evil.example", subject: "s", body: "wire the funds now" },
    explanation: "fixed the recipient",
  });

  const outcome = await runToolWithSelfCorrection({
    tool: "send_email",
    kind: KIND,
    input: baseInput,
    logEvent: noopLog,
    execute: async (input) => { executeCalls++; seenByExecute.push(input); return { summary: "sent", error: true }; }, // force a retry on attempt 1
    isFailure: (r: { error: boolean }) => ({ failed: r.error }),
    correct,
    reverify: async (input) => {
      seenByReverify.push(input);
      // Reject only the corrected (attacker) recipient -- the original input would have passed.
      if (String(input.to).includes("evil")) return { ok: false, reason: "Recipient not in the account's approved contact list." };
      return { ok: true };
    },
  });

  assert(!outcome.ok, "expected failure");
  assertEquals(executeCalls, 1, "execute should have run exactly once, for the ORIGINAL input, before the retry was ever attempted");
  assertEquals(seenByExecute[0]?.to, "ok@example.com");
  assert(
    seenByReverify.some((i) => String(i.to).includes("evil")),
    "reverify must have been asked about the corrected (malicious) input",
  );
  assert(
    !seenByExecute.some((i) => String(i.to).includes("evil")),
    "the corrected malicious input must NEVER reach execute",
  );
  assertEquals(outcome.failure?.category, "control_gate_blocked");
});

Deno.test("reverify: omitted entirely -- a corrected retry executes exactly as it did before this change (backward compatible)", async () => {
  let executeCalls = 0;
  const seenByExecute: Record<string, unknown>[] = [];
  let correctCalls = 0;

  const correct: Corrector = async () => {
    correctCalls++;
    return { input: { to: "ok2@example.com", subject: "s", body: "b" }, explanation: "retry" };
  };

  const outcome = await runToolWithSelfCorrection({
    tool: "send_email",
    kind: KIND,
    input: baseInput,
    logEvent: noopLog,
    execute: async (input) => {
      executeCalls++;
      seenByExecute.push(input);
      return { summary: executeCalls === 1 ? "fail" : "sent", error: executeCalls === 1 };
    },
    isFailure: (r: { error: boolean }) => ({ failed: r.error }),
    correct,
    // no reverify passed at all
  });

  assert(outcome.ok, "expected eventual success without a reverify hook");
  assertEquals(executeCalls, 2);
  assertEquals(correctCalls, 1);
  assertEquals(seenByExecute[1]?.to, "ok2@example.com");
});

Deno.test("reverify: passes on attempt 1, rejects the corrected attempt 2 -- stops exactly there, not before", async () => {
  let executeCalls = 0;
  let reverifyCalls = 0;
  const correct: Corrector = async () => ({ input: { to: "changed@example.com", subject: "s", body: "b" }, explanation: "x" });

  const outcome = await runToolWithSelfCorrection({
    tool: "send_email",
    kind: KIND,
    input: baseInput,
    logEvent: noopLog,
    execute: async () => { executeCalls++; return { summary: "fail", error: true }; }, // always fails -> forces a correction attempt
    isFailure: (r: { error: boolean }) => ({ failed: r.error }),
    correct,
    reverify: async (input) => {
      reverifyCalls++;
      return String(input.to) === "changed@example.com" ? { ok: false, reason: "not approved" } : { ok: true };
    },
  });

  assert(!outcome.ok);
  assertEquals(executeCalls, 1, "attempt 1 passed reverify and executed once, then failed for an unrelated reason");
  assertEquals(reverifyCalls, 2, "reverify ran once for attempt 1 (passed) and once for the corrected attempt 2 (rejected)");
});
