-- Blueprint task #60/#62: a place to record what the account's safety_rules
-- actually did to a generated page's own copy at save time (redacted a
-- secret/PII match, or flagged a non-redactable one) -- the website
-- equivalent of agents.manifest's guardrails array gaining removal/flag
-- notes from the agent-side gate. Consumed by task #62's control report.
ALTER TABLE public.websites
  ADD COLUMN IF NOT EXISTS generation_notes jsonb NOT NULL DEFAULT '[]'::jsonb;
