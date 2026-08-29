// "Zero human review" plan, item 9: a simple, platform-wide health signal
// an API-key-authenticated caller can check BEFORE getting an unexpected
// block, instead of only ever finding out NazAI is paused or degraded by
// getting one back. Deliberately nothing account-specific -- this is
// "is NazAI itself okay right now," not "is MY account okay" (an
// account's own kill switch, spend cap, or a single misconfigured rule
// are normal, expected reasons for a block that have nothing to do with
// NazAI's own health, and mixing the two into one signal would make this
// endpoint useless for its actual purpose: letting an automated
// integration hold off on retries intelligently during a genuine NazAI
// outage, not during its own account's routine policy enforcement).
//
// "paused" mirrors control-gate.ts's own platform_kill_switch check
// exactly (platform_settings.kill_switch) -- a platform operator's
// explicit emergency stop. "degraded" is inferred from the platform-WIDE
// rate of gate_error/gate_error_fail_open decisions (the control gate
// itself throwing an unexpected error, across every account) in a short
// recent window -- there is no dedicated uptime/error-rate table for
// control-engine to read from instead (the existing ControlHealthView.tsx
// only ever computes a PER-ACCOUNT gate-error percentage from
// agent_decisions, which is exactly the account-specific signal this
// endpoint must not surface).

export type PlatformStatus = "operating_normally" | "paused" | "degraded";

export const DEGRADED_LOOKBACK_MINUTES = 15;
// Requires a real sample before ever calling the whole platform
// "degraded" -- a couple of gate errors out of a handful of total
// decisions platform-wide (quiet traffic, e.g. overnight) must never
// read as an outage.
export const DEGRADED_MIN_SAMPLE = 20;
export const DEGRADED_ERROR_RATE_THRESHOLD = 0.2;

/**
 * Pure -- classifies overall platform health from the platform kill
 * switch plus a recent platform-wide gate-error rate. The kill switch
 * always wins: an operator's deliberate pause is "paused," never
 * "degraded," even if the error rate also happens to look bad at the
 * same moment.
 */
export function classifyPlatformStatus(
  killSwitch: boolean,
  totalDecisions: number,
  gateErrorDecisions: number,
): PlatformStatus {
  if (killSwitch) return "paused";
  if (totalDecisions >= DEGRADED_MIN_SAMPLE && gateErrorDecisions / totalDecisions >= DEGRADED_ERROR_RATE_THRESHOLD) {
    return "degraded";
  }
  return "operating_normally";
}

export function platformStatusMessage(status: PlatformStatus): string {
  if (status === "paused") {
    return "A platform operator has paused decision-gating across every account. Verdicts are not being processed right now.";
  }
  if (status === "degraded") {
    return "NazAI is seeing an unusually high rate of internal errors across accounts right now. Verdicts may be less reliable or fail closed more often than usual.";
  }
  return "Operating normally.";
}
