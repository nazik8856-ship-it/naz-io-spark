-- Pillar 5 item 2: clean_allow_counts has RLS enabled but has NEVER had a
-- single policy on it -- every existing reader (control-api's /status
-- route, api-keys' per-key performance report) goes through a service-role
-- edge function, which bypasses RLS entirely, so this went unnoticed. Fixing
-- ControlHealthView.tsx to fold this table into its own uptime/error-rate
-- computation is pointless without this: a direct browser client read
-- (the anon/authenticated role, RLS-enforced) would silently return zero
-- rows for every account, forever, no matter who's logged in.
CREATE POLICY "Users can view their own clean allow counts" ON public.clean_allow_counts
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Team members can view owner's clean allow counts" ON public.clean_allow_counts
  FOR SELECT TO authenticated
  USING (public.is_account_member(user_id));
