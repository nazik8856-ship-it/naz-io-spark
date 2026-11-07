-- "Was this useful?" answers (docs/onboarding-windows.md, window set 3).
--
-- One row per account: whether the first controlled Task was useful and, if not, which of the four fixed reasons. No free text
-- is stored. The person writes and reads only their own row; onboarding_feedback_summary() gives the platform the totals.

CREATE TABLE IF NOT EXISTS public.onboarding_feedback (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE DEFAULT auth.uid(),
  answer text NOT NULL CHECK (answer IN ('useful', 'not_useful', 'skipped')),
  reason text CHECK (reason IS NULL OR (answer = 'not_useful' AND reason IN ('not_what_i_asked', 'too_slow', 'hard_to_follow', 'other'))),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.onboarding_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.onboarding_feedback FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.onboarding_feedback TO authenticated;
GRANT ALL ON public.onboarding_feedback TO service_role;

DROP POLICY IF EXISTS onboarding_feedback_read_own ON public.onboarding_feedback;
CREATE POLICY onboarding_feedback_read_own ON public.onboarding_feedback FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS onboarding_feedback_insert_own ON public.onboarding_feedback;
CREATE POLICY onboarding_feedback_insert_own ON public.onboarding_feedback FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

INSERT INTO public.isolation_tables (table_name, access, owner_column, read_all_reason, note)
VALUES ('onboarding_feedback', 'self', 'user_id', NULL, '"Was this useful?" answer after the first controlled Task (docs/onboarding-windows.md)')
ON CONFLICT (table_name) DO NOTHING;

INSERT INTO public.data_classification (table_name, column_name, class) VALUES
('onboarding_feedback', 'answer', 'OPERATIONAL'),
('onboarding_feedback', 'reason', 'OPERATIONAL')
ON CONFLICT (table_name, column_name) DO UPDATE SET class = EXCLUDED.class;

-- The totals, for the platform (server only): how many found it useful, and why the others did not.
CREATE OR REPLACE FUNCTION public.onboarding_feedback_summary(_since timestamptz DEFAULT NULL)
RETURNS TABLE (answer text, reason text, accounts bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT f.answer, f.reason, count(*) FROM public.onboarding_feedback f
  WHERE _since IS NULL OR f.created_at >= _since
  GROUP BY f.answer, f.reason ORDER BY f.answer, f.reason;
$fn$;
REVOKE ALL ON FUNCTION public.onboarding_feedback_summary(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.onboarding_feedback_summary(timestamptz) TO service_role;
