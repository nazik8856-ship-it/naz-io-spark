-- The built-in "API key or secret" pattern now also catches Anthropic keys (sk-ant-...), OpenAI project keys (sk-proj-...), Stripe
-- live keys (sk_live_, rk_live_), GitHub fine-grained tokens (github_pat_) and AWS access keys (AKIA...). New text is masked by the
-- scanner when it is written; this masks the same kinds of keys in Outer Control text already stored, as 20261018020000 did.
CREATE OR REPLACE FUNCTION pg_temp.oc_mask2(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(t,
    '(sk-ant-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{16,}|rk_live_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})',
    '[REDACTED:secrets]', 'g')
$$;

UPDATE public.outer_control_evaluations SET input_excerpt = pg_temp.oc_mask2(input_excerpt)
 WHERE input_excerpt IS NOT NULL AND input_excerpt IS DISTINCT FROM pg_temp.oc_mask2(input_excerpt);

UPDATE public.pending_approvals SET description = pg_temp.oc_mask2(description)
 WHERE action_type = 'outer_control_text_review' AND description IS NOT NULL AND description IS DISTINCT FROM pg_temp.oc_mask2(description);
