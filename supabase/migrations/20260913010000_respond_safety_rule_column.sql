-- Correctness-audit fix: /respond never actually applied the account's
-- hard_rules/safety_rules engine to incoming end-user messages, despite
-- that being explicitly planned. Adds a genuinely new, undedicated column
-- rather than repurposing an already-repurposed one (injection_guard_intervened
-- has been overloaded twice already) -- "one boolean per guardrail" stays
-- true.
ALTER TABLE public.api_response_generations
  ADD COLUMN IF NOT EXISTS safety_rule_intervened boolean NOT NULL DEFAULT false;
