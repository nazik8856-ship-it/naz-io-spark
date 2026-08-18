-- Idempotency-key support for control-engine's real-execution step. A
-- client retry (timeout, double-click, two open tabs) must never cause the
-- same real provider write (send an email, post to Slack, ...) to run
-- twice. Same class of bug as the approval-execute double-run fixed
-- earlier — this generalizes the atomic-claim pattern for any caller that
-- sends an idempotency_key.
CREATE TABLE public.idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX idx_idempotency_keys_created
  ON public.idempotency_keys (created_at);

GRANT ALL ON public.idempotency_keys TO service_role;

ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
-- No authenticated-role policies: this table is purely a server-side
-- dedup mechanism for control-engine (service role), never read directly
-- by the client.
