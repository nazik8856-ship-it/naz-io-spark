-- Outer Control text reviews used to store the reviewed text as it arrived. New rows are masked when
-- written; this masks the secret keys, card numbers and national ids already stored in old rows, with
-- the same built-in patterns and labels the scanner uses. The decision log (agent_decisions) is a
-- write-protected audit trail, so its old rows are left as they are.
CREATE OR REPLACE FUNCTION pg_temp.oc_mask(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
    regexp_replace(
      regexp_replace(t,
        '(sk-[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJhbGciOi[A-Za-z0-9_-]{10,})',
        '[REDACTED:secrets]', 'gi'),
      '\y(4[0-9]{12}([0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\y', '[REDACTED:pii]', 'g'),
    '\y[0-9]{3}-[0-9]{2}-[0-9]{4}\y', '[REDACTED:pii]', 'g')
$$;

UPDATE public.outer_control_evaluations SET input_excerpt = pg_temp.oc_mask(input_excerpt)
 WHERE input_excerpt IS NOT NULL AND input_excerpt IS DISTINCT FROM pg_temp.oc_mask(input_excerpt);

UPDATE public.pending_approvals SET description = pg_temp.oc_mask(description)
 WHERE action_type = 'outer_control_text_review' AND description IS NOT NULL AND description IS DISTINCT FROM pg_temp.oc_mask(description);
