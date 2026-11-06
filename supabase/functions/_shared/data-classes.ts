// General data security, task 1: the data classification baseline.
//
// Every text, JSON, array or vector column of every table in the public schema has exactly one class, and each class has fixed
// handling rules (CLASS_POLICY). The same register is in the database (data_classification, seeded by
// 20261108010000_data_classification.sql): classification_report() checks the live schema against it, the weekly check opens a
// platform incident on any problem, and src/test/data-classification.test.ts fails the build when the code and the migration
// disagree or a migration adds a column without a class. Columns of other types (ids, numbers, times, flags) carry no content.
// See docs/data-classification.md.
//
// Pure data, no imports: read by edge functions (the outbound guard, task 2) and by the website build checks.

export type DataClass = "SECRET" | "RULE" | "PROJECT_CONTENT" | "EXTERNAL_RESPONSE" | "PERSONAL" | "OPERATIONAL";

export const DATA_CLASSES: readonly DataClass[] = ["SECRET", "RULE", "PROJECT_CONTENT", "EXTERNAL_RESPONSE", "PERSONAL", "OPERATIONAL"];

export type ClassPolicy = {
  /** What the class is. */
  covers: string;
  /** How it must be stored. */
  storage: string;
  /** Whether a browser session may read it (its own account's rows only, through row-level security). */
  browserRead: boolean;
  /** Where it may be sent outside NazAI. */
  mayLeave: "never" | "auth_header_of_its_own_service" | "own_tools_after_rule_masking" | "rule_instruction_to_own_tools" | "controlled_result_only" | "the_action_that_needs_it";
  /** How it may appear in a model prompt. */
  inPrompt: "never" | "as_task_input" | "as_instruction_to_nazai_models" | "fenced_untrusted_data" | "only_when_the_task_needs_it" | "nazai_diagnostics_only";
  /** What of it may reach a log line. */
  inLogs: "never" | "ids_sizes_hashes" | "names_and_ids" | "scrubbed_text";
};

export const CLASS_POLICY: Record<DataClass, ClassPolicy> = {
  SECRET: {
    covers: "credentials and what verifies them: provider tokens, API key hashes, webhook and callback signing secrets, OAuth state and code verifiers, unsubscribe tokens",
    storage: "the credential itself only in the vault; a column holds a vault reference, a one-way hash, or a short-lived single-use value, and is emptied when moved to the vault",
    browserRead: false,
    mayLeave: "auth_header_of_its_own_service",
    inPrompt: "never",
    inLogs: "never",
  },
  RULE: {
    covers: "safety rules, hard rules, project rules, meaning rules, response rules, action policies and policy versions",
    storage: "readable to the database (the gate matches actions against it), isolated per account (isolation_tables)",
    browserRead: true,
    mayLeave: "rule_instruction_to_own_tools",
    inPrompt: "as_instruction_to_nazai_models",
    inLogs: "names_and_ids",
  },
  PROJECT_CONTENT: {
    covers: "what an account creates or gives NazAI: prompts, objectives, sites and pages, projects, agents, missions, results and controlled outputs",
    storage: "isolated per account; encrypted where listed in encrypted_columns, otherwise exempt with a recorded reason (by design, or deferred until its readers move to the server); a column with neither is a problem the weekly check reports",
    browserRead: true,
    mayLeave: "own_tools_after_rule_masking",
    inPrompt: "as_task_input",
    inLogs: "ids_sizes_hashes",
  },
  EXTERNAL_RESPONSE: {
    covers: "what came from outside NazAI: replies of connected tools and MCP servers, synced integration data, research pages, messages from a customer's own users",
    storage: "isolated per account, secrets scrubbed before it is stored; encrypted where listed in encrypted_columns, otherwise exempt with a recorded reason",
    browserRead: true,
    mayLeave: "controlled_result_only",
    inPrompt: "fenced_untrusted_data",
    inLogs: "ids_sizes_hashes",
  },
  PERSONAL: {
    covers: "contact data of people: email addresses, names, IP addresses, what a site visitor submits in a form",
    storage: "isolated per account; encrypted where listed in encrypted_columns, otherwise exempt with a recorded reason",
    browserRead: true,
    mayLeave: "the_action_that_needs_it",
    inPrompt: "only_when_the_task_needs_it",
    inLogs: "never",
  },
  OPERATIONAL: {
    covers: "statuses, kinds, names of actions and providers, ids, fingerprints and signatures, scrubbed error text, metrics, configuration and NazAI's own bookkeeping",
    storage: "readable to the database; error text scrubbed of secrets by the redact triggers",
    browserRead: true,
    mayLeave: "never",
    inPrompt: "nazai_diagnostics_only",
    inLogs: "scrubbed_text",
  },
};

