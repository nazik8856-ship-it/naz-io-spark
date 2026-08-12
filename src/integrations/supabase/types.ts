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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
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
          agent_id: string | null
          agent_run_id: string | null
          alternatives_considered: Json
          confidence_score: number
          created_at: string
          decision: string
          escalated: boolean
          human_response: string | null
          id: string
          org_id: string | null
          override_of: string | null
          policy_version: number | null
          reasoning: string
          signature: string | null
          source: string
          step_index: number | null
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          agent_run_id?: string | null
          alternatives_considered?: Json
          confidence_score?: number
          created_at?: string
          decision: string
          escalated?: boolean
          human_response?: string | null
          id?: string
          org_id?: string | null
          override_of?: string | null
          policy_version?: number | null
          reasoning?: string
          signature?: string | null
          source?: string
          step_index?: number | null
          user_id: string
        }
        Update: {
          agent_id?: string | null
          agent_run_id?: string | null
          alternatives_considered?: Json
          confidence_score?: number
          created_at?: string
          decision?: string
          escalated?: boolean
          human_response?: string | null
          id?: string
          org_id?: string | null
          override_of?: string | null
          policy_version?: number | null
          reasoning?: string
          signature?: string | null
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
          credentials_secret_id: string | null
          id: string
          last_error: string | null
          last_verified_at: string | null
          metadata: Json
          provider: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          credentials_secret_id?: string | null
          id?: string
          last_error?: string | null
          last_verified_at?: string | null
          metadata?: Json
          provider: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          credentials_secret_id?: string | null
          id?: string
          last_error?: string | null
          last_verified_at?: string | null
          metadata?: Json
          provider?: string
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
          created_at: string
          daily_cap_usd: number
          enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          daily_cap_usd?: number
          enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          daily_cap_usd?: number
          enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_spend_daily: {
        Row: {
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
        Relationships: []
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
        Relationships: []
      }
      confidence_calibration: {
        Row: {
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
          created_at: string
          effect: string
          enabled: boolean
          id: string
          promoted_at: string | null
          provider: string | null
          rule_text: string
          shadow_mode: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          action_type_pattern?: string
          created_at?: string
          effect?: string
          enabled?: boolean
          id?: string
          promoted_at?: string | null
          provider?: string | null
          rule_text: string
          shadow_mode?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          action_type_pattern?: string
          created_at?: string
          effect?: string
          enabled?: boolean
          id?: string
          promoted_at?: string | null
          provider?: string | null
          rule_text?: string
          shadow_mode?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      pending_approvals: {
        Row: {
          action_type: string
          agent_id: string | null
          approvals: Json
          approver_role: string
          comment: string | null
          created_at: string
          decision_id: string | null
          description: string
          id: string
          origin: string
          params: Json
          provider: string
          reason: string
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
          comment?: string | null
          created_at?: string
          decision_id?: string | null
          description?: string
          id?: string
          origin?: string
          params?: Json
          provider?: string
          reason?: string
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
          comment?: string | null
          created_at?: string
          decision_id?: string | null
          description?: string
          id?: string
          origin?: string
          params?: Json
          provider?: string
          reason?: string
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
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          credits: number
          display_name: string | null
          id: string
          kill_switch: boolean
          kill_switch_at: string | null
          kill_switch_auto: boolean
          kill_switch_source: string | null
          updated_at: string
          user_context: Json
        }
        Insert: {
          created_at?: string
          credits?: number
          display_name?: string | null
          id: string
          kill_switch?: boolean
          kill_switch_at?: string | null
          kill_switch_auto?: boolean
          kill_switch_source?: string | null
          updated_at?: string
          user_context?: Json
        }
        Update: {
          created_at?: string
          credits?: number
          display_name?: string | null
          id?: string
          kill_switch?: boolean
          kill_switch_at?: string | null
          kill_switch_auto?: boolean
          kill_switch_source?: string | null
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
      safety_rules: {
        Row: {
          category: string
          created_at: string
          enabled: boolean
          id: string
          name: string
          pattern: string
          severity: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string
          created_at?: string
          enabled?: boolean
          id?: string
          name: string
          pattern: string
          severity?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          pattern?: string
          severity?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      add_credits: { Args: { amount: number }; Returns: number }
      build_policy_snapshot: { Args: { _user_id: string }; Returns: Json }
      consume_canva_oauth_transaction: {
        Args: { _state: string }
        Returns: {
          code_verifier: string
          request_origin: string
          scope_groups: string[]
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
      email_queue_dispatch: { Args: never; Returns: undefined }
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
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
      record_ai_spend: {
        Args: {
          _completion_tokens?: number
          _cost_usd: number
          _prompt_tokens?: number
          _user_id: string
        }
        Returns: {
          calls: number
          cap_usd: number
          capped_at: string
          cost_usd: number
          day: string
          pct: number
          warned_at: string
        }[]
      }
      rotate_webhook_secret: { Args: { _agent_id: string }; Returns: string }
      update_integration_secret: {
        Args: { payload: Json; sid: string }
        Returns: undefined
      }
      verify_decision_signature: { Args: { _id: string }; Returns: Json }
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
