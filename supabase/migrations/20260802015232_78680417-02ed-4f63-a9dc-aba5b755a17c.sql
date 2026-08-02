ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS confidence_threshold integer NOT NULL DEFAULT 60;

ALTER TABLE public.agents
  DROP CONSTRAINT IF EXISTS agents_confidence_threshold_range;
ALTER TABLE public.agents
  ADD CONSTRAINT agents_confidence_threshold_range CHECK (confidence_threshold >= 0 AND confidence_threshold <= 100);

ALTER TABLE public.agent_decisions
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'model',
  ADD COLUMN IF NOT EXISTS human_response text,
  ADD COLUMN IF NOT EXISTS override_of uuid REFERENCES public.agent_decisions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS escalated boolean NOT NULL DEFAULT false;

ALTER TABLE public.agent_decisions
  DROP CONSTRAINT IF EXISTS agent_decisions_source_check;
ALTER TABLE public.agent_decisions
  ADD CONSTRAINT agent_decisions_source_check CHECK (source IN ('model', 'human_override'));

CREATE INDEX IF NOT EXISTS agent_decisions_override_of_idx ON public.agent_decisions (override_of);