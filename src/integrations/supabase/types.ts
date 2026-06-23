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
      agent_events: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          kind: string
          payload: Json
          run_id: string
          user_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          kind: string
          payload?: Json
          run_id: string
          user_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
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
      agent_runs: {
        Row: {
          agent_id: string
          finished_at: string | null
          id: string
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
          autonomy: string
          business_profile_id: string | null
          created_at: string
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
        }
        Insert: {
          autonomy?: string
          business_profile_id?: string | null
          created_at?: string
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
        }
        Update: {
          autonomy?: string
          business_profile_id?: string | null
          created_at?: string
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
      profiles: {
        Row: {
          created_at: string
          credits: number
          id: string
        }
        Insert: {
          created_at?: string
          credits?: number
          id: string
        }
        Update: {
          created_at?: string
          credits?: number
          id?: string
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
      shared_websites: {
        Row: {
          created_at: string
          html: string
          id: string
          title: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          html: string
          id?: string
          title?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          html?: string
          id?: string
          title?: string | null
          user_id?: string | null
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
      websites: {
        Row: {
          created_at: string
          html: string
          id: string
          prompt: string | null
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          html: string
          id?: string
          prompt?: string | null
          title?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          html?: string
          id?: string
          prompt?: string | null
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
      deduct_credit: { Args: { user_id: string }; Returns: boolean }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
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
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
