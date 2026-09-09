-- Prerequisite fix for the retention-sweep revoked-key purge that follows
-- this migration: ai_spend_daily.api_key_id was defined ON DELETE CASCADE,
-- which is wrong for this table specifically. ai_spend_daily is real,
-- durable financial history (a per-day cost/usage total, keyed primarily
-- by user_id, with api_key_id as one optional attribution dimension
-- alongside agent_id) -- account-wide reporting (compliance-attestation,
-- the monthly/weekly report emails) sums it by user_id, and the codebase's
-- own data-deletion-sweep treats it as something only a full account
-- deletion should ever clear. No code path has ever deleted an api_keys
-- row before now (grep confirms every existing "revoke" flow only sets
-- revoked_at), so this CASCADE has been a dormant, never-yet-triggered
-- bug -- fixed before retention-sweep becomes the first thing to actually
-- delete api_keys rows.
--
-- agent_decisions.api_key_id already uses ON DELETE SET NULL for exactly
-- this reason (that table's own independent retention_days-based cleanup
-- governs when a decision itself is removed, not whether its originating
-- key still exists) -- this brings ai_spend_daily in line with that same,
-- already-correct pattern instead of inventing a new one.
ALTER TABLE public.ai_spend_daily
  DROP CONSTRAINT ai_spend_daily_api_key_id_fkey,
  ADD CONSTRAINT ai_spend_daily_api_key_id_fkey
    FOREIGN KEY (api_key_id) REFERENCES public.api_keys(id) ON DELETE SET NULL;
