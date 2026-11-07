-- "Was this useful?" answers (docs/onboarding-windows.md, window set 3).
--
-- One row per account: whether the first controlled Task was useful and, if not, which of the four fixed reasons. No free text
-- is stored. The person writes and reads only their own row; the platform's owners and admins see the totals and the latest
-- answers (without who gave them) on /ops/feedback.

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

-- What the platform's owners and admins see on /ops/feedback: the totals, and the latest answers without who gave them.
-- Anyone else (and the anonymous key) is refused; the server's own key may read it too.
CREATE OR REPLACE FUNCTION public.onboarding_feedback_summary(_since timestamptz DEFAULT NULL)
RETURNS TABLE (answer text, reason text, accounts bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY SELECT f.answer, f.reason, count(*) FROM public.onboarding_feedback f
    WHERE _since IS NULL OR f.created_at >= _since
    GROUP BY f.answer, f.reason ORDER BY f.answer, f.reason;
END $fn$;
REVOKE ALL ON FUNCTION public.onboarding_feedback_summary(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.onboarding_feedback_summary(timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.onboarding_feedback_recent(_limit int DEFAULT 50)
RETURNS TABLE (created_at timestamptz, answer text, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY SELECT f.created_at, f.answer, f.reason FROM public.onboarding_feedback f
    ORDER BY f.created_at DESC LIMIT least(greatest(coalesce(_limit, 50), 1), 200);
END $fn$;
REVOKE ALL ON FUNCTION public.onboarding_feedback_recent(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.onboarding_feedback_recent(int) TO authenticated, service_role;
