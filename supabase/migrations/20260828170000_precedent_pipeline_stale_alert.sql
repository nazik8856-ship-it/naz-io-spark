-- "Real precedent memory" plan, item 14: lets precedent-pipeline-health-
-- sweep track which api keys it has already alerted on, and clear that
-- flag once coverage recovers -- same shape as
-- agent_integrations.revoked_alerted_at / profiles.auto_resolution_share_alerted_at.
-- Lives on api_keys itself since coverage is measured per api key, not
-- per account (two keys on the same account can have wildly different
-- traffic and health).
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS embedding_pipeline_alerted_at timestamptz;
