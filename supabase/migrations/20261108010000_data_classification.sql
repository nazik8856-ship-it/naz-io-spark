-- General data security, task 1: the data classification baseline (docs/data-classification.md).
--
-- data_classification gives every text, JSON, array or vector column of every public table exactly one class:
--   SECRET            credentials and what verifies them; the credential itself only in the vault; never readable from a browser
--   RULE              rules and policies; readable to the database (the gate matches against them), isolated per account
--   PROJECT_CONTENT   what an account creates or gives NazAI
--   EXTERNAL_RESPONSE what came from outside NazAI (tool replies, synced data, research, a customer's own users' messages)
--   PERSONAL          contact data of people (emails, names, IP addresses, form submissions)
--   OPERATIONAL       statuses, names, ids, fingerprints, scrubbed error text, NazAI's own bookkeeping
-- The handling rules of each class are in supabase/functions/_shared/data-classes.ts (CLASS_POLICY); that file and this seed list
-- the same columns (checked by src/test/data-classification.test.ts, which also fails the build when a migration adds a column
-- without a class).
--
-- classification_report() checks the live schema: a column without a class, a class for a column that is gone, a SECRET column a
-- browser session could read, a credential stored outside the vault (secrets_exposure_report), an encrypted column whose class is
-- not a content class. data_classification_weekly_check() (Mondays 03:47 UTC) keeps the data_classification incident open while
-- the report has anything. classification_gaps() lists the content columns that are neither encrypted nor exempt: the work list
-- for at-rest protection (task 3), not a failure.
--
-- Also: the short-lived OAuth sign-in rows (state, code verifier) are read and written only by the server; the browser roles lose
-- the table rights they never needed (no policy let them see a row).

CREATE TABLE IF NOT EXISTS public.data_classification (
  table_name text NOT NULL,
  column_name text NOT NULL,
  class text NOT NULL CHECK (class IN ('SECRET', 'RULE', 'PROJECT_CONTENT', 'EXTERNAL_RESPONSE', 'PERSONAL', 'OPERATIONAL')),
  note text,
  PRIMARY KEY (table_name, column_name)
);
ALTER TABLE public.data_classification ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_classification FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.data_classification TO service_role;

INSERT INTO public.isolation_tables (table_name, access, owner_column, read_all_reason, note)
VALUES ('data_classification', 'system_only', NULL, NULL, 'the class of every content column (docs/data-classification.md)')
ON CONFLICT (table_name) DO NOTHING;