/** The classes that hold content: they must be encrypted or exempt with a reason (task 3 closes the gaps). */
export const CONTENT_CLASSES: readonly DataClass[] = ["PROJECT_CONTENT", "EXTERNAL_RESPONSE", "PERSONAL"];

const S = "SECRET", R = "RULE", P = "PROJECT_CONTENT", X = "EXTERNAL_RESPONSE", U = "PERSONAL", O = "OPERATIONAL";

/** Every classified column, by table. Keep in step with the seed in the data_classification migrations (checked by the build). */
export const DATA_CLASSIFICATION: Record<string, Record<string, DataClass>> = {
  account_members: { email: U, role: O, status: O, permissions: O },
  action_reversals: { provider: O, tool: O, undo_kind: O, undo_effect: O, irreversible_reason: O, ref: O, undo_payload: X, status: O, summary: O, error: O },
  agent_artifacts: { kind: O, title: P, url: P, ref: O, provider: O, account_email: U },
  agent_clients: { name: U, email: U, company: U, tags: P, notes: P },
  agent_decisions: {
    decision: O, reasoning: P, alternatives_considered: P, source: O, human_response: P, signature: O, gate_trace: O, action_type: O,
    provider: O, params: P, description: P, signing_key_id: O, precedent_citations: O, plan_id: O, human_response_signature: O,
    deferred_detail: O, modified_params: P,
  },
  agent_events: { kind: O, payload: P, reasoning: P, confidence: O, payload_ref: O, payload_original_event_id: O },
  agent_integrations: { provider: O, credentials: S, metadata: X, status: O, last_error: O },
  agent_memory: { key: P, value: P, source: O },
  agent_reports: { title: P, kind: O, body_markdown: P },
  agent_runs: { trigger: O, status: O, summary: P, instruction: P, outcome: P },
  agent_strictness_overrides: { strictness: R },
  agents: {
    name: P, slug: P, goal: P, manifest: P, status: O, source_plan: P, role: P, schedule_cron: O, schedule_label: O, autonomy: R,
    client_write_mode: R, kill_switch_source: O, generation_notes: O,
  },
  api_key_action_policies: { action_type_pattern: R, on_uncertain: R },
  api_key_context_entries: { entry_text: P, embedding: P },
  api_key_response_rules: { trigger_phrase: R, match_type: R, answer_text: R },
  api_key_shadow_observations: { action_type: O, provider: O, shadow_resolution: O },
  api_keys: {
    name: P, key_prefix: O, key_hash: S, scopes: R, on_uncertain: R, callback_url: P, callback_secret: S, callback_fallback: R,
    shadow_on_uncertain: R, on_gate_error: R, quiet_hours_timezone: R, on_uncertain_downgrade_reason: O, response_persona: P,
    fallback_message: P, on_uncertain_downgrade_kind: O,
  },
  api_response_cache: { message_hash: O, message: X, embedding: X, answer: P, sources: X, confidence: O },
  api_response_generations: { message: X },
  audit_integrity_runs: { triggered_by: O },
  automation_readiness_signal_state: { signal: O },
  boundary_references: { table_name: O, column_name: O, ref_table: O, note: O },
  business_profiles: {
    source_url: P, company_name: P, one_liner: P, industry: P, tone: P, audience: P, offers: P, channels: P, inferred_kpis: P, raw_research: X,
  },
  canva_oauth_transactions: { state: S, code_verifier: S, scope_groups: O, request_origin: O },
  circuit_breakers: { action_type: O, recent_outcomes: O, last_reason: O },
  confidence_calibration: { bucket_label: O, severity: O, note: O },
  config_changes: { table_name: O, action: O, before: R, after: R },
  content_gap_clusters: { representative_message: X, embedding: X },
  control_test_runs: { triggered_by: O, summary: O, scenario_status: O, regressions: O },
  credit_transactions: { type: O, description: O, status: O, metadata: O },
  critical_alerts: { event: O, summary: O, action_type: O, provider: O, actor: O, delivered_via: O },
  cross_account_precedent_stats: { action_type: O, provider: O },
  data_classification: { table_name: O, column_name: O, class: O, note: O },
  data_deletion_requests: { status: O },
  decision_embeddings: { action_type: O, provider: O, embedding: P },
  decision_outcomes: { provider: O, linked_metric: O, direction: O, evidence: X },
  email_send_log: { message_id: O, template_name: O, recipient_email: U, status: O, error_message: O, metadata: O },
  email_unsubscribe_tokens: { token: S, email: U },
  encrypted_columns: { table_name: O, column_name: O, plain_empty: O, note: O },
  encryption_exempt_columns: { table_name: O, column_name: O, reason: O, kind: O },
  external_tools: { name: P, endpoint_url: P, request_format: O, model: O, auth_header: O, auth_scheme: O, last_error: O },
  figma_oauth_transactions: { state: S },
  generation_cache: { kind: O, cache_key: O, manifest: P },
  generation_canary_runs: { mode: O, checks: O },
  generation_progress: { stage: O, checks: O },
  gmail_oauth_transactions: { state: S },
  hard_rule_shadow_hits: { action_type: O, provider: O, would_have: O, actual_decision: O },
  hard_rules: { rule_text: R, action_type_pattern: R, effect: R, provider: R, rationale: R },
  idempotency_keys: { idempotency_key: O, response: P },
  imported_projects: {
    name: P, source_mode: O, source_kind: O, source_ref: P, source_label: P, content_type: O, content: P, files: P, content_sha256: O,
    last_check: O, sync_error: O,
  },
  incidents: { kind: O, status: O, summary: O, action_type: O, provider: O, resolution_note: O, root_cause_category: O },
  integration_issues: {
    provider: O, tool_kind: O, error_type: O, issue_key: O, title: O, human_message: O, fix_action: O, scope_hint: O, technical: O,
    status: O, resolution: O,
  },
  integration_snapshots: { provider: O, kind: O, data: X, error: O },
  ip_rate_limit_windows: { ip: U, endpoint: O },
  isolation_public_functions: { function_name: O, reason: O },
  isolation_tables: { table_name: O, access: O, owner_column: O, read_all_reason: O, note: O },
  knowledge_base_entries: { entry_text: P, action_type_pattern: R, provider: R },
  meaning_rules: { name: R, description: R, action: R },
  missions: { directive: P, attachment_urls: P, status: O },
  notion_oauth_transactions: { state: S, request_origin: O },
  org_insights: { insight: P, kind: O, confidence: O, source_agent_ids: O },
  outer_control_completion_checks: { outcome: O, criteria: O, summary: P, output_sha256: O },
  outer_control_corrections: { outcome: O, rule_ids: O, rule_names: R, risk: O, fingerprint: O },
  outer_control_evaluations: {
    source_model: O, content_kind: O, input_excerpt: X, output_text: P, verdict: O, matches: P, summary: P, action_type: O,
    action_provider: O, action_params: P, execution_summary: X, execution_ref: O, execution_url: X, corrected_params: P, changes: P,
    next_step: P, shadow_matches: P, external_id: O, content_hash: O,
  },
  outer_control_memory: { kind: O, rule_names: R, summary: P, data: P },
  outer_control_session_steps: { request: P, reply_text: X, tool_status: O, error: O, verdict: O, next_action: O, note: P, decision: P },
  outer_control_sessions: {
    objective: P, context: P, status: O, correction: P, history: P, next_input: P, final_output: P, stop_reason: O, pending_kind: O,
    pending_question: X, pending_answer: P, depends_on: O, on_failure: O, handoff: P, condition: R, request_mods: R, completion: O,
    final_artifact: P, handoff_mode: O,
  },
  outer_control_task_handoffs: { from_label: O, outcome: O, rules: R, text_sha256: O, note: O },
  outer_control_workflows: {
    objective: P, context: P, status: O, summary: P, kind: O, origin: O, final_output: P, stop_reason: O, final_artifact: P, mode: O,
    goal_pool: P, done_criteria: P, criteria_state: P, blocked_reason: O,
  },
  pending_approval_events: { event_type: O, note: O },
  pending_approvals: {
    action_type: O, provider: O, description: P, params: P, reason: O, risk_tier: O, origin: O, approver_role: O, approvals: O,
    status: O, comment: P, reason_code: O, plan_id: O, execution_summary: X, execution_error: O,
  },
  platform_incidents: { kind: O, summary: O, detail: O, resolution_note: O },
  platform_settings: { kill_switch_reason: O, consequential_sweeps_paused_reason: O },
  policy_change_requests: { change_type: R, description: R, status: O, new_value: R },
  policy_versions: { snapshot: R, status: O, notes: R },
  policy_watch_observations: { action_type: O, provider: O, active_outcome: O, draft_outcome: O },
  profiles: { display_name: U, user_context: P, kill_switch_source: O, control_strictness: R, tier: O },
  project_events: { project_name: P, action: O, detail: O },
  project_rules: { name: R, pattern: R, severity: R },
  project_time: { kind: O },
  projects: { title: P, html: P, prompt: P, status: O },
  rate_limit_windows: { endpoint: O },
  safety_rule_matches: { action_type: O, provider: O },
  safety_rule_shadow_hits: { action_type: O, provider: O, would_have: O, actual_decision: O },
  safety_rules: { name: R, category: R, pattern: R, severity: R, rationale: R },
  scenario_simulations: { question: P, response: P },
  scheduled_job_requests: { job_name: O },
  secret_events: { kind: O, provider: O, outcome: O, detail: O },
  secret_storage_rules: { table_name: O, column_name: O, rule: O, note: O },
  shared_websites: { html: P, title: P },
  shopify_oauth_transactions: { state: S, shop_domain: P, request_origin: O },
  slack_oauth_transactions: { state: S, scope_groups: O, request_origin: O },
  suppressed_emails: { email: U, reason: O, metadata: O },
  user_roles: { role: O },
  vault_secret_owners: { first_table: O },
  webhook_deliveries: { event: O, error: O, payload: P },
  webhooks: { url: P, secret: S, events: O, previous_secret: S },
  website_form_submissions: { page_slug: O, section_kind: O, fields: U, submitter_ip: U },
  website_pages: { slug: P, title: P, seo_description: P, sections: P },
  website_versions: { label: P, website_snapshot: P, pages_snapshot: P },
  websites: {
    title: P, html: P, prompt: P, name: P, tagline: P, theme: P, subdomain: P, custom_domain: P, generation_notes: O, images_status: O,
    structure_template: O, generation_stage: O,
  },
};

/** The class of a column, or null when it is not classified. */
export function classOf(table: string, column: string): DataClass | null {
  return DATA_CLASSIFICATION[table]?.[column] ?? null;
}

/** Every classified column as [table, column, class], sorted. */
export function classifiedColumns(): [string, string, DataClass][] {
  return Object.entries(DATA_CLASSIFICATION)
    .flatMap(([t, cols]) => Object.entries(cols).map(([c, k]) => [t, c, k] as [string, string, DataClass]))
    .sort((a, b) => (a[0] + "." + a[1]).localeCompare(b[0] + "." + b[1]));
}
