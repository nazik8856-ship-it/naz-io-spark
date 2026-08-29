-- "Knowledge & autonomy" plan, item 9: let an API key's confidence
-- threshold (how certain the model must be before an action_type is
-- "certain enough to not even ask") vary by action type, not just one
-- blanket number per key -- the same lightweight override-list shape
-- item 10 (prior round) already proved out for on_uncertain, reused
-- directly on the SAME table rather than a second parallel one. A row
-- can set an on_uncertain override, a confidence_threshold override, or
-- both -- they're independent, optional dimensions of the same
-- (api_key_id, action_type_pattern) override.
ALTER TABLE public.api_key_action_policies
  ADD COLUMN IF NOT EXISTS confidence_threshold integer NULL
  CHECK (confidence_threshold IS NULL OR (confidence_threshold BETWEEN 0 AND 100));

COMMENT ON COLUMN public.api_key_action_policies.confidence_threshold IS
  'Optional per-action-type override of this key''s confidence threshold. NULL means this row carries no threshold override (it may still override on_uncertain) -- resolveEffectiveConfidenceThreshold (action-type-policy.ts) skips a NULL row and falls through to the next match or the key''s own risk/strictness-based threshold.';
