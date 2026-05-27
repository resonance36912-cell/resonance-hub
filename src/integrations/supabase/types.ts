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
      email_suppression_list: {
        Row: {
          created_at: string
          email: string
          id: string
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          reason?: string
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
      payfast_itn_logs: {
        Row: {
          amount_cents: number | null
          error_message: string | null
          http_status: number
          id: string
          outcome: string
          payment_status: string | null
          pf_payment_id: string | null
          raw_payload: Json
          received_at: string
          server_validated: boolean
          signature_valid: boolean
          sku: string | null
          source_ip: string | null
          user_id: string | null
        }
        Insert: {
          amount_cents?: number | null
          error_message?: string | null
          http_status: number
          id?: string
          outcome: string
          payment_status?: string | null
          pf_payment_id?: string | null
          raw_payload: Json
          received_at?: string
          server_validated: boolean
          signature_valid: boolean
          sku?: string | null
          source_ip?: string | null
          user_id?: string | null
        }
        Update: {
          amount_cents?: number | null
          error_message?: string | null
          http_status?: number
          id?: string
          outcome?: string
          payment_status?: string | null
          pf_payment_id?: string | null
          raw_payload?: Json
          received_at?: string
          server_validated?: boolean
          signature_valid?: boolean
          sku?: string | null
          source_ip?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      subscription_email_attempts: {
        Row: {
          attempt_number: number
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          send_id: string
          status: string
        }
        Insert: {
          attempt_number: number
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          send_id: string
          status: string
        }
        Update: {
          attempt_number?: number
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          send_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_email_attempts_send_id_fkey"
            columns: ["send_id"]
            isOneToOne: false
            referencedRelation: "subscription_email_sends"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_email_sends: {
        Row: {
          amount_cents: number
          app: string
          attempt_count: number
          created_at: string
          id: string
          last_attempt_at: string | null
          last_error: string | null
          next_attempt_at: string
          pf_payment_id: string
          recipient_email: string
          skipped_reason: string | null
          sku: string
          status: string
          tier: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          app: string
          attempt_count?: number
          created_at?: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          next_attempt_at?: string
          pf_payment_id: string
          recipient_email: string
          skipped_reason?: string | null
          sku: string
          status?: string
          tier: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          app?: string
          attempt_count?: number
          created_at?: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          next_attempt_at?: string
          pf_payment_id?: string
          recipient_email?: string
          skipped_reason?: string | null
          sku?: string
          status?: string
          tier?: string
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          amount_cents: number
          app: Database["public"]["Enums"]["subscription_app"]
          billing_cycle: string
          cancelled_at: string | null
          created_at: string
          currency: string
          current_period_end: string | null
          id: string
          payfast_payment_id: string | null
          payfast_token: string | null
          status: Database["public"]["Enums"]["subscription_status"]
          tier: Database["public"]["Enums"]["subscription_tier"]
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_cents?: number
          app: Database["public"]["Enums"]["subscription_app"]
          billing_cycle?: string
          cancelled_at?: string | null
          created_at?: string
          currency?: string
          current_period_end?: string | null
          id?: string
          payfast_payment_id?: string | null
          payfast_token?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          tier: Database["public"]["Enums"]["subscription_tier"]
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          app?: Database["public"]["Enums"]["subscription_app"]
          billing_cycle?: string
          cancelled_at?: string | null
          created_at?: string
          currency?: string
          current_period_end?: string | null
          id?: string
          payfast_payment_id?: string | null
          payfast_token?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          tier?: Database["public"]["Enums"]["subscription_tier"]
          updated_at?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
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
    }
    Enums: {
      app_role: "admin" | "user"
      subscription_app:
        | "epublisher"
        | "creative_studio"
        | "sync_vision"
        | "youtube_optimizer"
        | "all_access"
      subscription_status: "pending" | "active" | "past_due" | "cancelled"
      subscription_tier:
        | "free"
        | "starter"
        | "creator"
        | "pro"
        | "business"
        | "all_access"
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
      app_role: ["admin", "user"],
      subscription_app: [
        "epublisher",
        "creative_studio",
        "sync_vision",
        "youtube_optimizer",
        "all_access",
      ],
      subscription_status: ["pending", "active", "past_due", "cancelled"],
      subscription_tier: [
        "free",
        "starter",
        "creator",
        "pro",
        "business",
        "all_access",
      ],
    },
  },
} as const
