-- onboarding_feedback: the same owner guard every per-account table has (isolation_report "owner_unguarded"). Nobody may update
-- the table today, so this changes nothing in practice; it keeps the row's owner fixed should an update ever be allowed.
DROP TRIGGER IF EXISTS prevent_owner_change ON public.onboarding_feedback;
CREATE TRIGGER prevent_owner_change BEFORE UPDATE OF user_id ON public.onboarding_feedback
  FOR EACH ROW EXECUTE FUNCTION public.prevent_owner_change('user_id');
