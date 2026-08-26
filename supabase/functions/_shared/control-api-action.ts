// Pure parsing/validation for one action submitted to control-api, shared by
// both the single-action request path and each entry of a batch request
// (item 11 of the "15 more items" plan) so the two paths can't drift apart.
export type ParsedControlApiAction = {
  actionType: string;
  provider: string;
  description: string;
  params: unknown;
  mode: "fast" | "full";
  // "Zero human review" plan, item 13: an optional caller-supplied key so
  // a genuine retry (the caller's own system timed out waiting and
  // resubmitted the identical request) replays the exact same verdict
  // instead of being judged as a brand-new action -- same idempotency_key
  // convention control-engine already uses for its own real-execution
  // step (_shared/idempotency.ts), just scoped here to the whole judged
  // verdict rather than one provider write.
  idempotencyKey: string | null;
};

export type ParseActionResult = ParsedControlApiAction | { error: string };

export const MAX_BATCH_ACTIONS = 50;

export function parseControlApiAction(raw: unknown): ParseActionResult {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const actionType = String(b?.action_type || "").trim();
  const description = String(b?.description || "").trim();
  if (!actionType) return { error: "action_type required" };
  if (!description) return { error: "description required" };
  return {
    actionType,
    provider: String(b?.provider || "unknown").trim() || "unknown",
    description,
    params: b?.params ?? {},
    mode: b?.mode === "full" ? "full" : "fast",
    idempotencyKey: b?.idempotency_key ? String(b.idempotency_key).slice(0, 200) : null,
  };
}