INSERT INTO public.data_classification (table_name, column_name, class) VALUES
('account_members', 'email', 'PERSONAL'),
('account_members', 'permissions', 'OPERATIONAL'),
('account_members', 'role', 'OPERATIONAL'),
('account_members', 'status', 'OPERATIONAL'),
('action_reversals', 'error', 'OPERATIONAL'),
('action_reversals', 'irreversible_reason', 'OPERATIONAL'),
('action_reversals', 'provider', 'OPERATIONAL'),
('action_reversals', 'ref', 'OPERATIONAL'),
('action_reversals', 'status', 'OPERATIONAL'),
('action_reversals', 'summary', 'OPERATIONAL'),
('action_reversals', 'tool', 'OPERATIONAL'),
('action_reversals', 'undo_effect', 'OPERATIONAL'),
('action_reversals', 'undo_kind', 'OPERATIONAL'),
('action_reversals', 'undo_payload', 'EXTERNAL_RESPONSE'),
('agent_artifacts', 'account_email', 'PERSONAL'),
('agent_artifacts', 'kind', 'OPERATIONAL'),
('agent_artifacts', 'provider', 'OPERATIONAL'),
('agent_artifacts', 'ref', 'OPERATIONAL'),
('agent_artifacts', 'title', 'PROJECT_CONTENT'),
('agent_artifacts', 'url', 'PROJECT_CONTENT'),
('agent_clients', 'company', 'PERSONAL'),
('agent_clients', 'email', 'PERSONAL'),
('agent_clients', 'name', 'PERSONAL'),
('agent_clients', 'notes', 'PROJECT_CONTENT'),
('agent_clients', 'tags', 'PROJECT_CONTENT'),
('agent_decisions', 'action_type', 'OPERATIONAL'),
('agent_decisions', 'alternatives_considered', 'PROJECT_CONTENT'),
('agent_decisions', 'decision', 'OPERATIONAL'),
('agent_decisions', 'deferred_detail', 'OPERATIONAL'),
('agent_decisions', 'description', 'PROJECT_CONTENT'),
('agent_decisions', 'gate_trace', 'OPERATIONAL'),
('agent_decisions', 'human_response', 'PROJECT_CONTENT'),
('agent_decisions', 'human_response_signature', 'OPERATIONAL'),
('agent_decisions', 'modified_params', 'PROJECT_CONTENT'),
('agent_decisions', 'params', 'PROJECT_CONTENT'),
('agent_decisions', 'plan_id', 'OPERATIONAL'),
('agent_decisions', 'precedent_citations', 'OPERATIONAL'),
('agent_decisions', 'provider', 'OPERATIONAL'),
('agent_decisions', 'reasoning', 'PROJECT_CONTENT'),
('agent_decisions', 'signature', 'OPERATIONAL'),
('agent_decisions', 'signing_key_id', 'OPERATIONAL'),
('agent_decisions', 'source', 'OPERATIONAL'),
('agent_events', 'confidence', 'OPERATIONAL'),
('agent_events', 'kind', 'OPERATIONAL'),
('agent_events', 'payload', 'PROJECT_CONTENT'),
('agent_events', 'payload_original_event_id', 'OPERATIONAL'),
('agent_events', 'payload_ref', 'OPERATIONAL'),
('agent_events', 'reasoning', 'PROJECT_CONTENT'),
('agent_integrations', 'credentials', 'SECRET'),
('agent_integrations', 'last_error', 'OPERATIONAL'),
('agent_integrations', 'metadata', 'EXTERNAL_RESPONSE'),
('agent_integrations', 'provider', 'OPERATIONAL'),
('agent_integrations', 'status', 'OPERATIONAL'),
('agent_memory', 'key', 'PROJECT_CONTENT'),
('agent_memory', 'source', 'OPERATIONAL'),
('agent_memory', 'value', 'PROJECT_CONTENT'),
('agent_reports', 'body_markdown', 'PROJECT_CONTENT'),
('agent_reports', 'kind', 'OPERATIONAL'),
('agent_reports', 'title', 'PROJECT_CONTENT'),
('agent_runs', 'instruction', 'PROJECT_CONTENT'),
('agent_runs', 'outcome', 'PROJECT_CONTENT'),
('agent_runs', 'status', 'OPERATIONAL'),
('agent_runs', 'summary', 'PROJECT_CONTENT'),
('agent_runs', 'trigger', 'OPERATIONAL'),
('agent_strictness_overrides', 'strictness', 'RULE'),
('agents', 'autonomy', 'RULE'),
('agents', 'client_write_mode', 'RULE'),
('agents', 'generation_notes', 'OPERATIONAL'),
('agents', 'goal', 'PROJECT_CONTENT'),
('agents', 'kill_switch_source', 'OPERATIONAL'),
('agents', 'manifest', 'PROJECT_CONTENT'),
('agents', 'name', 'PROJECT_CONTENT'),
('agents', 'role', 'PROJECT_CONTENT'),
('agents', 'schedule_cron', 'OPERATIONAL'),
('agents', 'schedule_label', 'OPERATIONAL'),
('agents', 'slug', 'PROJECT_CONTENT'),
('agents', 'source_plan', 'PROJECT_CONTENT'),
('agents', 'status', 'OPERATIONAL'),
('api_key_action_policies', 'action_type_pattern', 'RULE'),
('api_key_action_policies', 'on_uncertain', 'RULE'),
('api_key_context_entries', 'embedding', 'PROJECT_CONTENT'),
('api_key_context_entries', 'entry_text', 'PROJECT_CONTENT'),
('api_key_response_rules', 'answer_text', 'RULE'),
('api_key_response_rules', 'match_type', 'RULE'),
('api_key_response_rules', 'trigger_phrase', 'RULE'),
('api_key_shadow_observations', 'action_type', 'OPERATIONAL'),
('api_key_shadow_observations', 'provider', 'OPERATIONAL'),
('api_key_shadow_observations', 'shadow_resolution', 'OPERATIONAL'),
('api_keys', 'callback_fallback', 'RULE'),
('api_keys', 'callback_secret', 'SECRET'),
('api_keys', 'callback_url', 'PROJECT_CONTENT'),
('api_keys', 'fallback_message', 'PROJECT_CONTENT'),
('api_keys', 'key_hash', 'SECRET'),
('api_keys', 'key_prefix', 'OPERATIONAL'),
('api_keys', 'name', 'PROJECT_CONTENT'),
('api_keys', 'on_gate_error', 'RULE'),
('api_keys', 'on_uncertain', 'RULE'),
('api_keys', 'on_uncertain_downgrade_kind', 'OPERATIONAL'),
('api_keys', 'on_uncertain_downgrade_reason', 'OPERATIONAL'),
('api_keys', 'quiet_hours_timezone', 'RULE'),
('api_keys', 'response_persona', 'PROJECT_CONTENT'),
('api_keys', 'scopes', 'RULE'),
('api_keys', 'shadow_on_uncertain', 'RULE'),
('api_response_cache', 'answer', 'PROJECT_CONTENT'),
('api_response_cache', 'confidence', 'OPERATIONAL'),
('api_response_cache', 'embedding', 'EXTERNAL_RESPONSE'),
('api_response_cache', 'message', 'EXTERNAL_RESPONSE'),
('api_response_cache', 'message_hash', 'OPERATIONAL'),
('api_response_cache', 'sources', 'EXTERNAL_RESPONSE'),
('api_response_generations', 'message', 'EXTERNAL_RESPONSE'),
('audit_integrity_runs', 'triggered_by', 'OPERATIONAL'),
('automation_readiness_signal_state', 'signal', 'OPERATIONAL'),
('business_profiles', 'audience', 'PROJECT_CONTENT'),
('business_profiles', 'channels', 'PROJECT_CONTENT'),
('business_profiles', 'company_name', 'PROJECT_CONTENT'),
('business_profiles', 'industry', 'PROJECT_CONTENT'),
('business_profiles', 'inferred_kpis', 'PROJECT_CONTENT'),
('business_profiles', 'offers', 'PROJECT_CONTENT'),
('business_profiles', 'one_liner', 'PROJECT_CONTENT'),
('business_profiles', 'raw_research', 'EXTERNAL_RESPONSE'),
('business_profiles', 'source_url', 'PROJECT_CONTENT'),
('business_profiles', 'tone', 'PROJECT_CONTENT'),
('canva_oauth_transactions', 'code_verifier', 'SECRET'),
('canva_oauth_transactions', 'request_origin', 'OPERATIONAL'),
('canva_oauth_transactions', 'scope_groups', 'OPERATIONAL'),
('canva_oauth_transactions', 'state', 'SECRET'),
('circuit_breakers', 'action_type', 'OPERATIONAL'),
('circuit_breakers', 'last_reason', 'OPERATIONAL'),
('circuit_breakers', 'recent_outcomes', 'OPERATIONAL'),
('confidence_calibration', 'bucket_label', 'OPERATIONAL'),
('confidence_calibration', 'note', 'OPERATIONAL'),
('confidence_calibration', 'severity', 'OPERATIONAL'),
('config_changes', 'action', 'OPERATIONAL'),
('config_changes', 'after', 'RULE'),
('config_changes', 'before', 'RULE'),
('config_changes', 'table_name', 'OPERATIONAL'),
('content_gap_clusters', 'embedding', 'EXTERNAL_RESPONSE'),
('content_gap_clusters', 'representative_message', 'EXTERNAL_RESPONSE'),
('control_test_runs', 'regressions', 'OPERATIONAL'),
('control_test_runs', 'scenario_status', 'OPERATIONAL'),
('control_test_runs', 'summary', 'OPERATIONAL'),
('control_test_runs', 'triggered_by', 'OPERATIONAL'),
('credit_transactions', 'description', 'OPERATIONAL'),
('credit_transactions', 'metadata', 'OPERATIONAL'),
('credit_transactions', 'status', 'OPERATIONAL'),
('credit_transactions', 'type', 'OPERATIONAL'),
('critical_alerts', 'action_type', 'OPERATIONAL'),
('critical_alerts', 'actor', 'OPERATIONAL'),
('critical_alerts', 'delivered_via', 'OPERATIONAL'),
('critical_alerts', 'event', 'OPERATIONAL'),
('critical_alerts', 'provider', 'OPERATIONAL'),
('critical_alerts', 'summary', 'OPERATIONAL'),
('cross_account_precedent_stats', 'action_type', 'OPERATIONAL'),
('cross_account_precedent_stats', 'provider', 'OPERATIONAL'),
('data_classification', 'class', 'OPERATIONAL'),
('data_classification', 'column_name', 'OPERATIONAL'),
('data_classification', 'note', 'OPERATIONAL'),
('data_classification', 'table_name', 'OPERATIONAL'),
('data_deletion_requests', 'status', 'OPERATIONAL'),
('decision_embeddings', 'action_type', 'OPERATIONAL'),
('decision_embeddings', 'embedding', 'PROJECT_CONTENT'),
('decision_embeddings', 'provider', 'OPERATIONAL'),
('decision_outcomes', 'direction', 'OPERATIONAL'),
('decision_outcomes', 'evidence', 'EXTERNAL_RESPONSE'),
('decision_outcomes', 'linked_metric', 'OPERATIONAL'),
('decision_outcomes', 'provider', 'OPERATIONAL'),
('email_send_log', 'error_message', 'OPERATIONAL'),
('email_send_log', 'message_id', 'OPERATIONAL'),
('email_send_log', 'metadata', 'OPERATIONAL'),
('email_send_log', 'recipient_email', 'PERSONAL'),
('email_send_log', 'status', 'OPERATIONAL'),
('email_send_log', 'template_name', 'OPERATIONAL'),
('email_unsubscribe_tokens', 'email', 'PERSONAL'),
('email_unsubscribe_tokens', 'token', 'SECRET'),
('encrypted_columns', 'column_name', 'OPERATIONAL'),
('encrypted_columns', 'note', 'OPERATIONAL'),
('encrypted_columns', 'plain_empty', 'OPERATIONAL'),
('encrypted_columns', 'table_name', 'OPERATIONAL'),
('encryption_exempt_columns', 'column_name', 'OPERATIONAL'),
('encryption_exempt_columns', 'reason', 'OPERATIONAL'),
('encryption_exempt_columns', 'table_name', 'OPERATIONAL'),
('external_tools', 'auth_header', 'OPERATIONAL'),
('external_tools', 'auth_scheme', 'OPERATIONAL'),
('external_tools', 'endpoint_url', 'PROJECT_CONTENT'),
('external_tools', 'last_error', 'OPERATIONAL'),
('external_tools', 'model', 'OPERATIONAL'),
('external_tools', 'name', 'PROJECT_CONTENT'),
('external_tools', 'request_format', 'OPERATIONAL'),
('figma_oauth_transactions', 'state', 'SECRET'),
('generation_cache', 'cache_key', 'OPERATIONAL'),
('generation_cache', 'kind', 'OPERATIONAL'),
('generation_cache', 'manifest', 'PROJECT_CONTENT'),
('generation_canary_runs', 'checks', 'OPERATIONAL'),
('generation_canary_runs', 'mode', 'OPERATIONAL'),
('generation_progress', 'checks', 'OPERATIONAL'),
('generation_progress', 'stage', 'OPERATIONAL'),
('gmail_oauth_transactions', 'state', 'SECRET'),
('hard_rule_shadow_hits', 'action_type', 'OPERATIONAL'),
('hard_rule_shadow_hits', 'actual_decision', 'OPERATIONAL'),
('hard_rule_shadow_hits', 'provider', 'OPERATIONAL'),
('hard_rule_shadow_hits', 'would_have', 'OPERATIONAL'),
('hard_rules', 'action_type_pattern', 'RULE'),
('hard_rules', 'effect', 'RULE'),
('hard_rules', 'provider', 'RULE'),
('hard_rules', 'rationale', 'RULE'),
('hard_rules', 'rule_text', 'RULE'),
('idempotency_keys', 'idempotency_key', 'OPERATIONAL'),
('idempotency_keys', 'response', 'PROJECT_CONTENT'),
('imported_projects', 'content', 'PROJECT_CONTENT'),
('imported_projects', 'content_sha256', 'OPERATIONAL'),
('imported_projects', 'content_type', 'OPERATIONAL'),
('imported_projects', 'files', 'PROJECT_CONTENT'),
('imported_projects', 'last_check', 'OPERATIONAL'),
('imported_projects', 'name', 'PROJECT_CONTENT'),
('imported_projects', 'source_kind', 'OPERATIONAL'),
('imported_projects', 'source_label', 'PROJECT_CONTENT'),
('imported_projects', 'source_mode', 'OPERATIONAL'),
('imported_projects', 'source_ref', 'PROJECT_CONTENT'),
('imported_projects', 'sync_error', 'OPERATIONAL'),
('incidents', 'action_type', 'OPERATIONAL'),
('incidents', 'kind', 'OPERATIONAL'),
('incidents', 'provider', 'OPERATIONAL'),
('incidents', 'resolution_note', 'OPERATIONAL'),
('incidents', 'root_cause_category', 'OPERATIONAL'),
('incidents', 'status', 'OPERATIONAL'),
('incidents', 'summary', 'OPERATIONAL'),
('integration_issues', 'error_type', 'OPERATIONAL'),
('integration_issues', 'fix_action', 'OPERATIONAL'),
('integration_issues', 'human_message', 'OPERATIONAL'),
('integration_issues', 'issue_key', 'OPERATIONAL'),
('integration_issues', 'provider', 'OPERATIONAL'),
('integration_issues', 'resolution', 'OPERATIONAL'),
('integration_issues', 'scope_hint', 'OPERATIONAL'),
('integration_issues', 'status', 'OPERATIONAL'),
('integration_issues', 'technical', 'OPERATIONAL'),
('integration_issues', 'title', 'OPERATIONAL'),
('integration_issues', 'tool_kind', 'OPERATIONAL'),
('integration_snapshots', 'data', 'EXTERNAL_RESPONSE'),
('integration_snapshots', 'error', 'OPERATIONAL'),
('integration_snapshots', 'kind', 'OPERATIONAL'),
('integration_snapshots', 'provider', 'OPERATIONAL'),
('ip_rate_limit_windows', 'endpoint', 'OPERATIONAL'),
('ip_rate_limit_windows', 'ip', 'PERSONAL'),
('isolation_public_functions', 'function_name', 'OPERATIONAL'),
('isolation_public_functions', 'reason', 'OPERATIONAL'),
('isolation_tables', 'access', 'OPERATIONAL'),
('isolation_tables', 'note', 'OPERATIONAL'),
('isolation_tables', 'owner_column', 'OPERATIONAL'),
('isolation_tables', 'read_all_reason', 'OPERATIONAL'),
('isolation_tables', 'table_name', 'OPERATIONAL'),
('knowledge_base_entries', 'action_type_pattern', 'RULE'),
('knowledge_base_entries', 'entry_text', 'PROJECT_CONTENT'),
('knowledge_base_entries', 'provider', 'RULE'),
('meaning_rules', 'action', 'RULE'),
('meaning_rules', 'description', 'RULE'),
('meaning_rules', 'name', 'RULE'),
('missions', 'attachment_urls', 'PROJECT_CONTENT'),
('missions', 'directive', 'PROJECT_CONTENT'),
('missions', 'status', 'OPERATIONAL'),
('notion_oauth_transactions', 'request_origin', 'OPERATIONAL'),
('notion_oauth_transactions', 'state', 'SECRET'),
('org_insights', 'confidence', 'OPERATIONAL'),
('org_insights', 'insight', 'PROJECT_CONTENT'),
('org_insights', 'kind', 'OPERATIONAL'),
('org_insights', 'source_agent_ids', 'OPERATIONAL'),
('outer_control_completion_checks', 'criteria', 'OPERATIONAL'),
('outer_control_completion_checks', 'outcome', 'OPERATIONAL'),
('outer_control_completion_checks', 'output_sha256', 'OPERATIONAL'),
('outer_control_completion_checks', 'summary', 'PROJECT_CONTENT'),
('outer_control_corrections', 'fingerprint', 'OPERATIONAL'),
('outer_control_corrections', 'outcome', 'OPERATIONAL'),
('outer_control_corrections', 'risk', 'OPERATIONAL'),
('outer_control_corrections', 'rule_ids', 'OPERATIONAL'),
('outer_control_corrections', 'rule_names', 'RULE'),
('outer_control_evaluations', 'action_params', 'PROJECT_CONTENT'),
('outer_control_evaluations', 'action_provider', 'OPERATIONAL'),
('outer_control_evaluations', 'action_type', 'OPERATIONAL'),
('outer_control_evaluations', 'changes', 'PROJECT_CONTENT'),
('outer_control_evaluations', 'content_hash', 'OPERATIONAL'),
('outer_control_evaluations', 'content_kind', 'OPERATIONAL'),
('outer_control_evaluations', 'corrected_params', 'PROJECT_CONTENT'),
('outer_control_evaluations', 'execution_ref', 'OPERATIONAL'),
('outer_control_evaluations', 'execution_summary', 'EXTERNAL_RESPONSE'),
('outer_control_evaluations', 'execution_url', 'EXTERNAL_RESPONSE'),
('outer_control_evaluations', 'external_id', 'OPERATIONAL'),
('outer_control_evaluations', 'input_excerpt', 'EXTERNAL_RESPONSE'),
('outer_control_evaluations', 'matches', 'PROJECT_CONTENT'),
('outer_control_evaluations', 'next_step', 'PROJECT_CONTENT'),
('outer_control_evaluations', 'output_text', 'PROJECT_CONTENT'),
('outer_control_evaluations', 'shadow_matches', 'PROJECT_CONTENT'),
('outer_control_evaluations', 'source_model', 'OPERATIONAL'),
('outer_control_evaluations', 'summary', 'PROJECT_CONTENT'),
('outer_control_evaluations', 'verdict', 'OPERATIONAL'),
('outer_control_memory', 'data', 'PROJECT_CONTENT'),
('outer_control_memory', 'kind', 'OPERATIONAL'),
('outer_control_memory', 'rule_names', 'RULE'),
('outer_control_memory', 'summary', 'PROJECT_CONTENT'),
('outer_control_session_steps', 'decision', 'PROJECT_CONTENT'),
('outer_control_session_steps', 'error', 'OPERATIONAL'),
('outer_control_session_steps', 'next_action', 'OPERATIONAL'),
('outer_control_session_steps', 'note', 'PROJECT_CONTENT'),
('outer_control_session_steps', 'reply_text', 'EXTERNAL_RESPONSE'),
('outer_control_session_steps', 'request', 'PROJECT_CONTENT'),
('outer_control_session_steps', 'tool_status', 'OPERATIONAL'),
('outer_control_session_steps', 'verdict', 'OPERATIONAL'),
('outer_control_sessions', 'completion', 'OPERATIONAL'),
('outer_control_sessions', 'condition', 'RULE'),
('outer_control_sessions', 'context', 'PROJECT_CONTENT'),
('outer_control_sessions', 'correction', 'PROJECT_CONTENT'),
('outer_control_sessions', 'depends_on', 'OPERATIONAL'),
('outer_control_sessions', 'final_artifact', 'PROJECT_CONTENT'),
('outer_control_sessions', 'final_output', 'PROJECT_CONTENT'),
('outer_control_sessions', 'handoff', 'PROJECT_CONTENT'),
('outer_control_sessions', 'handoff_mode', 'OPERATIONAL'),
('outer_control_sessions', 'history', 'PROJECT_CONTENT'),
('outer_control_sessions', 'next_input', 'PROJECT_CONTENT'),
('outer_control_sessions', 'objective', 'PROJECT_CONTENT'),
('outer_control_sessions', 'on_failure', 'OPERATIONAL'),
('outer_control_sessions', 'pending_answer', 'PROJECT_CONTENT'),
('outer_control_sessions', 'pending_kind', 'OPERATIONAL'),
('outer_control_sessions', 'pending_question', 'EXTERNAL_RESPONSE'),
('outer_control_sessions', 'request_mods', 'RULE'),
('outer_control_sessions', 'status', 'OPERATIONAL'),
('outer_control_sessions', 'stop_reason', 'OPERATIONAL'),
('outer_control_task_handoffs', 'from_label', 'OPERATIONAL'),
('outer_control_task_handoffs', 'note', 'OPERATIONAL'),
('outer_control_task_handoffs', 'outcome', 'OPERATIONAL'),
('outer_control_task_handoffs', 'rules', 'RULE'),
('outer_control_task_handoffs', 'text_sha256', 'OPERATIONAL'),
('outer_control_workflows', 'blocked_reason', 'OPERATIONAL'),
('outer_control_workflows', 'context', 'PROJECT_CONTENT'),
('outer_control_workflows', 'criteria_state', 'PROJECT_CONTENT'),
('outer_control_workflows', 'done_criteria', 'PROJECT_CONTENT'),
('outer_control_workflows', 'final_artifact', 'PROJECT_CONTENT'),
('outer_control_workflows', 'final_output', 'PROJECT_CONTENT'),
('outer_control_workflows', 'goal_pool', 'PROJECT_CONTENT'),
('outer_control_workflows', 'kind', 'OPERATIONAL'),
('outer_control_workflows', 'mode', 'OPERATIONAL'),
('outer_control_workflows', 'objective', 'PROJECT_CONTENT'),
('outer_control_workflows', 'origin', 'OPERATIONAL'),
('outer_control_workflows', 'status', 'OPERATIONAL'),
('outer_control_workflows', 'stop_reason', 'OPERATIONAL'),
('outer_control_workflows', 'summary', 'PROJECT_CONTENT'),
('pending_approval_events', 'event_type', 'OPERATIONAL'),
('pending_approval_events', 'note', 'OPERATIONAL'),
('pending_approvals', 'action_type', 'OPERATIONAL'),
('pending_approvals', 'approvals', 'OPERATIONAL'),
('pending_approvals', 'approver_role', 'OPERATIONAL'),
('pending_approvals', 'comment', 'PROJECT_CONTENT'),
('pending_approvals', 'description', 'PROJECT_CONTENT'),
('pending_approvals', 'execution_error', 'OPERATIONAL'),
('pending_approvals', 'execution_summary', 'EXTERNAL_RESPONSE'),
('pending_approvals', 'origin', 'OPERATIONAL'),
('pending_approvals', 'params', 'PROJECT_CONTENT'),
('pending_approvals', 'plan_id', 'OPERATIONAL'),
('pending_approvals', 'provider', 'OPERATIONAL'),
('pending_approvals', 'reason', 'OPERATIONAL'),
('pending_approvals', 'reason_code', 'OPERATIONAL'),
('pending_approvals', 'risk_tier', 'OPERATIONAL'),
('pending_approvals', 'status', 'OPERATIONAL'),
('platform_incidents', 'detail', 'OPERATIONAL'),
('platform_incidents', 'kind', 'OPERATIONAL'),
('platform_incidents', 'resolution_note', 'OPERATIONAL'),
('platform_incidents', 'summary', 'OPERATIONAL'),
('platform_settings', 'consequential_sweeps_paused_reason', 'OPERATIONAL'),
('platform_settings', 'kill_switch_reason', 'OPERATIONAL'),
('policy_change_requests', 'change_type', 'RULE'),
('policy_change_requests', 'description', 'RULE'),
('policy_change_requests', 'new_value', 'RULE'),
('policy_change_requests', 'status', 'OPERATIONAL'),
('policy_versions', 'notes', 'RULE'),
('policy_versions', 'snapshot', 'RULE'),
('policy_versions', 'status', 'OPERATIONAL'),
('policy_watch_observations', 'action_type', 'OPERATIONAL'),
('policy_watch_observations', 'active_outcome', 'OPERATIONAL'),
('policy_watch_observations', 'draft_outcome', 'OPERATIONAL'),
('policy_watch_observations', 'provider', 'OPERATIONAL'),
('profiles', 'control_strictness', 'RULE'),
('profiles', 'display_name', 'PERSONAL'),
('profiles', 'kill_switch_source', 'OPERATIONAL'),
('profiles', 'tier', 'OPERATIONAL'),
('profiles', 'user_context', 'PROJECT_CONTENT'),
('project_events', 'action', 'OPERATIONAL'),
('project_events', 'detail', 'OPERATIONAL'),
('project_events', 'project_name', 'PROJECT_CONTENT'),
('project_rules', 'name', 'RULE'),
('project_rules', 'pattern', 'RULE'),
('project_rules', 'severity', 'RULE'),
('project_time', 'kind', 'OPERATIONAL'),
('projects', 'html', 'PROJECT_CONTENT'),
('projects', 'prompt', 'PROJECT_CONTENT'),
('projects', 'status', 'OPERATIONAL'),
('projects', 'title', 'PROJECT_CONTENT'),
('rate_limit_windows', 'endpoint', 'OPERATIONAL'),
('safety_rule_matches', 'action_type', 'OPERATIONAL'),
('safety_rule_matches', 'provider', 'OPERATIONAL'),
('safety_rule_shadow_hits', 'action_type', 'OPERATIONAL'),
('safety_rule_shadow_hits', 'actual_decision', 'OPERATIONAL'),
('safety_rule_shadow_hits', 'provider', 'OPERATIONAL'),
('safety_rule_shadow_hits', 'would_have', 'OPERATIONAL'),
('safety_rules', 'category', 'RULE'),
('safety_rules', 'name', 'RULE'),
('safety_rules', 'pattern', 'RULE'),
('safety_rules', 'rationale', 'RULE'),
('safety_rules', 'severity', 'RULE'),
('scenario_simulations', 'question', 'PROJECT_CONTENT'),
('scenario_simulations', 'response', 'PROJECT_CONTENT'),
('scheduled_job_requests', 'job_name', 'OPERATIONAL'),
('secret_events', 'detail', 'OPERATIONAL'),
('secret_events', 'kind', 'OPERATIONAL'),
('secret_events', 'outcome', 'OPERATIONAL'),
('secret_events', 'provider', 'OPERATIONAL'),
('shared_websites', 'html', 'PROJECT_CONTENT'),
('shared_websites', 'title', 'PROJECT_CONTENT'),
('shopify_oauth_transactions', 'request_origin', 'OPERATIONAL'),
('shopify_oauth_transactions', 'shop_domain', 'PROJECT_CONTENT'),
('shopify_oauth_transactions', 'state', 'SECRET'),
('slack_oauth_transactions', 'request_origin', 'OPERATIONAL'),
('slack_oauth_transactions', 'scope_groups', 'OPERATIONAL'),
('slack_oauth_transactions', 'state', 'SECRET'),
('suppressed_emails', 'email', 'PERSONAL'),
('suppressed_emails', 'metadata', 'OPERATIONAL'),
('suppressed_emails', 'reason', 'OPERATIONAL'),
('user_roles', 'role', 'OPERATIONAL'),
('webhook_deliveries', 'error', 'OPERATIONAL'),
('webhook_deliveries', 'event', 'OPERATIONAL'),
('webhook_deliveries', 'payload', 'PROJECT_CONTENT'),
('webhooks', 'events', 'OPERATIONAL'),
('webhooks', 'previous_secret', 'SECRET'),
('webhooks', 'secret', 'SECRET'),
('webhooks', 'url', 'PROJECT_CONTENT'),
('website_form_submissions', 'fields', 'PERSONAL'),
('website_form_submissions', 'page_slug', 'OPERATIONAL'),
('website_form_submissions', 'section_kind', 'OPERATIONAL'),
('website_form_submissions', 'submitter_ip', 'PERSONAL'),
('website_pages', 'sections', 'PROJECT_CONTENT'),
('website_pages', 'seo_description', 'PROJECT_CONTENT'),
('website_pages', 'slug', 'PROJECT_CONTENT'),
('website_pages', 'title', 'PROJECT_CONTENT'),
('website_versions', 'label', 'PROJECT_CONTENT'),
('website_versions', 'pages_snapshot', 'PROJECT_CONTENT'),
('website_versions', 'website_snapshot', 'PROJECT_CONTENT'),
('websites', 'custom_domain', 'PROJECT_CONTENT'),
('websites', 'generation_notes', 'OPERATIONAL'),
('websites', 'generation_stage', 'OPERATIONAL'),
('websites', 'html', 'PROJECT_CONTENT'),
('websites', 'images_status', 'OPERATIONAL'),
('websites', 'name', 'PROJECT_CONTENT'),
('websites', 'prompt', 'PROJECT_CONTENT'),
('websites', 'structure_template', 'OPERATIONAL'),
('websites', 'subdomain', 'PROJECT_CONTENT'),
('websites', 'tagline', 'PROJECT_CONTENT'),
('websites', 'theme', 'PROJECT_CONTENT'),
('websites', 'title', 'PROJECT_CONTENT')
ON CONFLICT (table_name, column_name) DO UPDATE SET class = EXCLUDED.class;

