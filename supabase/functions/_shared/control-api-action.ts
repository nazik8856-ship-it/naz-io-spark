// Pure parsing/validation for one action submitted to control-api, shared by
// both the single-action request path and each entry of a batch request
// (item 11 of the "15 more items" plan) so the two paths can't drift apart.
export type ParsedControlApiAction = {
  actionType: string;
  provider: string;
  description: string;
  params: unknown;
  mode: "fast" | "full";
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
  };
}
