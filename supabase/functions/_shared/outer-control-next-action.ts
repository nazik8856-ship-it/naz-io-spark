// Outer Control (active): what to do after one exchange with an external tool.
// Pure, so the whole table is unit-tested. The session driver only applies the result.
import type { OuterControlVerdict } from "./outer-control-scoring.ts";
import type { FailureClass } from "./outer-control-recovery.ts";

export type NextActionKind =
  | "continue" // accepted; ask the tool for another round
  | "finish" // accepted and the tool is done
  | "retry_with_correction" // blocked; ask again, naming what was violated
  | "retry_same" // tool/network failure; ask again unchanged
  | "pause_human" // a person is needed (escalation or a question)
  | "reject" // blocked and out of retries
  | "stop" // limit reached
  | "switch_tool" // the tool kept failing; use the leg's fallback tool
  | "handoff" // retries ran out and a person should decide
  | "fail"; // tool kept failing

export type NextAction = { kind: NextActionKind; reason: string };

export type NextActionInput = {
  /** Null when the exchange failed before a verdict existed (network/HTTP/parse error). */
  verdict: OuterControlVerdict | null;
  toolStatus: "done" | "continue" | "need_info" | null;
  stepNo: number;
  maxSteps: number;
  /** Rejected replies already seen on this step. */
  retriesUsed: number;
  maxRetries: number;
  /** Failed exchanges already seen on this step. */
  failuresUsed: number;
  maxFailures: number;
  elapsedMs: number;
  maxMs: number;
  /** What kind of failure it was; one that asking again cannot fix ends the retries at once. */
  failure?: FailureClass | null;
  /** A fallback tool exists and has not been used yet. */
  canFallback?: boolean;
  /** When retries run out: ask a person (default for new sessions) or end the session. */
  onExhausted?: "reject" | "handoff";
};

export const DEFAULT_MAX_FAILURES = 3;
export const SESSION_TIME_LIMIT_MS = 10 * 60_000;

export function decideNextAction(i: NextActionInput): NextAction {
  if (i.elapsedMs > i.maxMs) return { kind: "stop", reason: "The session time limit was reached." };

  if (i.verdict === null) {
    const retryable = i.failure ? i.failure.retry : true;
    if (retryable && i.failuresUsed < i.maxFailures) return { kind: "retry_same", reason: i.failure?.reason ?? "The tool did not answer usably; asking again." };
    const why = i.failure?.reason ?? "The tool kept failing.";
    if (i.canFallback) return { kind: "switch_tool", reason: `${why} Switching to the fallback tool.` };
    if (i.onExhausted === "handoff") return { kind: "handoff", reason: why };
    return { kind: "fail", reason: why };
  }

  if (i.verdict === "block") {
    if (i.retriesUsed < i.maxRetries) return { kind: "retry_with_correction", reason: "The reply broke a rule; asking again without it." };
    return i.onExhausted === "handoff"
      ? { kind: "handoff", reason: "The reply broke a rule and no retries are left." }
      : { kind: "reject", reason: "The reply broke a rule and no retries are left." };
  }

  if (i.verdict === "escalate") return { kind: "pause_human", reason: "The reply needs a person's approval." };

  // allow / modify: the reply is usable (cleaned when modified).
  if (i.toolStatus === "need_info") return { kind: "pause_human", reason: "The tool needs information only a person can give." };
  if (i.toolStatus === "done" || i.toolStatus === null) return { kind: "finish", reason: "The tool reported the objective as done." };
  return i.stepNo >= i.maxSteps
    ? { kind: "stop", reason: "The step limit was reached before the tool finished." }
    : { kind: "continue", reason: "Accepted; asking for the next round." };
}
