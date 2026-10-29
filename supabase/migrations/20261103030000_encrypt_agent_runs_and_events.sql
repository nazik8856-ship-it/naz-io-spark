-- Data encryption, front 3: what an agent run was asked and how it ended (agent_runs: instruction, summary, outcome), and each
-- step's details and reasoning (agent_events: payload, reasoning), are stored encrypted by the edge functions (DATA_KEY,
-- _shared/encrypted-db.ts), the same way as Outer Control content (20261103010000).
--
-- Three small fields inside an event's payload are needed by the database itself, so they are kept in plain columns, filled by
-- the server on every write (and here for existing events): whether an action succeeded (payload_ok, counted by
-- get_business_context), which question an answer belongs to (payload_ref, used by delete_expired_agent_events), and which event
-- an approval answers (payload_original_event_id, used to refuse a duplicate approval). They are identifiers and flags, not content.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('agent_runs', 'instruction'), ('agent_runs', 'summary'), ('agent_runs', 'outcome'),
    ('agent_events', 'payload'), ('agent_events', 'reasoning')
  ) AS v(t, c) LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS %I text', r.t, r.c || '_enc');
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', r.t, r.c);
    INSERT INTO public.encrypted_columns (table_name, column_name, note)
    VALUES (r.t, r.c, 'Encrypted with DATA_KEY (encrypted-db.ts).')
    ON CONFLICT (table_name, column_name) DO NOTHING;
  END LOOP;
END $$;

ALTER TABLE public.agent_events
  ADD COLUMN IF NOT EXISTS payload_ok boolean,
  ADD COLUMN IF NOT EXISTS payload_ref text,
  ADD COLUMN IF NOT EXISTS payload_original_event_id text;
UPDATE public.agent_events SET
  payload_ok = CASE jsonb_typeof(payload -> 'ok') WHEN 'boolean' THEN (payload ->> 'ok')::boolean END,
  payload_ref = payload ->> 'ref',
  payload_original_event_id = payload ->> 'original_event_id'
WHERE payload IS NOT NULL AND (payload ? 'ok' OR payload ? 'ref' OR payload ? 'original_event_id');
CREATE INDEX IF NOT EXISTS agent_events_original_event_idx ON public.agent_events (agent_id, payload_original_event_id) WHERE payload_original_event_id IS NOT NULL;

DROP TRIGGER IF EXISTS agent_runs_plain_wins ON public.agent_runs;
CREATE TRIGGER agent_runs_plain_wins BEFORE INSERT OR UPDATE ON public.agent_runs FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('instruction', 'summary', 'outcome');
DROP TRIGGER IF EXISTS agent_events_plain_wins ON public.agent_events;
CREATE TRIGGER agent_events_plain_wins BEFORE INSERT OR UPDATE ON public.agent_events FOR EACH ROW
  EXECUTE FUNCTION public.field_encryption_plain_wins('payload', 'reasoning');

-- The two database functions read those fields from the plain columns (and from payload for an event written in the clear).
-- Only the one expression changes in each; the rest of the function is kept exactly as it is.
DO $$
DECLARE d text;
BEGIN
  IF to_regprocedure('public.get_business_context(uuid)') IS NOT NULL THEN
    d := pg_get_functiondef('public.get_business_context(uuid)'::regprocedure);
    IF position('(payload->>''ok'')::boolean IS TRUE' in d) > 0 THEN
      EXECUTE replace(d, '(payload->>''ok'')::boolean IS TRUE', 'COALESCE(payload_ok, (payload->>''ok'')::boolean) IS TRUE');
    END IF;
  END IF;
  IF to_regprocedure('public.delete_expired_agent_events(uuid, timestamp with time zone)') IS NOT NULL THEN
    d := pg_get_functiondef('public.delete_expired_agent_events(uuid, timestamp with time zone)'::regprocedure);
    IF position('(a.payload ->> ''ref'') = e.id::text' in d) > 0 THEN
      EXECUTE replace(d, '(a.payload ->> ''ref'') = e.id::text', 'COALESCE(a.payload_ref, a.payload ->> ''ref'') = e.id::text');
    END IF;
  END IF;
END $$;
