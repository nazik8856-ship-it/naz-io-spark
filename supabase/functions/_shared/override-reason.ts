// "Knowledge & autonomy" plan, item 2: a real, structured taxonomy for
// why a human resolved an escalated decision the way they did --
// replacing "buried in free text nobody can aggregate" with something a
// later sweep can actually count and group by (item 3's own recurring-
// pattern detection). Kept deliberately small and generic rather than
// action-specific -- these are reasons about NazAI's OWN judgment
// being wrong or incomplete, not about the action itself.
export type OverrideReasonCode =
  | "missing_context"
  | "policy_too_strict"
  | "policy_too_loose"
  | "model_misjudged_risk"
  | "precedent_outdated"
  | "one_off_exception"
  | "other";

export const OVERRIDE_REASON_CODES: readonly OverrideReasonCode[] = [
  "missing_context",
  "policy_too_strict",
  "policy_too_loose",
  "model_misjudged_risk",
  "precedent_outdated",
  "one_off_exception",
  "other",
];

export function isValidOverrideReasonCode(value: unknown): value is OverrideReasonCode {
  return typeof value === "string" && (OVERRIDE_REASON_CODES as readonly string[]).includes(value);
}

/** Plain-language label for a reason code, for anywhere this needs to be shown or summarized without a UI built for it yet. */
export function describeOverrideReasonCode(code: OverrideReasonCode): string {
  switch (code) {
    case "missing_context": return "NazAI was missing context a human had";
    case "policy_too_strict": return "the current policy was more cautious than this case actually needed";
    case "policy_too_loose": return "the current policy would have let through something that needed a closer look";
    case "model_misjudged_risk": return "the model's own risk/intent read was wrong for this case";
    case "precedent_outdated": return "past precedent for this kind of request no longer reflects current reality";
    case "one_off_exception": return "a genuine one-time exception, not a pattern worth changing policy over";
    case "other": return "another reason not covered by the other categories";
  }
}
