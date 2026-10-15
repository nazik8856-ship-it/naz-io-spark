-- A removed tool is switched off and hidden, not deleted: the sessions that used it keep their history.
ALTER TABLE public.external_tools ADD COLUMN IF NOT EXISTS removed_at timestamptz;
GRANT SELECT (removed_at) ON public.external_tools TO authenticated;
