-- Correctness verification follow-up to GAP 3 (2026-10-09): the previous
-- migration (20261009050000) claimed agents.generation_notes "mirrors the
-- column websites has had since GAP 5/AUDIT 5" but actually created it as
-- text[], not jsonb -- websites.generation_notes is jsonb NOT NULL DEFAULT
-- '[]'::jsonb. The mismatch never broke anything at runtime (postgrest
-- serializes a JS string array to either shape transparently, and every
-- reader already guards with Array.isArray(...) ?? [] for the nullable
-- case), but it's real column-level drift from the stated intent, caught
-- by re-diffing live information_schema.columns against the migration's
-- own claim rather than trusting the comment. No agents exist yet in this
-- project, so there is no data to convert or lose.
ALTER TABLE public.agents ALTER COLUMN generation_notes DROP DEFAULT;
ALTER TABLE public.agents ALTER COLUMN generation_notes TYPE jsonb USING coalesce(to_jsonb(generation_notes), '[]'::jsonb);
ALTER TABLE public.agents ALTER COLUMN generation_notes SET DEFAULT '[]'::jsonb;
UPDATE public.agents SET generation_notes = '[]'::jsonb WHERE generation_notes IS NULL;
ALTER TABLE public.agents ALTER COLUMN generation_notes SET NOT NULL;