DO 514
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['canva_oauth_transactions', 'figma_oauth_transactions', 'gmail_oauth_transactions', 'notion_oauth_transactions',
                           'shopify_oauth_transactions', 'slack_oauth_transactions'] LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END 514;

-- The columns that must have a class: text, JSON, array, binary and other non-scalar columns of public tables, except the "_enc"
-- twins (they hold the ciphertext of a classified column).
CREATE OR REPLACE FUNCTION public.classifiable_columns()
RETURNS TABLE (table_name text, column_name text, data_type text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $
  SELECT c.table_name::text, c.column_name::text, c.data_type::text
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
   WHERE c.table_schema = 'public'
     AND c.data_type IN ('text', 'jsonb', 'json', 'character varying', 'ARRAY', 'bytea', 'USER-DEFINED')
     AND c.column_name NOT LIKE '%\_enc'
$;
REVOKE ALL ON FUNCTION public.classifiable_columns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.classifiable_columns() TO service_role;

CREATE OR REPLACE FUNCTION public.classification_report()
RETURNS TABLE (problem text, table_name text, column_name text, detail text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $
  -- a column that holds content but has no class
  SELECT 'unclassified', l.table_name, l.column_name, l.data_type
    FROM public.classifiable_columns() l
   WHERE NOT EXISTS (SELECT 1 FROM public.data_classification d WHERE d.table_name = l.table_name AND d.column_name = l.column_name)
  UNION ALL
  -- a class for a column that no longer exists
  SELECT 'stale', d.table_name, d.column_name, d.class
    FROM public.data_classification d
   WHERE NOT EXISTS (SELECT 1 FROM public.classifiable_columns() l WHERE l.table_name = d.table_name AND l.column_name = d.column_name)
  UNION ALL
  -- a secret a browser session could read: the role may select the column and a policy (or no row-level security) lets rows through
  SELECT 'secret_readable', d.table_name, d.column_name, r.role
    FROM public.data_classification d
    JOIN pg_class k ON k.oid = to_regclass('public.' || quote_ident(d.table_name))
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
   WHERE d.class = 'SECRET'
     AND CASE WHEN EXISTS (SELECT 1 FROM public.classifiable_columns() l WHERE l.table_name = d.table_name AND l.column_name = d.column_name)
              THEN has_column_privilege(r.role, k.oid, d.column_name, 'SELECT') ELSE false END
     AND (NOT k.relrowsecurity OR EXISTS (
           SELECT 1 FROM pg_policies p
            WHERE p.schemaname = 'public' AND p.tablename = d.table_name AND p.cmd IN ('SELECT', 'ALL')
              AND (r.role::name = ANY (p.roles) OR 'public'::name = ANY (p.roles))))
  UNION ALL
  -- a credential stored where it should not be (the secrets handling check)
  SELECT 'secret_exposed', NULL, NULL, to_jsonb(s)::text FROM public.secrets_exposure_report() s
  UNION ALL
  -- an encrypted column whose class says it holds no content
  SELECT 'class_conflict', e.table_name, e.column_name, 'encrypted but classified ' || d.class
    FROM public.encrypted_columns e
    JOIN public.data_classification d ON d.table_name = e.table_name AND d.column_name = e.column_name
   WHERE d.class NOT IN ('PROJECT_CONTENT', 'EXTERNAL_RESPONSE', 'PERSONAL')
$;
REVOKE ALL ON FUNCTION public.classification_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.classification_report() TO service_role;

-- Content columns that are neither encrypted nor exempt with a reason: the at-rest work list (task 3), not a failure.
CREATE OR REPLACE FUNCTION public.classification_gaps()
RETURNS TABLE (table_name text, column_name text, class text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $
  SELECT d.table_name, d.column_name, d.class
    FROM public.data_classification d
   WHERE d.class IN ('PROJECT_CONTENT', 'EXTERNAL_RESPONSE', 'PERSONAL')
     AND NOT EXISTS (SELECT 1 FROM public.encrypted_columns e WHERE e.table_name = d.table_name AND e.column_name = d.column_name)
     AND NOT EXISTS (SELECT 1 FROM public.encryption_exempt_columns x WHERE x.table_name = d.table_name AND x.column_name = d.column_name)
   ORDER BY 1, 2
$;
REVOKE ALL ON FUNCTION public.classification_gaps() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.classification_gaps() TO service_role;

CREATE OR REPLACE FUNCTION public.data_classification_weekly_check()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $
DECLARE problems jsonb; gaps bigint; open_id uuid; result jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]') INTO problems FROM public.classification_report() r;
  SELECT count(*) INTO gaps FROM public.classification_gaps();
  result := jsonb_build_object('problems', problems, 'content_gaps', gaps, 'checked_at', now());
  SELECT id INTO open_id FROM public.platform_incidents WHERE kind = 'data_classification' AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1;
  IF jsonb_array_length(problems) > 0 THEN
    IF open_id IS NULL THEN
      INSERT INTO public.platform_incidents (kind, summary, detail) VALUES ('data_classification',
        format('Data classification check: %s problem(s). A new column needs a class (data-classes.ts and a data_classification row), '
          || 'a removed column its row deleted, and a readable or exposed secret is fixed at once (docs/data-classification.md).',
          jsonb_array_length(problems)), result);
    ELSE
      UPDATE public.platform_incidents SET detail = result WHERE id = open_id;
    END IF;
  ELSIF open_id IS NOT NULL THEN
    UPDATE public.platform_incidents SET resolved_at = now(), resolution_note = 'Every content column classified, no secret readable or exposed.' WHERE id = open_id;
  END IF;
  RETURN result;
END $;
REVOKE ALL ON FUNCTION public.data_classification_weekly_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_classification_weekly_check() TO service_role;

DO 514
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;
  PERFORM cron.schedule('data-classification-weekly-check', '47 3 * * 1', 'SELECT public.data_classification_weekly_check()');
END 514;
