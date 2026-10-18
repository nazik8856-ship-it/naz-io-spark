-- Outer Control: independent steps for the multi-AI report.
--
-- A report Task asks several tools for their own opinion, one after another. Each of those steps must be asked on its own,
-- not shown the answers that came before ("none"); an ordinary step receives the earlier results ("pass", the default).
-- Apply this file BEFORE deploying the functions that write the column.

ALTER TABLE public.outer_control_sessions
  ADD COLUMN IF NOT EXISTS handoff_mode text NOT NULL DEFAULT 'pass' CHECK (handoff_mode IN ('pass', 'none'));
