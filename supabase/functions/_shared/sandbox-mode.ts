// "Knowledge & autonomy" plan, item 7: sandbox (test-mode) API keys judge
// exactly like a real key -- same gate, same prompt, same verdict shape --
// but must never count toward anything the platform treats as REAL
// evidence: AI spend, embedding/precedent storage, calibration,
// automation-readiness, or cross-account precedent sharing. This is the
// one small, named, fully-tested gate every one of those call sites
// checks, so "does this count toward something real" is answered the
// same way everywhere instead of five separate ad-hoc `!isTest` checks.
export function countsTowardRealUsage(isTest: boolean | null | undefined): boolean {
  return isTest !== true;
}

// Surfaced on a test-key verdict so a caller building against sandbox
// traffic can see, in the response itself, that this request ran in test
// mode -- never added to a real key's response, so a real key's verdict
// shape is completely unchanged by this item's existence.
export function testModeVerdictNote(isTest: boolean | null | undefined): string | null {
  if (isTest !== true) return null;
  return "This request ran on a sandbox (test-mode) API key -- judged exactly like a real request, " +
    "but never counted toward real AI spend, precedent, confidence calibration, or automation-readiness.";
}
