-- "10 tasks" plan, item 6: incident-escalation-sweep's 4h threshold
-- (INCIDENT_ESCALATION_HOURS) and audit-integrity-sweep's 3-day stale
-- backstop (STALE_INCIDENT_DAYS) have been flat, hardcoded constants
-- since the incident lifecycle shipped -- fine for a single account, but
-- every account gets the same tolerance for "how long is too long"
-- regardless of how the team actually operates. One row per account,
-- same shape as ai_spend_caps: nullable-by-omission (no row yet means
-- "use the hardcoded default"), not a NOT NULL column on profiles, so
-- existing behavior is unchanged for every account that never touches
-- this.
CREATE TABLE public.incident_thresholds (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  escalation_hours numeric(6,2) NOT NULL DEFAULT 4 CHECK (escalation_hours > 0),
  stale_days numeric(6,2) NOT NULL DEFAULT 3 CHECK (stale_days > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.incident_thresholds TO authenticated;
GRANT ALL ON public.incident_thresholds TO service_role;
ALTER TABLE public.incident_thresholds ENABLE ROW LEVEL SECURITY;

-- Same RBAC shape as ai_spend_caps (RBAC Phase 3 + the later
-- permission-scoped narrowing): the owner always manages their own row;
-- any active team member can view it; only an owner-role member with the
-- 'policy' permission (or unrestricted) can create/update it.
CREATE POLICY "Own incident thresholds" ON public.incident_thresholds
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Create own incident thresholds" ON public.incident_thresholds
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Update own incident thresholds" ON public.incident_thresholds
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Team members can view owner's incident thresholds" ON public.incident_thresholds
  FOR SELECT TO authenticated USING (public.is_account_member(user_id));
CREATE POLICY "Team owners can create owner's incident thresholds" ON public.incident_thresholds
  FOR INSERT TO authenticated WITH CHECK (public.is_account_member(user_id, 'owner', 'policy'));
CREATE POLICY "Team owners can update owner's incident thresholds" ON public.incident_thresholds
  FOR UPDATE TO authenticated USING (public.is_account_member(user_id, 'owner', 'policy')) WITH CHECK (public.is_account_member(user_id, 'owner', 'policy'));

CREATE TRIGGER incident_thresholds_updated_at BEFORE UPDATE ON public.incident_thresholds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
