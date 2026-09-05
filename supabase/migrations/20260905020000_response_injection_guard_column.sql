-- "/respond" MVP backlog, item 164: a real, queryable record of when the
-- deterministic context-leak guard (_shared/response-injection-guard.ts)
-- fired -- distinct from grounding_check_intervened, which answers a
-- different question (did the LLM-based grounding pass reject an
-- unsupported claim). Same convention as that column: one boolean per
-- guardrail, never blended together, so a report grouped by which
-- safeguard actually fired stays meaningful.
ALTER TABLE public.api_response_generations
  ADD COLUMN IF NOT EXISTS injection_guard_intervened boolean NOT NULL DEFAULT false;
