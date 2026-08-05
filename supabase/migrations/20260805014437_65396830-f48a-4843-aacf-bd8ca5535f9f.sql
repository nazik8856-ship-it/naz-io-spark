-- De-duplicate existing agents sharing the same slug for a user by suffixing
-- the newer rows, so no data is deleted, then enforce uniqueness going forward.
WITH ranked AS (
  SELECT id, slug,
         ROW_NUMBER() OVER (PARTITION BY user_id, slug ORDER BY created_at ASC, id ASC) AS rn
  FROM public.agents
)
UPDATE public.agents a
SET slug = r.slug || '-' || (r.rn - 1)::text
FROM ranked r
WHERE a.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS agents_user_id_slug_key
  ON public.agents (user_id, slug);