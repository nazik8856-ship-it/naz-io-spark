-- Settings change log: agent_decisions audits every AI *action*, but
-- nothing has audited changes to the controls themselves — who raised the
-- spend cap, added/edited/deleted a hard rule or safety rule, changed org
-- strictness. DB-level triggers (not application code) so this can never
-- be silently skipped by a code path that forgets to log — same reasoning
-- as the existing guard_kill_switch / guard_pending_approval_update
-- triggers already in this schema.
CREATE TABLE public.config_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id uuid,
  table_name text NOT NULL,
  row_id uuid,
  action text NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_config_changes_user_created
  ON public.config_changes (user_id, created_at DESC);

GRANT SELECT ON public.config_changes TO authenticated;
GRANT ALL ON public.config_changes TO service_role;

ALTER TABLE public.config_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own config changes"
ON public.config_changes FOR SELECT TO authenticated
USING (auth.uid() = user_id);

-- Generic logger, reused across tables with different key shapes (some
-- have their own `id`, ai_spend_caps' primary key IS user_id) — extracts
-- via jsonb instead of direct field access so it never breaks on a table
-- missing a column it doesn't have.
CREATE OR REPLACE FUNCTION public.log_config_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_row_id uuid;
  v_before jsonb;
  v_after jsonb;
BEGIN
  v_before := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_after := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  v_user_id := COALESCE((v_after->>'user_id')::uuid, (v_before->>'user_id')::uuid);
  v_row_id := COALESCE((v_after->>'id')::uuid, (v_before->>'id')::uuid, v_user_id);

  INSERT INTO public.config_changes (user_id, actor_id, table_name, row_id, action, before, after)
  VALUES (v_user_id, auth.uid(), TG_TABLE_NAME, v_row_id, lower(TG_OP), v_before, v_after);

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER log_hard_rules_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.hard_rules
  FOR EACH ROW EXECUTE FUNCTION public.log_config_change();

CREATE TRIGGER log_safety_rules_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.safety_rules
  FOR EACH ROW EXECUTE FUNCTION public.log_config_change();

CREATE TRIGGER log_ai_spend_caps_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.ai_spend_caps
  FOR EACH ROW EXECUTE FUNCTION public.log_config_change();

-- profiles is a large, frequently-updated table with lots of unrelated
-- columns — a blanket trigger would log every unrelated profile edit as a
-- "config change". Scope this one to only the two fields that actually
-- ARE control-system config: org strictness and the kill switch itself
-- (kill switch already gets a critical_alerts entry when flipped, but not
-- a structured before/after row anywhere else).
CREATE OR REPLACE FUNCTION public.log_profile_config_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.control_strictness IS DISTINCT FROM OLD.control_strictness
     OR NEW.kill_switch IS DISTINCT FROM OLD.kill_switch THEN
    INSERT INTO public.config_changes (user_id, actor_id, table_name, row_id, action, before, after)
    VALUES (
      NEW.id, auth.uid(), 'profiles', NEW.id, 'update',
      jsonb_build_object('control_strictness', OLD.control_strictness, 'kill_switch', OLD.kill_switch),
      jsonb_build_object('control_strictness', NEW.control_strictness, 'kill_switch', NEW.kill_switch)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER log_profiles_config_change
  AFTER UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.log_profile_config_change();
