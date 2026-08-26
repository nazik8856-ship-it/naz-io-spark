// "Zero human review" plan, item 10: every decision NazAI makes is
// already secretly signed internally (sign_agent_decision() trigger,
// 20260809023828_...sql:34-65, fires on every agent_decisions insert
// regardless of source -- an external_api-sourced decision is signed
// identically to an internal one) so NazAI can tell if a record was
// tampered with -- but verify_decision_signature() has only ever been
// callable by an authenticated NazAI user or service_role, never
// reachable from the public Control API. A company building its own
// compliance trail around a fully-automated integration shouldn't have
// to just take NazAI's word for it.
//
// Pure mapping only -- the RPC call and the "does the caller actually
// own this decision" check both need a real DB round trip and live in
// control-api/index.ts itself.

export type DecisionVerificationStatus = "authentic" | "tampered" | "unsigned" | "not_found";

export type DecisionVerificationResult = {
  status: DecisionVerificationStatus;
  message: string;
};

/** Shape of verify_decision_signature()'s raw jsonb result. Deliberately
 * NOT passed through to an external caller as-is -- it also carries
 * internal-only fields (the raw signature/expected_signature hash
 * values, the exact algorithm and field list) that have no reason to
 * ever leave NazAI's own systems. */
export type RawDecisionVerification = {
  found?: boolean;
  verified?: boolean;
  signed?: boolean;
};

/** Pure -- collapses the RPC's raw result into a plain, external-safe answer. */
export function classifyDecisionVerification(raw: RawDecisionVerification): DecisionVerificationResult {
  if (!raw.found) {
    return { status: "not_found", message: "No decision with this id exists for your account." };
  }
  if (!raw.signed) {
    return { status: "unsigned", message: "This decision predates signature support and was never signed." };
  }
  if (raw.verified) {
    return { status: "authentic", message: "Signature matches — this decision record is unaltered since it was created." };
  }
  return { status: "tampered", message: "Signature mismatch — this decision record's content differs from what NazAI originally signed." };
}
