-- Generator UX + quality (2026-10-12):
--  * websites.structure_template  -- the Smart Structure Selector choice
--    (simple-landing | full-business | pricing-focused | agency); later chat
--    edits and the "Make it more professional" pass keep following it.
--  * websites.strict_mode         -- Strict Mode toggle; the professional pass
--    and later regenerations keep applying the strict rules.
--  * websites.generation_stage    -- progressive refinement:
--    'content' (structure approved, content generated, awaiting visual
--    polish) | 'polished' (visual polish pass has run). NULL for sites that
--    predate the staged flow or were generated in one shot.
--  * generation_progress.checks   -- live Quality Preview Strip: the four
--    check states (structure / visual / images / claims) reported while a
--    request is in flight, polled by GeneratorHome.
ALTER TABLE public.websites
  ADD COLUMN IF NOT EXISTS structure_template text,
  ADD COLUMN IF NOT EXISTS strict_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS generation_stage text;

ALTER TABLE public.generation_progress
  ADD COLUMN IF NOT EXISTS checks jsonb;
