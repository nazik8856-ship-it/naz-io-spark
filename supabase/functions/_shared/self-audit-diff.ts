// Pure regression-diff logic for the weekly control-system self-audit —
// extracted out of control-self-audit's DB-coupled orchestration so it's
// directly unit-testable.

/** A scenario counts as "passing" for regression purposes on pass or soft_pass. */
export function isPassingStatus(status: string | undefined): boolean {
  return status === "pass" || status === "soft_pass";
}

/**
 * A regression is a scenario that passed (or soft-passed) on the previous
 * run and does NOT pass now. A scenario with no prior recorded status is
 * never a regression — it's new, not a break.
 */
export function findRegressions(
  scenarioIds: string[],
  prevStatus: Record<string, string>,
  currentStatus: Record<string, string>,
): string[] {
  return scenarioIds.filter(
    (id) => isPassingStatus(prevStatus[id]) && !isPassingStatus(currentStatus[id]),
  );
}
