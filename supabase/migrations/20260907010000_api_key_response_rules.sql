-- "Own decision-making machine" plan, item 177 (Phase 2): a two-tier
-- decision pipeline for /respond -- an exact/contains-phrase rule tier,
-- checked BEFORE retrieval+synthesis, for the questions an account owner
-- wants answered with a guaranteed, verbatim, non-negotiable answer
-- (e.g. "how do I cancel" must always get the exact cancellation
-- policy, never a stitched-together synthesis of nearby context
-- entries). Falls through to today's embedding retrieval for everything
-- a rule doesn't cover.
--
-- Deliberately a NEW, dedicated table -- not hard_rules/safety_rules,
-- and not api_key_context_entries either. hard_rules/safety_rules are
-- verdict-shaped (allow/block/escalate an ACTION), which has nothing to
-- do with producing response TEXT; overloading them here would be
-- exactly the schema-overloading this codebase has already explicitly
-- avoided elsewhere (api_response_generations got its own table instead
-- of reusing agent_decisions, for the same reason). And a response rule
-- isn't a context entry either -- a context entry is a FACT a
-- similarity search may or may not surface as relevant material to
-- build an answer from; a rule is a DIRECT, guaranteed instruction:
-- "when the message matches this, answer with exactly this," no
-- synthesis, no dedup, no similarity floor.
CREATE TABLE public.api_key_response_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  api_key_id uuid not null references public.api_keys(id) on delete cascade,
  -- The phrase this rule matches against, normalized (lowercased,
  -- trimmed, whitespace-collapsed) the same way on both sides at match
  -- time -- see _shared/response-rules.ts's own normalize().
  trigger_phrase text not null check (char_length(trigger_phrase) > 0 and char_length(trigger_phrase) <= 500),
  -- 'exact_phrase': the entire (normalized) incoming message must equal
  -- the trigger phrase -- for a single known question asked verbatim.
  -- 'contains_phrase': the (normalized) incoming message must merely
  -- CONTAIN the trigger phrase anywhere -- for a topic that can be
  -- asked many different ways but should always get the same
  -- guaranteed answer (e.g. any message mentioning "cancel").
  match_type text not null default 'contains_phrase' check (match_type in ('exact_phrase', 'contains_phrase')),
  -- The verbatim answer -- returned exactly as written, never stitched
  -- with other entries or reworded, unlike response-synthesis.ts's own
  -- multi-entry stitching for the retrieval tier.
  answer_text text not null check (char_length(answer_text) > 0 and char_length(answer_text) <= 2000),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

CREATE INDEX idx_api_key_response_rules_key_enabled ON public.api_key_response_rules (api_key_id, enabled, created_at);

ALTER TABLE public.api_key_response_rules ENABLE ROW LEVEL SECURITY;
-- Same shape as api_key_context_entries's own RLS: writes go exclusively
-- through api-keys/index.ts's service-role admin client (which does its
-- own resolveAccountScope ownership check first), but a plain SELECT is
-- still granted to the owner/team members directly -- defense in depth,
-- consistent with every other per-key table here, even though today's
-- only reader is that same edge function.
CREATE POLICY "Owners and team members read their api key response rules" ON public.api_key_response_rules
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR is_account_member(user_id));
