-- General data security, tasks 6 and 7: compromise containment and security auditability
-- (docs/compromise-containment.md, docs/security-evidence.md).
--
-- 1. A connected tool can be suspended: NazAI stopped that one path (automatically, after unsafe signals) and a person resumes it.
--    suspended_at / suspended_reason say so; resumed_at starts the count of unsafe signals over, so a resumed tool is not
--    suspended again by the signals that already stopped it.
-- 2. Three more kinds of security evidence: connector_result (what came back from a connected service: outcome, never content),
--    containment (a path was stopped or resumed) and access_refused (a request was refused at the door: a paused key, a key without
--    the scope the route needs).
-- 3. my_security_activity(): the owner's own counts per kind and verdict, to read without exporting the whole chain.

ALTER TABLE public.external_tools
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_reason text CHECK (suspended_reason IS NULL OR char_length(suspended_reason) <= 300),
  ADD COLUMN IF NOT EXISTS resumed_at timestamptz;

-- The website shows "suspended" and why; the stored key columns stay hidden (column-level grants, see 20261014030000).
GRANT SELECT (suspended_at, suspended_reason) ON public.external_tools TO authenticated;

INSERT INTO public.data_classification (table_name, column_name, class) VALUES
('external_tools', 'suspended_reason', 'OPERATIONAL')
ON CONFLICT (table_name, column_name) DO UPDATE SET class = EXCLUDED.class;

-- Existing evidence is untouched: the constraint only gains values, and every old row still satisfies it.
ALTER TABLE public.security_evidence DROP CONSTRAINT IF EXISTS security_evidence_kind_check;
ALTER TABLE public.security_evidence ADD CONSTRAINT security_evidence_kind_check
  CHECK (kind IN ('connector_call', 'credential_change', 'rule_applied', 'output_stored', 'content_held', 'outbound_blocked',
                  'connector_result', 'containment', 'access_refused'));

-- The owner's own activity, counted: how many records of each kind and verdict in the last N days (no subject, no hash, no content).
CREATE OR REPLACE FUNCTION public.my_security_activity(_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT jsonb_build_object(
    'days', least(greatest(coalesce(_days, 30), 1), 365),
    'counts', coalesce((
      SELECT jsonb_agg(jsonb_build_object('kind', x.kind, 'verdict', x.verdict, 'count', x.n) ORDER BY x.kind, x.verdict)
      FROM (SELECT e.kind, e.verdict, count(*) AS n FROM public.security_evidence e
            WHERE e.user_id = auth.uid() AND e.created_at > now() - make_interval(days => least(greatest(coalesce(_days, 30), 1), 365))
            GROUP BY e.kind, e.verdict) x), '[]'::jsonb),
    'checked_at', now())
  WHERE auth.uid() IS NOT NULL;
$fn$;
REVOKE ALL ON FUNCTION public.my_security_activity(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_security_activity(integer) TO authenticated, service_role;
