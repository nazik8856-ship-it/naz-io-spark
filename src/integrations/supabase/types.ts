export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_members: {
        Row: {
          accepted_at: string | null
          account_owner_id: string
          created_at: string
          email: string
          id: string
          invite_token: string
          invited_at: string
          invited_by: string
          member_id: string | null
          ooo_fallback_member_id: string | null
          ooo_until: string | null
          permissions: string[] | null
          role: string
          status: string
        }
        Insert: {
          accepted_at?: string | null
          account_owner_id: string
          created_at?: string
          email: string
          id?: string
          invite_token?: string
          invited_at?: string
          invited_by: string
          member_id?: string | null
          ooo_fallback_member_id?: string | null
          ooo_until?: string | null
          permissions?: string[] | null
          role: string
          status?: string
        }
        Update: {
          accepted_at?: string | null
          account_owner_id?: string
          created_at?: string
          email?: string
          id?: string
          invite_token?: string
          invited_at?: string
          invited_by?: string
          member_id?: string | null
          ooo_fallback_member_id?: string | null
          ooo_until?: string | null
          permissions?: string[] | null
          role?: string
          status?: string
        }
        Relationships: []
      }
      action_reversals: {
        Row: {
          agent_id: string | null
          created_at: string
          decision_id: string | null
          error: string | null
          executed_at: string | null
          id: string
          irreversible_reason: string | null
          provider: string | null
          ref: string | null
          reversible: boolean
          run_id: string | null
          status: string
          summary: string | null
          tool: string
          undo_effect: string | null
          undo_kind: string
          undo_payload: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          decision_id?: string | null
          error?: string | null
          executed_at?: string | null
          id?: string
          irreversible_reason?: string | null
          provider?: string | null
          ref?: string | null
          reversible?: boolean
          run_id?: string | null
          status?: string
          summary?: string | null
          tool: string
          undo_effect?: string | null
          undo_kind?: string
          undo_payload?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          decision_id?: string | null
          error?: string | null
          executed_at?: string | null
          id?: string
          irreversible_reason?: string | null
          provider?: string | null
          ref?: string | null
          reversible?: boolean
          run_id?: string | null
          status?: string
          summary?: string | null
          tool?: string
          undo_effect?: string | null
          undo_kind?: string
          undo_payload?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_reversals_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_reversals_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "agent_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_reversals_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_artifacts: {
        Row: {
          account_email: string | null
          agent_id: string | null
          created_at: string
          id: string
          kind: string
          provider: string | null
          ref: Json
          run_id: string | null
          title: string | null
          url: string | null
          user_id: string
        }
        Insert: {
          account_email?: string | null
          agent_id?: string | null
          created_at?: string
          id?: string
          kind: string
          provider?: string | null
          ref?: Json
          run_id?: string | null
          title?: string | null
          url?: string | null
          user_id: string
        }
        Update: {
          account_email?: string | null
          agent_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          provider?: string | null
          ref?: Json
          run_id?: string | null
          title?: string | null
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_artifacts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_artifacts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_clients: {
        Row: {
          agent_id: string
          company: string | null
          created_at: string
          email: string | null
          first_seen_at: string
          id: string
          interaction_count: number
          last_interaction_at: string
          name: string | null
          notes: string | null
          tags: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id: string
          company?: string | null
          created_at?: string
          email?: string | null
          first_seen_at?: string
          id?: string
          interaction_count?: number
          last_interaction_at?: string
          name?: string | null
          notes?: string | null
          tags?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          company?: string | null
          created_at?: string
          email?: string | null
          first_seen_at?: string
          id?: string
          interaction_count?: number
          last_interaction_at?: string
          name?: string | null
          notes?: string | null
          tags?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_clients_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_decisions: {
        Row: {
          action_type: string | null
          agent_id: string | null
          agent_run_id: string | null
          alternatives_considered: Json
          api_key_id: string | null
          confidence_score: number
          created_at: string
          decision: string
          description: string | null
          embedding_backfill_checked_at: string | null
          escalated: boolean
          gate_duration_ms: number | null
          gate_trace: Json | null
          hard_rule_id: string | null
          human_response: string | null
          id: string
          is_test: boolean
          org_id: string | null
          overridden_at: string | null
          override_of: string | null
          params: Json | null
          plan_id: string | null
          policy_version: number | null
          precedent_citations: Json | null
          provider: string | null
          reasoning: string
          signature: string | null
          signing_key_id: string | null
          source: string
          step_index: number | null
          user_id: string
        }
        Insert: {
          action_type?: string | null
          agent_id?: string | null
          agent_run_id?: string | null
          alternatives_considered?: Json
          api_key_id?: string | null
          confidence_score?: number
          created_at?: string
          decision: string
          description?: string | null
          embedding_backfill_checked_at?: string | null
          escalated?: boolean
          gate_duration_ms?: number | null
          gate_trace?: Json | null
          hard_rule_id?: string | null
          human_response?: string | null
          id?: string
          is_test?: boolean
          org_id?: string | null
          overridden_at?: string | null
          override_of?: string | null
          params?: Json | null
          plan_id?: string | null
          policy_version?: number | null
          precedent_citations?: Json | null
          provider?: string | null
          reasoning?: string
          signature?: string | null
          signing_key_id?: string | null
          source?: string
          step_index?: number | null
          user_id: string
        }
        Update: {
          action_type?: string | null
          agent_id?: string | null
          agent_run_id?: string | null
          alternatives_considered?: Json
          api_key_id?: string | null
          confidence_score?: number
          created_at?: string
          decision?: string
          description?: string | null
          embedding_backfill_checked_at?: string | null
          escalated?: boolean
          gate_duration_ms?: number | null
          gate_trace?: Json | null
          hard_rule_id?: string | null
          human_response?: string | null
          id?: string
          is_test?: boolean
          org_id?: string | null
          overridden_at?: string | null
          override_of?: string | null
          params?: Json | null
          plan_id?: string | null
          policy_version?: number | null
          precedent_citations?: Json | null
          provider?: string | null
          reasoning?: string
          signature?: string | null
          signing_key_id?: string | null
          source?: string
          step_index?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_decisions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_decisions_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_decisions_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_decisions_hard_rule_id_fkey"
            columns: ["hard_rule_id"]
            isOneToOne: false
            referencedRelation: "hard_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_decisions_override_of_fkey"
            columns: ["override_of"]
            isOneToOne: false
            referencedRelation: "agent_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_events: {
        Row: {
          agent_id: string
          confidence: string | null
          created_at: string
          id: string
          kind: string
          payload: Json
          reasoning: string | null
          resolved_at: string | null
          run_id: string
          user_id: string
        }
        Insert: {
          agent_id: string
          confidence?: string | null
          created_at?: string
          id?: string
          kind: string
          payload?: Json
          reasoning?: string | null
          resolved_at?: string | null
          run_id: string
          user_id: string
        }
        Update: {
          agent_id?: string
          confidence?: string | null
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
          reasoning?: string | null
          resolved_at?: string | null
          run_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_events_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_integrations: {
        Row: {
          agent_id: string | null
          created_at: string
          credentials: Json
          credentials_secret_id: string | null
          id: string
          last_error: string | null
          last_verified_at: string | null
          metadata: Json
          provider: string
          revoked_alerted_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          credentials?: Json
          credentials_secret_id?: string | null
          id?: string
          last_error?: string | null
          last_verified_at?: string | null
          metadata?: Json
          provider: string
          revoked_alerted_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          credentials?: Json
          credentials_secret_id?: string | null
          id?: string
          last_error?: string | null
          last_verified_at?: string | null
          metadata?: Json
          provider?: string
          revoked_alerted_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      agent_memory: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          key: string
          source: string
          user_id: string
          value: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          key: string
          source?: string
          user_id: string
          value: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          key?: string
          source?: string
          user_id?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_memory_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_reports: {
        Row: {
          agent_id: string
          body_markdown: string
          created_at: string
          id: string
          kind: string
          run_id: string | null
          title: string
          user_id: string
        }
        Insert: {
          agent_id: string
          body_markdown: string
          created_at?: string
          id?: string
          kind: string
          run_id?: string | null
          title: string
          user_id: string
        }
        Update: {
          agent_id?: string
          body_markdown?: string
          created_at?: string
          id?: string
          kind?: string
          run_id?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_reports_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_reports_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          agent_id: string
          finished_at: string | null
          id: string
          instruction: string | null
          outcome: string | null
          scheduled_for: string | null
          started_at: string
          status: string
          summary: string | null
          trigger: string
          user_id: string
        }
        Insert: {
          agent_id: string
          finished_at?: string | null
          id?: string
          instruction?: string | null
          outcome?: string | null
          scheduled_for?: string | null
          started_at?: string
          status?: string
          summary?: string | null
          trigger?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          finished_at?: string | null
          id?: string
          instruction?: string | null
          outcome?: string | null
          scheduled_for?: string | null
          started_at?: string
          status?: string
          summary?: string | null
          trigger?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_strictness_overrides: {
        Row: {
          agent_id: string
          created_at: string
          strictness: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          strictness: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          strictness?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_strictness_overrides_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          auto_approve_low_risk: boolean
          autonomy: string
          business_profile_id: string | null
          client_write_mode: string
          confidence_threshold: number
          created_at: string
          daily_action_cap: number
          daily_run_cap: number
          goal: string | null
          id: string
          kill_switch: boolean
          kill_switch_at: string | null
          kill_switch_auto: boolean
          kill_switch_source: string | null
          manifest: Json
          name: string
          next_run_at: string | null
          role: string | null
          schedule_cron: string | null
          schedule_label: string | null
          slug: string
          source_plan: string | null
          status: string
          updated_at: string
          user_id: string
          webhook_secret_id: string | null
        }
        Insert: {
          auto_approve_low_risk?: boolean
          autonomy?: string
          business_profile_id?: string | null
          client_write_mode?: string
          confidence_threshold?: number
          created_at?: string
          daily_action_cap?: number
          daily_run_cap?: number
          goal?: string | null
          id?: string
          kill_switch?: boolean
          kill_switch_at?: string | null
          kill_switch_auto?: boolean
          kill_switch_source?: string | null
          manifest: Json
          name: string
          next_run_at?: string | null
          role?: string | null
          schedule_cron?: string | null
          schedule_label?: string | null
          slug: string
          source_plan?: string | null
          status?: string
          updated_at?: string
          user_id: string
          webhook_secret_id?: string | null
        }
        Update: {
          auto_approve_low_risk?: boolean
          autonomy?: string
          business_profile_id?: string | null
          client_write_mode?: string
          confidence_threshold?: number
          created_at?: string
          daily_action_cap?: number
          daily_run_cap?: number
          goal?: string | null
          id?: string
          kill_switch?: boolean
          kill_switch_at?: string | null
          kill_switch_auto?: boolean
          kill_switch_source?: string | null
          manifest?: Json
          name?: string
          next_run_at?: string | null
          role?: string | null
          schedule_cron?: string | null
          schedule_label?: string | null
          slug?: string
          source_plan?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          webhook_secret_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agents_business_profile_id_fkey"
            columns: ["business_profile_id"]
            isOneToOne: false
            referencedRelation: "business_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_spend_caps: {
        Row: {
          agent_id: string | null
          api_key_id: string | null
          created_at: string
          daily_cap_usd: number
          enabled: boolean
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          api_key_id?: string | null
          created_at?: string
          daily_cap_usd?: number
          enabled?: boolean
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string | null
          api_key_id?: string | null
          created_at?: string
          daily_cap_usd?: number
          enabled?: boolean
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_spend_caps_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_spend_caps_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_spend_daily: {
        Row: {
          agent_id: string | null
          api_key_id: string | null
          calls: number
          capped_at: string | null
          completion_tokens: number
          cost_usd: number
          created_at: string
          day: string
          id: string
          prompt_tokens: number
          updated_at: string
          user_id: string
          warned_at: string | null
        }
        Insert: {
          agent_id?: string | null
          api_key_id?: string | null
          calls?: number
          capped_at?: string | null
          completion_tokens?: number
          cost_usd?: number
          created_at?: string
          day?: string
          id?: string
          prompt_tokens?: number
          updated_at?: string
          user_id: string
          warned_at?: string | null
        }
        Update: {
          agent_id?: string | null
          api_key_id?: string | null
          calls?: number
          capped_at?: string | null
          completion_tokens?: number
          cost_usd?: number
          created_at?: string
          day?: string
          id?: string
          prompt_tokens?: number
          updated_at?: string
          user_id?: string
          warned_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_spend_daily_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_spend_daily_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      api_key_action_policies: {
        Row: {
          action_type_pattern: string
          api_key_id: string
          confidence_threshold: number | null
          created_at: string
          id: string
          on_uncertain: string
          user_id: string
        }
        Insert: {
          action_type_pattern: string
          api_key_id: string
          confidence_threshold?: number | null
          created_at?: string
          id?: string
          on_uncertain: string
          user_id: string
        }
        Update: {
          action_type_pattern?: string
          api_key_id?: string
          confidence_threshold?: number | null
          created_at?: string
          id?: string
          on_uncertain?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_key_action_policies_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      api_key_shadow_observations: {
        Row: {
          action_type: string
          api_key_id: string
          approval_id: string
          created_at: string
          id: string
          provider: string | null
          shadow_resolution: string
          user_id: string
        }
        Insert: {
          action_type: string
          api_key_id: string
          approval_id: string
          created_at?: string
          id?: string
          provider?: string | null
          shadow_resolution: string
          user_id: string
        }
        Update: {
          action_type?: string
          api_key_id?: string
          approval_id?: string
          created_at?: string
          id?: string
          provider?: string | null
          shadow_resolution?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_key_shadow_observations_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_key_shadow_observations_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "pending_approvals"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          abuse_alerted_at: string | null
          callback_failure_streak: number
          callback_fallback: string
          callback_secret: string | null
          callback_timeout_seconds: number
          callback_url: string | null
          created_at: string
          embedding_pipeline_alerted_at: string | null
          expires_at: string | null
          id: string
          is_test: boolean
          key_hash: string
          key_prefix: string
          last_pause_at: string | null
          last_used_at: string | null
          name: string
          on_gate_error: string
          on_uncertain: string
          on_uncertain_downgrade_reason: string | null
          on_uncertain_downgraded_at: string | null
          pause_count: number
          paused_until: string | null
          quiet_hours_end_hour: number | null
          quiet_hours_start_hour: number | null
          quiet_hours_timezone: string | null
          rate_limit_per_minute: number | null
          revoked_at: string | null
          scopes: string[]
          shadow_on_uncertain: string | null
          user_id: string
        }
        Insert: {
          abuse_alerted_at?: string | null
          callback_failure_streak?: number
          callback_fallback?: string
          callback_secret?: string | null
          callback_timeout_seconds?: number
          callback_url?: string | null
          created_at?: string
          embedding_pipeline_alerted_at?: string | null
          expires_at?: string | null
          id?: string
          is_test?: boolean
          key_hash: string
          key_prefix: string
          last_pause_at?: string | null
          last_used_at?: string | null
          name: string
          on_gate_error?: string
          on_uncertain?: string
          on_uncertain_downgrade_reason?: string | null
          on_uncertain_downgraded_at?: string | null
          pause_count?: number
          paused_until?: string | null
          quiet_hours_end_hour?: number | null
          quiet_hours_start_hour?: number | null
          quiet_hours_timezone?: string | null
          rate_limit_per_minute?: number | null
          revoked_at?: string | null
          scopes?: string[]
          shadow_on_uncertain?: string | null
          user_id: string
        }
        Update: {
          abuse_alerted_at?: string | null
          callback_failure_streak?: number
          callback_fallback?: string
          callback_secret?: string | null
          callback_timeout_seconds?: number
          callback_url?: string | null
          created_at?: string
          embedding_pipeline_alerted_at?: string | null
          expires_at?: string | null
          id?: string
          is_test?: boolean
          key_hash?: string
          key_prefix?: string
          last_pause_at?: string | null
          last_used_at?: string | null
          name?: string
          on_gate_error?: string
          on_uncertain?: string
          on_uncertain_downgrade_reason?: string | null
          on_uncertain_downgraded_at?: string | null
          pause_count?: number
          paused_until?: string | null
          quiet_hours_end_hour?: number | null
          quiet_hours_start_hour?: number | null
          quiet_hours_timezone?: string | null
          rate_limit_per_minute?: number | null
          revoked_at?: string | null
          scopes?: string[]
          shadow_on_uncertain?: string | null
          user_id?: string
        }
        Relationships: []
      }
      audit_integrity_runs: {
        Row: {
          auto_resolutions_checked: number
          auto_resolutions_mismatched: number
          checked: number
          created_at: string
          decision_consistency_checked: number
          decision_consistency_mismatched: number
          id: string
          knowledge_base_checked: number
          knowledge_base_mismatched: number
          mismatched_count: number
          precedent_citations_checked: number
          precedent_citations_mismatched: number
          range_from: string
          range_to: string
          triggered_by: string
          unsigned: number
          user_id: string
          verified: number
        }
        Insert: {
          auto_resolutions_checked?: number
          auto_resolutions_mismatched?: number
          checked: number
          created_at?: string
          decision_consistency_checked?: number
          decision_consistency_mismatched?: number
          id?: string
          knowledge_base_checked?: number
          knowledge_base_mismatched?: number
          mismatched_count: number
          precedent_citations_checked?: number
          precedent_citations_mismatched?: number
          range_from: string
          range_to: string
          triggered_by: string
          unsigned: number
          user_id: string
          verified: number
        }
        Update: {
          auto_resolutions_checked?: number
          auto_resolutions_mismatched?: number
          checked?: number
          created_at?: string
          decision_consistency_checked?: number
          decision_consistency_mismatched?: number
          id?: string
          knowledge_base_checked?: number
          knowledge_base_mismatched?: number
          mismatched_count?: number
          precedent_citations_checked?: number
          precedent_citations_mismatched?: number
          range_from?: string
          range_to?: string
          triggered_by?: string
          unsigned?: number
          user_id?: string
          verified?: number
        }
        Relationships: []
      }
      automation_readiness_signal_state: {
        Row: {
          api_key_id: string
          id: string
          ready: boolean
          signal: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key_id: string
          id?: string
          ready?: boolean
          signal: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key_id?: string
          id?: string
          ready?: boolean
          signal?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_readiness_signal_state_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      business_profiles: {
        Row: {
          audience: string | null
          channels: Json
          company_name: string | null
          created_at: string
          id: string
          industry: string | null
          inferred_kpis: Json
          offers: Json
          one_liner: string | null
          raw_research: Json
          source_url: string | null
          tone: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          audience?: string | null
          channels?: Json
          company_name?: string | null
          created_at?: string
          id?: string
          industry?: string | null
          inferred_kpis?: Json
          offers?: Json
          one_liner?: string | null
          raw_research?: Json
          source_url?: string | null
          tone?: string | null
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          audience?: string | null
          channels?: Json
          company_name?: string | null
          created_at?: string
          id?: string
          industry?: string | null
          inferred_kpis?: Json
          offers?: Json
          one_liner?: string | null
          raw_research?: Json
          source_url?: string | null
          tone?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      canva_oauth_transactions: {
        Row: {
          code_verifier: string
          created_at: string
          expires_at: string
          request_origin: string | null
          scope_groups: string[]
          state: string
          user_id: string
        }
        Insert: {
          code_verifier: string
          created_at?: string
          expires_at?: string
          request_origin?: string | null
          scope_groups?: string[]
          state: string
          user_id: string
        }
        Update: {
          code_verifier?: string
          created_at?: string
          expires_at?: string
          request_origin?: string | null
          scope_groups?: string[]
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      circuit_breakers: {
        Row: {
          action_type: string
          agent_id: string | null
          attempts: number
          created_at: string
          failure_rate: number
          failures: number
          id: string
          last_attempt_at: string
          last_reason: string | null
          recent_outcomes: string[]
          trip_count: number
          tripped: boolean
          tripped_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          action_type: string
          agent_id?: string | null
          attempts?: number
          created_at?: string
          failure_rate?: number
          failures?: number
          id?: string
          last_attempt_at?: string
          last_reason?: string | null
          recent_outcomes?: string[]
          trip_count?: number
          tripped?: boolean
          tripped_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          action_type?: string
          agent_id?: string | null
          attempts?: number
          created_at?: string
          failure_rate?: number
          failures?: number
          id?: string
          last_attempt_at?: string
          last_reason?: string | null
          recent_outcomes?: string[]
          trip_count?: number
          tripped?: boolean
          tripped_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "circuit_breakers_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      confidence_bucket_flags: {
        Row: {
          api_key_id: string | null
          bucket_max: number
          bucket_min: number
          cleared_at: string | null
          cleared_by: string | null
          created_at: string
          flagged_at: string
          id: string
          incident_id: string | null
          user_id: string
        }
        Insert: {
          api_key_id?: string | null
          bucket_max: number
          bucket_min: number
          cleared_at?: string | null
          cleared_by?: string | null
          created_at?: string
          flagged_at?: string
          id?: string
          incident_id?: string | null
          user_id: string
        }
        Update: {
          api_key_id?: string | null
          bucket_max?: number
          bucket_min?: number
          cleared_at?: string | null
          cleared_by?: string | null
          created_at?: string
          flagged_at?: string
          id?: string
          incident_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "confidence_bucket_flags_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      confidence_calibration: {
        Row: {
          api_key_id: string | null
          bucket_label: string
          bucket_max: number
          bucket_min: number
          calibration_gap: number | null
          created_at: string
          decision_count: number
          expected_rate: number | null
          failure_count: number
          id: string
          miscalibrated: boolean
          neutral_count: number
          note: string | null
          period_end: string
          period_start: string
          severity: string
          success_count: number
          success_rate: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key_id?: string | null
          bucket_label: string
          bucket_max: number
          bucket_min: number
          calibration_gap?: number | null
          created_at?: string
          decision_count?: number
          expected_rate?: number | null
          failure_count?: number
          id?: string
          miscalibrated?: boolean
          neutral_count?: number
          note?: string | null
          period_end: string
          period_start: string
          severity?: string
          success_count?: number
          success_rate?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key_id?: string | null
          bucket_label?: string
          bucket_max?: number
          bucket_min?: number
          calibration_gap?: number | null
          created_at?: string
          decision_count?: number
          expected_rate?: number | null
          failure_count?: number
          id?: string
          miscalibrated?: boolean
          neutral_count?: number
          note?: string | null
          period_end?: string
          period_start?: string
          severity?: string
          success_count?: number
          success_rate?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      config_changes: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          id: string
          row_id: string | null
          table_name: string
          user_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          row_id?: string | null
          table_name: string
          user_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          row_id?: string | null
          table_name?: string
          user_id?: string
        }
        Relationships: []
      }
      control_test_runs: {
        Row: {
          created_at: string
          id: string
          pass_rate_pct: number
          policy_version: number | null
          policy_version_id: string | null
          regressions: Json
          scenario_status: Json
          summary: Json
          triggered_by: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          pass_rate_pct: number
          policy_version?: number | null
          policy_version_id?: string | null
          regressions?: Json
          scenario_status?: Json
          summary?: Json
          triggered_by?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          pass_rate_pct?: number
          policy_version?: number | null
          policy_version_id?: string | null
          regressions?: Json
          scenario_status?: Json
          summary?: Json
          triggered_by?: string
          user_id?: string
        }
        Relationships: []
      }
      credit_transactions: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          metadata: Json | null
          price_usd: number | null
          status: string
          type: string
          user_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          description: string
          id?: string
          metadata?: Json | null
          price_usd?: number | null
          status?: string
          type: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          metadata?: Json | null
          price_usd?: number | null
          status?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      critical_alerts: {
        Row: {
          action_type: string | null
          actor: string | null
          created_at: string
          decision_id: string | null
          delivered_via: string
          event: string
          id: string
          provider: string | null
          summary: string
          user_id: string
        }
        Insert: {
          action_type?: string | null
          actor?: string | null
          created_at?: string
          decision_id?: string | null
          delivered_via: string
          event: string
          id?: string
          provider?: string | null
          summary: string
          user_id: string
        }
        Update: {
          action_type?: string | null
          actor?: string | null
          created_at?: string
          decision_id?: string | null
          delivered_via?: string
          event?: string
          id?: string
          provider?: string | null
          summary?: string
          user_id?: string
        }
        Relationships: []
      }
      cross_account_precedent_stats: {
        Row: {
          action_type: string
          contributing_account_count: number
          id: string
          non_allow_count: number
          provider: string
          total_count: number
          updated_at: string
        }
        Insert: {
          action_type: string
          contributing_account_count?: number
          id?: string
          non_allow_count?: number
          provider?: string
          total_count?: number
          updated_at?: string
        }
        Update: {
          action_type?: string
          contributing_account_count?: number
          id?: string
          non_allow_count?: number
          provider?: string
          total_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      data_deletion_requests: {
        Row: {
          cancelled_at: string | null
          completed_at: string | null
          execute_at: string
          id: string
          requested_at: string
          requested_by: string
          status: string
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          completed_at?: string | null
          execute_at: string
          id?: string
          requested_at?: string
          requested_by: string
          status?: string
          user_id: string
        }
        Update: {
          cancelled_at?: string | null
          completed_at?: string | null
          execute_at?: string
          id?: string
          requested_at?: string
          requested_by?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      decision_embeddings: {
        Row: {
          action_type: string
          api_key_id: string
          created_at: string
          decision_id: string
          embedding: string
          excluded_from_precedent: boolean
          id: string
          provider: string
          user_id: string
        }
        Insert: {
          action_type: string
          api_key_id: string
          created_at?: string
          decision_id: string
          embedding: string
          excluded_from_precedent?: boolean
          id?: string
          provider: string
          user_id: string
        }
        Update: {
          action_type?: string
          api_key_id?: string
          created_at?: string
          decision_id?: string
          embedding?: string
          excluded_from_precedent?: boolean
          id?: string
          provider?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "decision_embeddings_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_embeddings_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: true
            referencedRelation: "agent_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      decision_outcomes: {
        Row: {
          agent_id: string | null
          baseline_value: number | null
          created_at: string
          decision_id: string
          delta: number | null
          delta_pct: number | null
          direction: string
          evidence: Json
          id: string
          linked_metric: string
          measured_at: string
          org_insight_id: string | null
          provider: string | null
          result_value: number | null
          updated_at: string
          user_id: string
          window_days: number
        }
        Insert: {
          agent_id?: string | null
          baseline_value?: number | null
          created_at?: string
          decision_id: string
          delta?: number | null
          delta_pct?: number | null
          direction?: string
          evidence?: Json
          id?: string
          linked_metric: string
          measured_at?: string
          org_insight_id?: string | null
          provider?: string | null
          result_value?: number | null
          updated_at?: string
          user_id: string
          window_days?: number
        }
        Update: {
          agent_id?: string | null
          baseline_value?: number | null
          created_at?: string
          decision_id?: string
          delta?: number | null
          delta_pct?: number | null
          direction?: string
          evidence?: Json
          id?: string
          linked_metric?: string
          measured_at?: string
          org_insight_id?: string | null
          provider?: string | null
          result_value?: number | null
          updated_at?: string
          user_id?: string
          window_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "decision_outcomes_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_outcomes_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "agent_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_outcomes_org_insight_id_fkey"
            columns: ["org_insight_id"]
            isOneToOne: false
            referencedRelation: "org_insights"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      figma_oauth_transactions: {
        Row: {
          created_at: string
          expires_at: string
          state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          state: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      gmail_oauth_transactions: {
        Row: {
          created_at: string
          expires_at: string
          state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          state: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      hard_rule_shadow_hits: {
        Row: {
          action_type: string
          actual_decision: string | null
          created_at: string
          decision_id: string | null
          id: string
          provider: string | null
          rule_id: string
          user_id: string
          would_have: string
        }
        Insert: {
          action_type: string
          actual_decision?: string | null
          created_at?: string
          decision_id?: string | null
          id?: string
          provider?: string | null
          rule_id: string
          user_id: string
          would_have: string
        }
        Update: {
          action_type?: string
          actual_decision?: string | null
          created_at?: string
          decision_id?: string | null
          id?: string
          provider?: string | null
          rule_id?: string
          user_id?: string
          would_have?: string
        }
        Relationships: [
          {
            foreignKeyName: "hard_rule_shadow_hits_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "agent_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hard_rule_shadow_hits_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "hard_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      hard_rules: {
        Row: {
          action_type_pattern: string
          agent_id: string | null
          created_at: string
          effect: string
          enabled: boolean
          id: string
          promoted_at: string | null
          provider: string | null
          rationale: string | null
          rule_text: string
          shadow_mode: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          action_type_pattern?: string
          agent_id?: string | null
          created_at?: string
          effect?: string
          enabled?: boolean
          id?: string
          promoted_at?: string | null
          provider?: string | null
          rationale?: string | null
          rule_text: string
          shadow_mode?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          action_type_pattern?: string
          agent_id?: string | null
          created_at?: string
          effect?: string
          enabled?: boolean
          id?: string
          promoted_at?: string | null
          provider?: string | null
          rationale?: string | null
          rule_text?: string
          shadow_mode?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hard_rules_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          created_at: string
          id: string
          idempotency_key: string
          response: Json | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          idempotency_key: string
          response?: Json | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          idempotency_key?: string
          response?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      incidents: {
        Row: {
          action_type: string | null
          alert_id: string | null
          created_at: string
          decision_id: string | null
          id: string
          kind: string
          opened_at: string
          provider: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          summary: string
          user_id: string
        }
        Insert: {
          action_type?: string | null
          alert_id?: string | null
          created_at?: string
          decision_id?: string | null
          id?: string
          kind: string
          opened_at?: string
          provider?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          summary: string
          user_id: string
        }
        Update: {
          action_type?: string | null
          alert_id?: string | null
          created_at?: string
          decision_id?: string | null
          id?: string
          kind?: string
          opened_at?: string
          provider?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          summary?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incidents_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "critical_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_issues: {
        Row: {
          agent_id: string | null
          created_at: string
          error_type: string
          fix_action: string
          human_message: string
          id: string
          issue_key: string
          last_seen_at: string
          occurrences: number
          provider: string
          resolution: Json
          resolved_at: string | null
          scope_hint: string | null
          status: string
          technical: string | null
          title: string
          tool_kind: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          error_type: string
          fix_action?: string
          human_message: string
          id?: string
          issue_key: string
          last_seen_at?: string
          occurrences?: number
          provider: string
          resolution?: Json
          resolved_at?: string | null
          scope_hint?: string | null
          status?: string
          technical?: string | null
          title: string
          tool_kind?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          error_type?: string
          fix_action?: string
          human_message?: string
          id?: string
          issue_key?: string
          last_seen_at?: string
          occurrences?: number
          provider?: string
          resolution?: Json
          resolved_at?: string | null
          scope_hint?: string | null
          status?: string
          technical?: string | null
          title?: string
          tool_kind?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      integration_snapshots: {
        Row: {
          agent_id: string | null
          created_at: string
          data: Json
          error: string | null
          fetched_at: string
          id: string
          kind: string
          provider: string
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          data?: Json
          error?: string | null
          fetched_at?: string
          id?: string
          kind?: string
          provider: string
          user_id: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          data?: Json
          error?: string | null
          fetched_at?: string
          id?: string
          kind?: string
          provider?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_snapshots_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      ip_rate_limit_windows: {
        Row: {
          count: number
          endpoint: string
          ip: string
          window_start: string
        }
        Insert: {
          count?: number
          endpoint: string
          ip: string
          window_start: string
        }
        Update: {
          count?: number
          endpoint?: string
          ip?: string
          window_start?: string
        }
        Relationships: []
      }
      knowledge_base_entries: {
        Row: {
          action_type_pattern: string | null
          auto_drafted: boolean
          created_at: string
          enabled: boolean
          entry_text: string
          id: string
          pending_review: boolean
          provider: string | null
          user_id: string
        }
        Insert: {
          action_type_pattern?: string | null
          auto_drafted?: boolean
          created_at?: string
          enabled?: boolean
          entry_text: string
          id?: string
          pending_review?: boolean
          provider?: string | null
          user_id: string
        }
        Update: {
          action_type_pattern?: string | null
          auto_drafted?: boolean
          created_at?: string
          enabled?: boolean
          entry_text?: string
          id?: string
          pending_review?: boolean
          provider?: string | null
          user_id?: string
        }
        Relationships: []
      }
      missions: {
        Row: {
          attachment_urls: string[] | null
          created_at: string
          directive: string
          id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attachment_urls?: string[] | null
          created_at?: string
          directive: string
          id?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attachment_urls?: string[] | null
          created_at?: string
          directive?: string
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          account_owner_id: string
          created_at: string
          critical_alert_email_enabled: boolean
          digest_enabled: boolean
          id: string
          recipient_id: string
          updated_at: string
          weekly_trend_enabled: boolean
        }
        Insert: {
          account_owner_id: string
          created_at?: string
          critical_alert_email_enabled?: boolean
          digest_enabled?: boolean
          id?: string
          recipient_id: string
          updated_at?: string
          weekly_trend_enabled?: boolean
        }
        Update: {
          account_owner_id?: string
          created_at?: string
          critical_alert_email_enabled?: boolean
          digest_enabled?: boolean
          id?: string
          recipient_id?: string
          updated_at?: string
          weekly_trend_enabled?: boolean
        }
        Relationships: []
      }
      notion_oauth_transactions: {
        Row: {
          created_at: string
          expires_at: string
          request_origin: string | null
          state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          request_origin?: string | null
          state: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          request_origin?: string | null
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      org_insights: {
        Row: {
          confidence: string
          created_at: string
          evidence_count: number
          first_observed_at: string
          id: string
          insight: string
          kind: string
          last_confirmed_at: string
          source_agent_ids: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          confidence?: string
          created_at?: string
          evidence_count?: number
          first_observed_at?: string
          id?: string
          insight: string
          kind?: string
          last_confirmed_at?: string
          source_agent_ids?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          confidence?: string
          created_at?: string
          evidence_count?: number
          first_observed_at?: string
          id?: string
          insight?: string
          kind?: string
          last_confirmed_at?: string
          source_agent_ids?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pending_approval_events: {
        Row: {
          actor_id: string | null
          approval_id: string
          created_at: string
          event_type: string
          id: string
          note: string | null
          target_id: string | null
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          approval_id: string
          created_at?: string
          event_type: string
          id?: string
          note?: string | null
          target_id?: string | null
          user_id: string
        }
        Update: {
          actor_id?: string | null
          approval_id?: string
          created_at?: string
          event_type?: string
          id?: string
          note?: string | null
          target_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_approval_events_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "pending_approvals"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_approvals: {
        Row: {
          action_type: string
          agent_id: string | null
          approvals: Json
          approver_role: string
          assigned_to: string | null
          comment: string | null
          created_at: string
          decision_id: string | null
          description: string
          escalated_at: string | null
          executed_at: string | null
          id: string
          origin: string
          params: Json
          plan_id: string | null
          provider: string
          reason: string
          reason_code: string | null
          requester_id: string | null
          required_approvals: number
          resolved_at: string | null
          resolved_by: string | null
          risk_tier: string
          run_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          action_type: string
          agent_id?: string | null
          approvals?: Json
          approver_role?: string
          assigned_to?: string | null
          comment?: string | null
          created_at?: string
          decision_id?: string | null
          description?: string
          escalated_at?: string | null
          executed_at?: string | null
          id?: string
          origin?: string
          params?: Json
          plan_id?: string | null
          provider?: string
          reason?: string
          reason_code?: string | null
          requester_id?: string | null
          required_approvals?: number
          resolved_at?: string | null
          resolved_by?: string | null
          risk_tier?: string
          run_id?: string | null
          status?: string
          user_id: string
        }
        Update: {
          action_type?: string
          agent_id?: string | null
          approvals?: Json
          approver_role?: string
          assigned_to?: string | null
          comment?: string | null
          created_at?: string
          decision_id?: string | null
          description?: string
          escalated_at?: string | null
          executed_at?: string | null
          id?: string
          origin?: string
          params?: Json
          plan_id?: string | null
          provider?: string
          reason?: string
          reason_code?: string | null
          requester_id?: string | null
          required_approvals?: number
          resolved_at?: string | null
          resolved_by?: string | null
          risk_tier?: string
          run_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_approvals_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_approvals_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "agent_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_approvals_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_incidents: {
        Row: {
          created_at: string
          detail: Json | null
          id: string
          kind: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          summary: string
        }
        Insert: {
          created_at?: string
          detail?: Json | null
          id?: string
          kind: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          summary: string
        }
        Update: {
          created_at?: string
          detail?: Json | null
          id?: string
          kind?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          summary?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          id: number
          kill_switch: boolean
          kill_switch_reason: string | null
          kill_switch_updated_at: string | null
          kill_switch_updated_by: string | null
        }
        Insert: {
          id?: number
          kill_switch?: boolean
          kill_switch_reason?: string | null
          kill_switch_updated_at?: string | null
          kill_switch_updated_by?: string | null
        }
        Update: {
          id?: number
          kill_switch?: boolean
          kill_switch_reason?: string | null
          kill_switch_updated_at?: string | null
          kill_switch_updated_by?: string | null
        }
        Relationships: []
      }
      policy_change_requests: {
        Row: {
          agent_id: string | null
          approved_at: string | null
          approved_by: string | null
          change_type: string
          created_at: string
          description: string
          id: string
          new_value: Json | null
          requested_by: string
          row_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          change_type: string
          created_at?: string
          description?: string
          id?: string
          new_value?: Json | null
          requested_by: string
          row_id?: string | null
          status?: string
          user_id: string
        }
        Update: {
          agent_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          change_type?: string
          created_at?: string
          description?: string
          id?: string
          new_value?: Json | null
          requested_by?: string
          row_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "policy_change_requests_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_versions: {
        Row: {
          activated_at: string | null
          created_at: string
          id: string
          notes: string | null
          snapshot: Json
          status: string
          updated_at: string
          user_id: string
          version: number
          watching: boolean
          watching_since: string | null
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          snapshot?: Json
          status?: string
          updated_at?: string
          user_id: string
          version: number
          watching?: boolean
          watching_since?: string | null
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          snapshot?: Json
          status?: string
          updated_at?: string
          user_id?: string
          version?: number
          watching?: boolean
          watching_since?: string | null
        }
        Relationships: []
      }
      policy_watch_observations: {
        Row: {
          action_type: string
          active_outcome: string
          changed: boolean
          created_at: string
          decision_id: string | null
          draft_outcome: string
          id: string
          policy_version_id: string
          provider: string | null
          user_id: string
        }
        Insert: {
          action_type: string
          active_outcome: string
          changed: boolean
          created_at?: string
          decision_id?: string | null
          draft_outcome: string
          id?: string
          policy_version_id: string
          provider?: string | null
          user_id: string
        }
        Update: {
          action_type?: string
          active_outcome?: string
          changed?: boolean
          created_at?: string
          decision_id?: string | null
          draft_outcome?: string
          id?: string
          policy_version_id?: string
          provider?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "policy_watch_observations_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "agent_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_watch_observations_policy_version_id_fkey"
            columns: ["policy_version_id"]
            isOneToOne: false
            referencedRelation: "policy_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          auto_resolution_share_alerted_at: string | null
          compliance_report_monthly_enabled: boolean
          control_strictness: string
          coordinated_abuse_alerted_at: string | null
          created_at: string
          credits: number
          display_name: string | null
          id: string
          kill_switch: boolean
          kill_switch_at: string | null
          kill_switch_auto: boolean
          kill_switch_source: string | null
          require_dual_control_for_policy: boolean
          retention_days: number
          roi_report_monthly_enabled: boolean
          share_anonymized_precedent_stats: boolean
          updated_at: string
          user_context: Json
        }
        Insert: {
          auto_resolution_share_alerted_at?: string | null
          compliance_report_monthly_enabled?: boolean
          control_strictness?: string
          coordinated_abuse_alerted_at?: string | null
          created_at?: string
          credits?: number
          display_name?: string | null
          id: string
          kill_switch?: boolean
          kill_switch_at?: string | null
          kill_switch_auto?: boolean
          kill_switch_source?: string | null
          require_dual_control_for_policy?: boolean
          retention_days?: number
          roi_report_monthly_enabled?: boolean
          share_anonymized_precedent_stats?: boolean
          updated_at?: string
          user_context?: Json
        }
        Update: {
          auto_resolution_share_alerted_at?: string | null
          compliance_report_monthly_enabled?: boolean
          control_strictness?: string
          coordinated_abuse_alerted_at?: string | null
          created_at?: string
          credits?: number
          display_name?: string | null
          id?: string
          kill_switch?: boolean
          kill_switch_at?: string | null
          kill_switch_auto?: boolean
          kill_switch_source?: string | null
          require_dual_control_for_policy?: boolean
          retention_days?: number
          roi_report_monthly_enabled?: boolean
          share_anonymized_precedent_stats?: boolean
          updated_at?: string
          user_context?: Json
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          html: string
          id: string
          last_opened_at: string
          prompt: string | null
          status: string
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          html: string
          id?: string
          last_opened_at?: string
          prompt?: string | null
          status?: string
          title?: string
          user_id: string
        }
        Update: {
          created_at?: string
          html?: string
          id?: string
          last_opened_at?: string
          prompt?: string | null
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      rate_limit_windows: {
        Row: {
          count: number
          endpoint: string
          user_id: string
          window_start: string
        }
        Insert: {
          count?: number
          endpoint: string
          user_id: string
          window_start: string
        }
        Update: {
          count?: number
          endpoint?: string
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      safety_rule_matches: {
        Row: {
          action_type: string
          created_at: string
          decision_id: string | null
          id: string
          provider: string | null
          rule_id: string
          user_id: string
        }
        Insert: {
          action_type: string
          created_at?: string
          decision_id?: string | null
          id?: string
          provider?: string | null
          rule_id: string
          user_id: string
        }
        Update: {
          action_type?: string
          created_at?: string
          decision_id?: string | null
          id?: string
          provider?: string | null
          rule_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_rule_matches_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "agent_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_rule_matches_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "safety_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_rule_shadow_hits: {
        Row: {
          action_type: string
          actual_decision: string | null
          created_at: string
          decision_id: string | null
          id: string
          provider: string | null
          rule_id: string
          user_id: string
          would_have: string
        }
        Insert: {
          action_type: string
          actual_decision?: string | null
          created_at?: string
          decision_id?: string | null
          id?: string
          provider?: string | null
          rule_id: string
          user_id: string
          would_have: string
        }
        Update: {
          action_type?: string
          actual_decision?: string | null
          created_at?: string
          decision_id?: string | null
          id?: string
          provider?: string | null
          rule_id?: string
          user_id?: string
          would_have?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_rule_shadow_hits_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "agent_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_rule_shadow_hits_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "safety_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_rules: {
        Row: {
          agent_id: string | null
          category: string
          created_at: string
          enabled: boolean
          id: string
          name: string
          pattern: string
          promoted_at: string | null
          rationale: string | null
          severity: string
          shadow_mode: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          category?: string
          created_at?: string
          enabled?: boolean
          id?: string
          name: string
          pattern: string
          promoted_at?: string | null
          rationale?: string | null
          severity?: string
          shadow_mode?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string | null
          category?: string
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          pattern?: string
          promoted_at?: string | null
          rationale?: string | null
          severity?: string
          shadow_mode?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_rules_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      scenario_simulations: {
        Row: {
          created_at: string
          id: string
          question: string
          response: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          question: string
          response?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          question?: string
          response?: Json
          user_id?: string
        }
        Relationships: []
      }
      scheduled_job_requests: {
        Row: {
          created_at: string
          id: number
          job_name: string
          request_id: number
        }
        Insert: {
          created_at?: string
          id?: never
          job_name: string
          request_id: number
        }
        Update: {
          created_at?: string
          id?: never
          job_name?: string
          request_id?: number
        }
        Relationships: []
      }
      shared_websites: {
        Row: {
          created_at: string
          html: string
          id: string
          title: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          html: string
          id?: string
          title?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          html?: string
          id?: string
          title?: string | null
          user_id?: string
        }
        Relationships: []
      }
      shopify_oauth_transactions: {
        Row: {
          created_at: string
          expires_at: string
          request_origin: string | null
          shop_domain: string
          state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          request_origin?: string | null
          shop_domain: string
          state: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          request_origin?: string | null
          shop_domain?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      slack_oauth_transactions: {
        Row: {
          created_at: string
          expires_at: string
          request_origin: string | null
          scope_groups: string[]
          state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          request_origin?: string | null
          scope_groups?: string[]
          state: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          request_origin?: string | null
          scope_groups?: string[]
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      webhook_deliveries: {
        Row: {
          attempt: number
          created_at: string
          error: string | null
          event: string
          id: string
          next_retry_at: string | null
          ok: boolean
          original_delivery_id: string | null
          payload: Json | null
          status_code: number | null
          user_id: string
          webhook_id: string
        }
        Insert: {
          attempt?: number
          created_at?: string
          error?: string | null
          event: string
          id?: string
          next_retry_at?: string | null
          ok: boolean
          original_delivery_id?: string | null
          payload?: Json | null
          status_code?: number | null
          user_id: string
          webhook_id: string
        }
        Update: {
          attempt?: number
          created_at?: string
          error?: string | null
          event?: string
          id?: string
          next_retry_at?: string | null
          ok?: boolean
          original_delivery_id?: string | null
          payload?: Json | null
          status_code?: number | null
          user_id?: string
          webhook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_original_delivery_id_fkey"
            columns: ["original_delivery_id"]
            isOneToOne: false
            referencedRelation: "webhook_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_deliveries_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: false
            referencedRelation: "webhooks"
            referencedColumns: ["id"]
          },
        ]
      }
      webhooks: {
        Row: {
          alerted_at: string | null
          created_at: string
          enabled: boolean
          events: string[]
          id: string
          previous_secret: string | null
          previous_secret_expires_at: string | null
          secret: string
          updated_at: string
          url: string
          user_id: string
        }
        Insert: {
          alerted_at?: string | null
          created_at?: string
          enabled?: boolean
          events?: string[]
          id?: string
          previous_secret?: string | null
          previous_secret_expires_at?: string | null
          secret: string
          updated_at?: string
          url: string
          user_id: string
        }
        Update: {
          alerted_at?: string | null
          created_at?: string
          enabled?: boolean
          events?: string[]
          id?: string
          previous_secret?: string | null
          previous_secret_expires_at?: string | null
          secret?: string
          updated_at?: string
          url?: string
          user_id?: string
        }
        Relationships: []
      }
      website_pages: {
        Row: {
          created_at: string
          id: string
          order_index: number
          sections: Json
          seo_description: string | null
          slug: string
          title: string | null
          updated_at: string
          website_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_index?: number
          sections?: Json
          seo_description?: string | null
          slug: string
          title?: string | null
          updated_at?: string
          website_id: string
        }
        Update: {
          created_at?: string
          id?: string
          order_index?: number
          sections?: Json
          seo_description?: string | null
          slug?: string
          title?: string | null
          updated_at?: string
          website_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "website_pages_website_id_fkey"
            columns: ["website_id"]
            isOneToOne: false
            referencedRelation: "websites"
            referencedColumns: ["id"]
          },
        ]
      }
      websites: {
        Row: {
          created_at: string
          custom_domain: string | null
          html: string
          id: string
          name: string | null
          prompt: string | null
          subdomain: string | null
          tagline: string | null
          theme: Json
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          custom_domain?: string | null
          html: string
          id?: string
          name?: string | null
          prompt?: string | null
          subdomain?: string | null
          tagline?: string | null
          theme?: Json
          title?: string
          user_id: string
        }
        Update: {
          created_at?: string
          custom_domain?: string | null
          html?: string
          id?: string
          name?: string | null
          prompt?: string | null
          subdomain?: string | null
          tagline?: string | null
          theme?: Json
          title?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _decision_signing_secret_for_key: {
        Args: { _key_id: string }
        Returns: string
      }
      _verify_decision_signatures_impl: {
        Args: { _from: string; _limit: number; _to: string; _user_id: string }
        Returns: Json
      }
      add_credits: { Args: { amount: number }; Returns: number }
      approve_policy_change: {
        Args: { _request_id: string }
        Returns: {
          agent_id: string | null
          approved_at: string | null
          approved_by: string | null
          change_type: string
          created_at: string
          description: string
          id: string
          new_value: Json | null
          requested_by: string
          row_id: string | null
          status: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "policy_change_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      build_policy_snapshot: { Args: { _user_id: string }; Returns: Json }
      cancel_data_deletion: { Args: { _request_id: string }; Returns: boolean }
      consume_canva_oauth_transaction: {
        Args: { _state: string }
        Returns: {
          code_verifier: string
          request_origin: string
          scope_groups: string[]
          user_id: string
        }[]
      }
      consume_figma_oauth_transaction: {
        Args: { _state: string }
        Returns: {
          user_id: string
        }[]
      }
      consume_gmail_oauth_transaction: {
        Args: { _state: string }
        Returns: {
          user_id: string
        }[]
      }
      consume_notion_oauth_transaction: {
        Args: { _state: string }
        Returns: {
          request_origin: string
          user_id: string
        }[]
      }
      consume_shopify_oauth_transaction: {
        Args: { _state: string }
        Returns: {
          request_origin: string
          shop_domain: string
          user_id: string
        }[]
      }
      consume_slack_oauth_transaction: {
        Args: { _state: string }
        Returns: {
          request_origin: string
          scope_groups: string[]
          user_id: string
        }[]
      }
      create_integration_secret: {
        Args: { label?: string; payload: Json }
        Returns: string
      }
      decision_canonical_payload: {
        Args: {
          _agent_run_id: string
          _confidence: number
          _created_at: string
          _decision: string
          _id: string
          _reasoning: string
          _source: string
          _user_id: string
        }
        Returns: string
      }
      deduct_credit: { Args: { user_id: string }; Returns: boolean }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      delete_integration_secret: { Args: { sid: string }; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      get_active_policy_version: {
        Args: { _user_id: string }
        Returns: {
          id: string
          snapshot: Json
          version: number
        }[]
      }
      get_business_context: { Args: { _user_id: string }; Returns: Json }
      get_identity_providers_for_email: {
        Args: { _email: string }
        Returns: string[]
      }
      get_job_health_outcomes: {
        Args: { _since: string }
        Returns: {
          job_name: string
          request_id: number
          status_code: number
          timed_out: boolean
        }[]
      }
      get_recent_breaker_trips: {
        Args: { _since: string }
        Returns: {
          action_type: string
          agent_id: string
          decision_id: string
          opened_at: string
          provider: string
          user_id: string
        }[]
      }
      get_recent_decision_user_ids: {
        Args: { _since: string }
        Returns: {
          user_id: string
        }[]
      }
      get_replayable_real_decisions: {
        Args: { _limit?: number; _user_id: string }
        Returns: {
          action_type: string
          created_at: string
          description: string
          id: string
          params: Json
          provider: string
          real_source: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_ip_rate_limit: {
        Args: { _endpoint: string; _ip: string; _window_start: string }
        Returns: number
      }
      increment_rate_limit: {
        Args: { _endpoint: string; _user_id: string; _window_start: string }
        Returns: number
      }
      is_account_member: {
        Args: {
          _account_owner_id: string
          _min_role?: string
          _permission?: string
        }
        Returns: boolean
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      read_integration_secret: { Args: { sid: string }; Returns: Json }
      read_webhook_secret: { Args: { _agent_id: string }; Returns: string }
      reassign_pending_approval: {
        Args: { _approval_id: string; _assigned_to: string }
        Returns: Json
      }
      record_ai_spend: {
        Args: {
          _agent_id?: string
          _api_key_id?: string
          _completion_tokens?: number
          _cost_usd: number
          _prompt_tokens?: number
          _user_id: string
        }
        Returns: {
          account_calls: number
          account_cap_usd: number
          account_capped_at: string
          account_cost_usd: number
          account_pct: number
          account_warned_at: string
          agent_calls: number
          agent_cap_usd: number
          agent_capped_at: string
          agent_cost_usd: number
          agent_has_cap: boolean
          agent_pct: number
          agent_warned_at: string
          day: string
          key_calls: number
          key_cap_usd: number
          key_capped_at: string
          key_cost_usd: number
          key_has_cap: boolean
          key_pct: number
          key_warned_at: string
        }[]
      }
      record_approval_signoff: {
        Args: {
          _approval_id: string
          _comment?: string
          _reason_code?: string
          _vote: string
        }
        Returns: Json
      }
      reject_policy_change: {
        Args: { _request_id: string }
        Returns: {
          agent_id: string | null
          approved_at: string | null
          approved_by: string | null
          change_type: string
          created_at: string
          description: string
          id: string
          new_value: Json | null
          requested_by: string
          row_id: string | null
          status: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "policy_change_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_data_deletion: {
        Args: never
        Returns: {
          cancelled_at: string | null
          completed_at: string | null
          execute_at: string
          id: string
          requested_at: string
          requested_by: string
          status: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "data_deletion_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_policy_change: {
        Args: {
          _agent_id?: string
          _change_type: string
          _description?: string
          _new_value?: Json
          _row_id?: string
          _target_user_id?: string
        }
        Returns: {
          agent_id: string | null
          approved_at: string | null
          approved_by: string | null
          change_type: string
          created_at: string
          description: string
          id: string
          new_value: Json | null
          requested_by: string
          row_id: string | null
          status: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "policy_change_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_api_key: {
        Args: { _key_hash: string }
        Returns: {
          is_test: boolean
          key_id: string
          paused_until: string
          scopes: string[]
          user_id: string
        }[]
      }
      rollback_config_change: {
        Args: { _change_id: string }
        Returns: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          id: string
          row_id: string | null
          table_name: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "config_changes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rotate_webhook_secret:
        | { Args: { _agent_id: string }; Returns: string }
        | {
            Args: {
              _grace_hours?: number
              _new_secret: string
              _webhook_id: string
            }
            Returns: {
              id: string
              previous_secret: string
              previous_secret_expires_at: string
              secret: string
            }[]
          }
      search_decision_precedent: {
        Args: {
          _api_key_id: string
          _embedding: string
          _exclude_decision_id?: string
          _limit?: number
        }
        Returns: {
          action_type: string
          created_at: string
          decision_id: string
          provider: string
          similarity: number
        }[]
      }
      sign_compliance_attestation: {
        Args: { _payload: string }
        Returns: string
      }
      update_integration_secret: {
        Args: { payload: Json; sid: string }
        Returns: undefined
      }
      verify_decision_signature: { Args: { _id: string }; Returns: Json }
      verify_decision_signatures_batch: {
        Args: { _from: string; _limit?: number; _to: string }
        Returns: Json
      }
      verify_decision_signatures_batch_for: {
        Args: { _from: string; _limit?: number; _to: string; _user_id: string }
        Returns: Json
      }
    }
    Enums: {
      app_role: "owner" | "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["owner", "admin", "user"],
    },
  },
} as const
