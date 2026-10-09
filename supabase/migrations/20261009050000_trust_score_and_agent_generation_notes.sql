-- GAP 3 (Trust Score + Provenance + Control Report, 2026-10-09): AUDIT 5
-- (2026-10-07) gave Outer Control's own evaluations a numeric trust score
-- (outer_control_evaluations.trust_score) and websites a rules-applied/
-- changes-made report (websites.generation_notes, rendered by
-- WebsiteControlReport.tsx) -- but neither the Generator's websites nor its
-- agents ever got a numeric trust score, and agents never got a dedicated
-- report surface at all (their safety findings only ever landed mixed into
-- manifest.guardrails, alongside ordinary behavioral rules, with nothing
-- distinguishing one from the other for a UI to render separately).
--
-- trust_score is computed by the exact same computeTrustScore
-- (outer-control-scoring.ts) Outer Control's own evaluations already use --
-- no new scoring logic, just the same pure function applied to the
-- Generator's own safety-rule matches. generation_notes on agents mirrors
-- the column websites has had since GAP 5/AUDIT 5: every generation-time
-- and final-assembly-check finding, kept separate from manifest.guardrails
-- so a UI can render "what was checked" without filtering out ordinary
-- guardrails the model itself authored.
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS trust_score integer;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS generation_notes text[];
ALTER TABLE public.websites ADD COLUMN IF NOT EXISTS trust_score integer;
