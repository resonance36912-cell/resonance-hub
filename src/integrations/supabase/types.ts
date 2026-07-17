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
      app_registry: {
        Row: {
          accent_color: string
          app_id: string
          audience: string
          back_to_hub_path: string
          capabilities: Json
          created_at: string
          currency: string
          description: string
          display_name: string
          domain: string
          entitlement_app_key: string
          fallback_domain: string | null
          free_offer: string | null
          included_in_suite: boolean
          logo_url: string | null
          manage_billing_path: string
          minimum_pack_price_cents: number | null
          pricing_path: string
          short_name: string
          sort_order: number
          status: string
          tagline: string
          updated_at: string
          use_case: string
        }
        Insert: {
          accent_color: string
          app_id: string
          audience?: string
          back_to_hub_path?: string
          capabilities?: Json
          created_at?: string
          currency?: string
          description: string
          display_name: string
          domain: string
          entitlement_app_key: string
          fallback_domain?: string | null
          free_offer?: string | null
          included_in_suite?: boolean
          logo_url?: string | null
          manage_billing_path?: string
          minimum_pack_price_cents?: number | null
          pricing_path?: string
          short_name: string
          sort_order?: number
          status: string
          tagline: string
          updated_at?: string
          use_case: string
        }
        Update: {
          accent_color?: string
          app_id?: string
          audience?: string
          back_to_hub_path?: string
          capabilities?: Json
          created_at?: string
          currency?: string
          description?: string
          display_name?: string
          domain?: string
          entitlement_app_key?: string
          fallback_domain?: string | null
          free_offer?: string | null
          included_in_suite?: boolean
          logo_url?: string | null
          manage_billing_path?: string
          minimum_pack_price_cents?: number | null
          pricing_path?: string
          short_name?: string
          sort_order?: number
          status?: string
          tagline?: string
          updated_at?: string
          use_case?: string
        }
        Relationships: []
      }
      app_submission_audit_log: {
        Row: {
          action: string
          created_at: string
          id: string
          note: string | null
          reviewer_email: string | null
          reviewer_user_id: string
          status_after: string | null
          status_before: string | null
          submission_id: string
          submission_name: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          note?: string | null
          reviewer_email?: string | null
          reviewer_user_id: string
          status_after?: string | null
          status_before?: string | null
          submission_id: string
          submission_name: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          note?: string | null
          reviewer_email?: string | null
          reviewer_user_id?: string
          status_after?: string | null
          status_before?: string | null
          submission_id?: string
          submission_name?: string
        }
        Relationships: []
      }
      app_submissions: {
        Row: {
          accent_color: string | null
          contact_email: string
          created_at: string
          description: string | null
          id: string
          logo_path: string | null
          name: string
          published_at: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          screenshot_paths: string[]
          status: string
          submitter_user_id: string | null
          tagline: string
          updated_at: string
          url: string
          use_case: string | null
        }
        Insert: {
          accent_color?: string | null
          contact_email: string
          created_at?: string
          description?: string | null
          id?: string
          logo_path?: string | null
          name: string
          published_at?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          screenshot_paths?: string[]
          status?: string
          submitter_user_id?: string | null
          tagline: string
          updated_at?: string
          url: string
          use_case?: string | null
        }
        Update: {
          accent_color?: string | null
          contact_email?: string
          created_at?: string
          description?: string | null
          id?: string
          logo_path?: string | null
          name?: string
          published_at?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          screenshot_paths?: string[]
          status?: string
          submitter_user_id?: string | null
          tagline?: string
          updated_at?: string
          url?: string
          use_case?: string | null
        }
        Relationships: []
      }
      applications: {
        Row: {
          application_key: string
          base_url: string | null
          created_at: string
          credit_enabled: boolean
          description: string | null
          governance_enabled: boolean
          id: string
          metadata: Json
          name: string
          status: Database["public"]["Enums"]["application_status"]
          subscription_enabled: boolean
          updated_at: string
        }
        Insert: {
          application_key: string
          base_url?: string | null
          created_at?: string
          credit_enabled?: boolean
          description?: string | null
          governance_enabled?: boolean
          id?: string
          metadata?: Json
          name: string
          status?: Database["public"]["Enums"]["application_status"]
          subscription_enabled?: boolean
          updated_at?: string
        }
        Update: {
          application_key?: string
          base_url?: string | null
          created_at?: string
          credit_enabled?: boolean
          description?: string | null
          governance_enabled?: boolean
          id?: string
          metadata?: Json
          name?: string
          status?: Database["public"]["Enums"]["application_status"]
          subscription_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      checkout_sessions: {
        Row: {
          amount_cents: number
          app: string
          created_at: string
          currency: string
          cycle: string
          error_message: string | null
          id: string
          last_event_at: string | null
          m_payment_id: string
          metadata: Json
          pf_payment_id: string | null
          retry_of_subscription_id: string | null
          return_to: string | null
          sandbox: boolean
          sku: string
          source_ip: string | null
          status: string
          tier: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          amount_cents: number
          app: string
          created_at?: string
          currency?: string
          cycle: string
          error_message?: string | null
          id?: string
          last_event_at?: string | null
          m_payment_id: string
          metadata?: Json
          pf_payment_id?: string | null
          retry_of_subscription_id?: string | null
          return_to?: string | null
          sandbox?: boolean
          sku: string
          source_ip?: string | null
          status?: string
          tier: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          amount_cents?: number
          app?: string
          created_at?: string
          currency?: string
          cycle?: string
          error_message?: string | null
          id?: string
          last_event_at?: string | null
          m_payment_id?: string
          metadata?: Json
          pf_payment_id?: string | null
          retry_of_subscription_id?: string | null
          return_to?: string | null
          sandbox?: boolean
          sku?: string
          source_ip?: string | null
          status?: string
          tier?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ci_alert_config: {
        Row: {
          default_branch_only: boolean
          enabled: boolean
          id: number
          recipient_email: string | null
          repos: string[]
          slack_webhook_url: string | null
          updated_at: string
        }
        Insert: {
          default_branch_only?: boolean
          enabled?: boolean
          id?: number
          recipient_email?: string | null
          repos?: string[]
          slack_webhook_url?: string | null
          updated_at?: string
        }
        Update: {
          default_branch_only?: boolean
          enabled?: boolean
          id?: number
          recipient_email?: string | null
          repos?: string[]
          slack_webhook_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ci_alert_sent: {
        Row: {
          conclusion: string | null
          head_branch: string | null
          html_url: string | null
          repo: string
          run_id: number
          sent_at: string
          workflow_name: string | null
        }
        Insert: {
          conclusion?: string | null
          head_branch?: string | null
          html_url?: string | null
          repo: string
          run_id: number
          sent_at?: string
          workflow_name?: string | null
        }
        Update: {
          conclusion?: string | null
          head_branch?: string | null
          html_url?: string | null
          repo?: string
          run_id?: number
          sent_at?: string
          workflow_name?: string | null
        }
        Relationships: []
      }
      codex_messages: {
        Row: {
          created_at: string
          id: string
          parts: Json
          role: string
          thread_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          parts?: Json
          role: string
          thread_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          parts?: Json
          role?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "codex_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "codex_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      codex_threads: {
        Row: {
          created_at: string
          id: string
          mcp_enabled: boolean
          system_prompt: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mcp_enabled?: boolean
          system_prompt?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mcp_enabled?: boolean
          system_prompt?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      consent_records: {
        Row: {
          created_at: string
          decision: Database["public"]["Enums"]["consent_decision"]
          id: string
          ip_address: unknown
          metadata: Json
          policy_version: string | null
          purpose: Database["public"]["Enums"]["consent_purpose"]
          source: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          decision: Database["public"]["Enums"]["consent_decision"]
          id?: string
          ip_address?: unknown
          metadata?: Json
          policy_version?: string | null
          purpose: Database["public"]["Enums"]["consent_purpose"]
          source?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          decision?: Database["public"]["Enums"]["consent_decision"]
          id?: string
          ip_address?: unknown
          metadata?: Json
          policy_version?: string | null
          purpose?: Database["public"]["Enums"]["consent_purpose"]
          source?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      credit_ledger: {
        Row: {
          app: string
          balance_after: number
          created_at: string
          delta: number
          id: string
          idempotency_key: string
          metadata: Json
          pf_payment_id: string | null
          reason: string
          sku: string | null
          user_id: string
          wallet_id: string
        }
        Insert: {
          app: string
          balance_after: number
          created_at?: string
          delta: number
          id?: string
          idempotency_key: string
          metadata?: Json
          pf_payment_id?: string | null
          reason: string
          sku?: string | null
          user_id: string
          wallet_id: string
        }
        Update: {
          app?: string
          balance_after?: number
          created_at?: string
          delta?: number
          id?: string
          idempotency_key?: string
          metadata?: Json
          pf_payment_id?: string | null
          reason?: string
          sku?: string | null
          user_id?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_ledger_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "credit_wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_reservations: {
        Row: {
          amount: number
          app: string
          completed_at: string | null
          created_at: string
          expires_at: string
          id: string
          idempotency_key: string
          ledger_entry_id: string | null
          metadata: Json
          reason: string
          released_at: string | null
          sku: string | null
          status: string
          updated_at: string
          user_id: string
          wallet_id: string
        }
        Insert: {
          amount: number
          app: string
          completed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          idempotency_key: string
          ledger_entry_id?: string | null
          metadata?: Json
          reason: string
          released_at?: string | null
          sku?: string | null
          status?: string
          updated_at?: string
          user_id: string
          wallet_id: string
        }
        Update: {
          amount?: number
          app?: string
          completed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          idempotency_key?: string
          ledger_entry_id?: string | null
          metadata?: Json
          reason?: string
          released_at?: string | null
          sku?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_reservations_ledger_entry_id_fkey"
            columns: ["ledger_entry_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_reservations_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "credit_wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_wallets: {
        Row: {
          app: string
          balance: number
          created_at: string
          currency: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          app: string
          balance?: number
          created_at?: string
          currency?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          app?: string
          balance?: number
          created_at?: string
          currency?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      data_subject_requests: {
        Row: {
          admin_note: string | null
          artifact_expires_at: string | null
          artifact_url: string | null
          completed_at: string | null
          handled_by: string | null
          id: string
          kind: Database["public"]["Enums"]["dsr_kind"]
          metadata: Json
          reason: string | null
          requested_at: string
          status: Database["public"]["Enums"]["dsr_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          artifact_expires_at?: string | null
          artifact_url?: string | null
          completed_at?: string | null
          handled_by?: string | null
          id?: string
          kind: Database["public"]["Enums"]["dsr_kind"]
          metadata?: Json
          reason?: string | null
          requested_at?: string
          status?: Database["public"]["Enums"]["dsr_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          artifact_expires_at?: string | null
          artifact_url?: string | null
          completed_at?: string | null
          handled_by?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["dsr_kind"]
          metadata?: Json
          reason?: string | null
          requested_at?: string
          status?: Database["public"]["Enums"]["dsr_status"]
          updated_at?: string
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
      entitlement_log: {
        Row: {
          app: string
          created_at: string
          error: string | null
          id: string
          source: string | null
          source_ip: string | null
          status: string
          tier: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          app: string
          created_at?: string
          error?: string | null
          id?: string
          source?: string | null
          source_ip?: string | null
          status: string
          tier?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          app?: string
          created_at?: string
          error?: string | null
          id?: string
          source?: string | null
          source_ip?: string | null
          status?: string
          tier?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      entitlements: {
        Row: {
          application_key: string
          created_at: string
          expires_at: string | null
          granted_at: string
          id: string
          metadata: Json
          organisation_id: string | null
          revoked_at: string | null
          revoked_reason: string | null
          source: string
          source_ref: string | null
          tier: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          application_key: string
          created_at?: string
          expires_at?: string | null
          granted_at?: string
          id?: string
          metadata?: Json
          organisation_id?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
          source: string
          source_ref?: string | null
          tier: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          application_key?: string
          created_at?: string
          expires_at?: string | null
          granted_at?: string
          id?: string
          metadata?: Json
          organisation_id?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
          source?: string
          source_ref?: string | null
          tier?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entitlements_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          created_at: string
          description: string | null
          enabled: boolean
          flag_key: string
          id: string
          metadata: Json
          rollout_percent: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          flag_key: string
          id?: string
          metadata?: Json
          rollout_percent?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          flag_key?: string
          id?: string
          metadata?: Json
          rollout_percent?: number
          updated_at?: string
        }
        Relationships: []
      }
      governance_events: {
        Row: {
          action: string
          actor_user_id: string | null
          article_ref: string | null
          created_at: string
          id: string
          metadata: Json
          note: string | null
          proposal_id: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          article_ref?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          note?: string | null
          proposal_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          article_ref?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          note?: string | null
          proposal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "governance_events_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "governance_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_proposals: {
        Row: {
          article_ref: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string
          metadata: Json
          proposed_by: string
          rationale: string | null
          status: Database["public"]["Enums"]["governance_proposal_status"]
          summary: string
          superseded_by: string | null
          title: string
          updated_at: string
          version: string
        }
        Insert: {
          article_ref?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          metadata?: Json
          proposed_by: string
          rationale?: string | null
          status?: Database["public"]["Enums"]["governance_proposal_status"]
          summary: string
          superseded_by?: string | null
          title: string
          updated_at?: string
          version?: string
        }
        Update: {
          article_ref?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          metadata?: Json
          proposed_by?: string
          rationale?: string | null
          status?: Database["public"]["Enums"]["governance_proposal_status"]
          summary?: string
          superseded_by?: string | null
          title?: string
          updated_at?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "governance_proposals_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "governance_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      hub_app_access: {
        Row: {
          app_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          app_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          app_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hub_app_access_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "hub_apps"
            referencedColumns: ["id"]
          },
        ]
      }
      hub_apps: {
        Row: {
          control_enabled: boolean
          control_path: string
          created_at: string
          created_by: string | null
          id: string
          last_health_at: string | null
          last_health_detail: Json | null
          last_health_status: string | null
          last_push_at: string | null
          last_push_status: string | null
          metadata: Json
          name: string
          origin_url: string | null
          signing_key_hash: string
          signing_key_prefix: string
          slug: string
          status: string
          updated_at: string
          validate_path: string
          workspace_id: string | null
        }
        Insert: {
          control_enabled?: boolean
          control_path?: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_health_at?: string | null
          last_health_detail?: Json | null
          last_health_status?: string | null
          last_push_at?: string | null
          last_push_status?: string | null
          metadata?: Json
          name: string
          origin_url?: string | null
          signing_key_hash: string
          signing_key_prefix: string
          slug: string
          status?: string
          updated_at?: string
          validate_path?: string
          workspace_id?: string | null
        }
        Update: {
          control_enabled?: boolean
          control_path?: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_health_at?: string | null
          last_health_detail?: Json | null
          last_health_status?: string | null
          last_push_at?: string | null
          last_push_status?: string | null
          metadata?: Json
          name?: string
          origin_url?: string | null
          signing_key_hash?: string
          signing_key_prefix?: string
          slug?: string
          status?: string
          updated_at?: string
          validate_path?: string
          workspace_id?: string | null
        }
        Relationships: []
      }
      hub_audit_events: {
        Row: {
          actor_kind: string
          actor_user_id: string | null
          app_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          event_type: string
          id: number
          payload: Json
        }
        Insert: {
          actor_kind: string
          actor_user_id?: string | null
          app_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type: string
          id?: number
          payload?: Json
        }
        Update: {
          actor_kind?: string
          actor_user_id?: string | null
          app_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string
          id?: number
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "hub_audit_events_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "hub_apps"
            referencedColumns: ["id"]
          },
        ]
      }
      hub_control_deliveries: {
        Row: {
          app_id: string
          created_at: string
          duration_ms: number | null
          error: string | null
          http_status: number | null
          id: string
          kind: string
          request_body: Json | null
          response_body: Json | null
          status: string
        }
        Insert: {
          app_id: string
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          http_status?: number | null
          id?: string
          kind: string
          request_body?: Json | null
          response_body?: Json | null
          status: string
        }
        Update: {
          app_id?: string
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          http_status?: number | null
          id?: string
          kind?: string
          request_body?: Json | null
          response_body?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "hub_control_deliveries_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "hub_apps"
            referencedColumns: ["id"]
          },
        ]
      }
      hub_outcomes: {
        Row: {
          app_id: string
          baseline_value: number | null
          created_at: string
          delta_pct: number | null
          id: string
          metric: string
          notes: string | null
          observed_value: number | null
          sample_size: number | null
          suggestion_id: string
          verdict: Database["public"]["Enums"]["hub_outcome_verdict"]
          window_end: string
          window_start: string
        }
        Insert: {
          app_id: string
          baseline_value?: number | null
          created_at?: string
          delta_pct?: number | null
          id?: string
          metric: string
          notes?: string | null
          observed_value?: number | null
          sample_size?: number | null
          suggestion_id: string
          verdict?: Database["public"]["Enums"]["hub_outcome_verdict"]
          window_end: string
          window_start: string
        }
        Update: {
          app_id?: string
          baseline_value?: number | null
          created_at?: string
          delta_pct?: number | null
          id?: string
          metric?: string
          notes?: string | null
          observed_value?: number | null
          sample_size?: number | null
          suggestion_id?: string
          verdict?: Database["public"]["Enums"]["hub_outcome_verdict"]
          window_end?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "hub_outcomes_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "hub_apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_outcomes_suggestion_id_fkey"
            columns: ["suggestion_id"]
            isOneToOne: false
            referencedRelation: "hub_suggestions"
            referencedColumns: ["id"]
          },
        ]
      }
      hub_perf_events: {
        Row: {
          app_id: string
          client_ts: string
          event_type: string
          id: number
          ingested_at: string
          metric: string | null
          scope: string | null
          tags: Json
          value_num: number | null
          value_text: string | null
        }
        Insert: {
          app_id: string
          client_ts: string
          event_type: string
          id?: number
          ingested_at?: string
          metric?: string | null
          scope?: string | null
          tags?: Json
          value_num?: number | null
          value_text?: string | null
        }
        Update: {
          app_id?: string
          client_ts?: string
          event_type?: string
          id?: number
          ingested_at?: string
          metric?: string | null
          scope?: string | null
          tags?: Json
          value_num?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hub_perf_events_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "hub_apps"
            referencedColumns: ["id"]
          },
        ]
      }
      hub_suggestions: {
        Row: {
          admin_note: string | null
          app_id: string | null
          applied_at: string | null
          approved_at: string | null
          broadcast: boolean
          confidence: number | null
          created_by: string | null
          evidence: Json
          id: string
          proposed_at: string
          proposed_change: Json
          rationale: string
          rejected_at: string | null
          reverted_at: string | null
          source: Database["public"]["Enums"]["hub_suggestion_source"]
          status: Database["public"]["Enums"]["hub_suggestion_status"]
          superseded_by: string | null
          target_scope: string
          title: string
          updated_at: string
        }
        Insert: {
          admin_note?: string | null
          app_id?: string | null
          applied_at?: string | null
          approved_at?: string | null
          broadcast?: boolean
          confidence?: number | null
          created_by?: string | null
          evidence?: Json
          id?: string
          proposed_at?: string
          proposed_change: Json
          rationale: string
          rejected_at?: string | null
          reverted_at?: string | null
          source: Database["public"]["Enums"]["hub_suggestion_source"]
          status?: Database["public"]["Enums"]["hub_suggestion_status"]
          superseded_by?: string | null
          target_scope: string
          title: string
          updated_at?: string
        }
        Update: {
          admin_note?: string | null
          app_id?: string | null
          applied_at?: string | null
          approved_at?: string | null
          broadcast?: boolean
          confidence?: number | null
          created_by?: string | null
          evidence?: Json
          id?: string
          proposed_at?: string
          proposed_change?: Json
          rationale?: string
          rejected_at?: string | null
          reverted_at?: string | null
          source?: Database["public"]["Enums"]["hub_suggestion_source"]
          status?: Database["public"]["Enums"]["hub_suggestion_status"]
          superseded_by?: string | null
          target_scope?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hub_suggestions_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "hub_apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_suggestions_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "hub_suggestions"
            referencedColumns: ["id"]
          },
        ]
      }
      hub_tunables: {
        Row: {
          app_id: string
          applied_at: string
          applied_by: string | null
          applied_from: string | null
          id: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          app_id: string
          applied_at?: string
          applied_by?: string | null
          applied_from?: string | null
          id?: string
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          app_id?: string
          applied_at?: string
          applied_by?: string | null
          applied_from?: string | null
          id?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "hub_tunables_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "hub_apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_tunables_applied_from_fkey"
            columns: ["applied_from"]
            isOneToOne: false
            referencedRelation: "hub_suggestions"
            referencedColumns: ["id"]
          },
        ]
      }
      hub_user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["hub_app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["hub_app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["hub_app_role"]
          user_id?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          amount_cents: number
          app: string | null
          billing_cycle: string | null
          created_at: string
          currency: string
          id: string
          issued_at: string
          m_payment_id: string | null
          metadata: Json
          number: string
          pdf_path: string | null
          pf_payment_id: string | null
          provider: string
          recipient_email: string | null
          refunded_at: string | null
          sku: string | null
          status: string
          subscription_id: string | null
          tier: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          app?: string | null
          billing_cycle?: string | null
          created_at?: string
          currency?: string
          id?: string
          issued_at?: string
          m_payment_id?: string | null
          metadata?: Json
          number: string
          pdf_path?: string | null
          pf_payment_id?: string | null
          provider?: string
          recipient_email?: string | null
          refunded_at?: string | null
          sku?: string | null
          status: string
          subscription_id?: string | null
          tier?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          app?: string | null
          billing_cycle?: string | null
          created_at?: string
          currency?: string
          id?: string
          issued_at?: string
          m_payment_id?: string | null
          metadata?: Json
          number?: string
          pdf_path?: string | null
          pf_payment_id?: string | null
          provider?: string
          recipient_email?: string | null
          refunded_at?: string | null
          sku?: string | null
          status?: string
          subscription_id?: string | null
          tier?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      newsletter_subscribers: {
        Row: {
          created_at: string
          email: string
          id: string
          source: string | null
          source_ip: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          source?: string | null
          source_ip?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          source?: string | null
          source_ip?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      organisation_members: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          metadata: Json
          organisation_id: string
          role: Database["public"]["Enums"]["org_member_role"]
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          metadata?: Json
          organisation_id: string
          role?: Database["public"]["Enums"]["org_member_role"]
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          metadata?: Json
          organisation_id?: string
          role?: Database["public"]["Enums"]["org_member_role"]
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organisation_members_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      organisations: {
        Row: {
          billing_email: string | null
          country_code: string | null
          created_at: string
          id: string
          metadata: Json
          name: string
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          billing_email?: string | null
          country_code?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          name: string
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          billing_email?: string | null
          country_code?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          slug?: string
          status?: string
          updated_at?: string
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
      payfast_launch_logs: {
        Row: {
          action_url: string
          amount_cents: number
          created_at: string
          currency: string
          id: string
          m_payment_id: string
          return_to: string | null
          sandbox: boolean
          sku: string
          source_ip: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          action_url: string
          amount_cents: number
          created_at?: string
          currency?: string
          id?: string
          m_payment_id: string
          return_to?: string | null
          sandbox?: boolean
          sku: string
          source_ip?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          action_url?: string
          amount_cents?: number
          created_at?: string
          currency?: string
          id?: string
          m_payment_id?: string
          return_to?: string | null
          sandbox?: boolean
          sku?: string
          source_ip?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      payment_events: {
        Row: {
          amount_cents: number | null
          created_at: string
          event_type: string
          http_status: number | null
          id: string
          m_payment_id: string | null
          metadata: Json
          outcome: string | null
          payment_status: string | null
          pf_payment_id: string | null
          provider: string
          raw_payload: Json | null
          session_id: string | null
          source_ip: string | null
          user_id: string | null
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string
          event_type: string
          http_status?: number | null
          id?: string
          m_payment_id?: string | null
          metadata?: Json
          outcome?: string | null
          payment_status?: string | null
          pf_payment_id?: string | null
          provider?: string
          raw_payload?: Json | null
          session_id?: string | null
          source_ip?: string | null
          user_id?: string | null
        }
        Update: {
          amount_cents?: number | null
          created_at?: string
          event_type?: string
          http_status?: number | null
          id?: string
          m_payment_id?: string | null
          metadata?: Json
          outcome?: string | null
          payment_status?: string | null
          pf_payment_id?: string | null
          provider?: string
          raw_payload?: Json | null
          session_id?: string | null
          source_ip?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "checkout_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_changes: {
        Row: {
          change_type: string
          created_at: string
          from_app: string | null
          from_sub_id: string | null
          from_tier: string | null
          id: string
          pf_payment_id: string | null
          reason: string | null
          to_app: string
          to_sub_id: string | null
          to_tier: string
          user_id: string
        }
        Insert: {
          change_type: string
          created_at?: string
          from_app?: string | null
          from_sub_id?: string | null
          from_tier?: string | null
          id?: string
          pf_payment_id?: string | null
          reason?: string | null
          to_app: string
          to_sub_id?: string | null
          to_tier: string
          user_id: string
        }
        Update: {
          change_type?: string
          created_at?: string
          from_app?: string | null
          from_sub_id?: string | null
          from_tier?: string | null
          id?: string
          pf_payment_id?: string | null
          reason?: string | null
          to_app?: string
          to_sub_id?: string | null
          to_tier?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_changes_from_sub_id_fkey"
            columns: ["from_sub_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_changes_to_sub_id_fkey"
            columns: ["to_sub_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      privacy_policy_versions: {
        Row: {
          created_at: string
          effective_at: string
          summary: string
          url: string
          version: string
        }
        Insert: {
          created_at?: string
          effective_at?: string
          summary: string
          url: string
          version: string
        }
        Update: {
          created_at?: string
          effective_at?: string
          summary?: string
          url?: string
          version?: string
        }
        Relationships: []
      }
      product_application_rules: {
        Row: {
          access_level: string
          application_id: string
          capability_key: string | null
          created_at: string
          credit_multiplier: number
          enabled: boolean
          id: string
          included_usage: number
          metadata: Json
          product_id: string
          updated_at: string
        }
        Insert: {
          access_level?: string
          application_id: string
          capability_key?: string | null
          created_at?: string
          credit_multiplier?: number
          enabled?: boolean
          id?: string
          included_usage?: number
          metadata?: Json
          product_id: string
          updated_at?: string
        }
        Update: {
          access_level?: string
          application_id?: string
          capability_key?: string | null
          created_at?: string
          credit_multiplier?: number
          enabled?: boolean
          id?: string
          included_usage?: number
          metadata?: Json
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_application_rules_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_application_rules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          billing_interval: string | null
          created_at: string
          currency: string
          description: string | null
          effective_from: string | null
          effective_to: string | null
          id: string
          included_credits: number
          metadata: Json
          name: string
          price_cents: number
          product_key: string
          product_type: Database["public"]["Enums"]["product_type"]
          status: Database["public"]["Enums"]["product_status"]
          updated_at: string
        }
        Insert: {
          billing_interval?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          included_credits?: number
          metadata?: Json
          name: string
          price_cents?: number
          product_key: string
          product_type: Database["public"]["Enums"]["product_type"]
          status?: Database["public"]["Enums"]["product_status"]
          updated_at?: string
        }
        Update: {
          billing_interval?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          included_credits?: number
          metadata?: Json
          name?: string
          price_cents?: number
          product_key?: string
          product_type?: Database["public"]["Enums"]["product_type"]
          status?: Database["public"]["Enums"]["product_status"]
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          country_code: string | null
          created_at: string
          display_name: string | null
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          onboarding_status: Database["public"]["Enums"]["onboarding_status"]
          phone: string | null
          preferred_currency: string
          timezone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          country_code?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          onboarding_status?: Database["public"]["Enums"]["onboarding_status"]
          phone?: string | null
          preferred_currency?: string
          timezone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          country_code?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          onboarding_status?: Database["public"]["Enums"]["onboarding_status"]
          phone?: string | null
          preferred_currency?: string
          timezone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      site_visits: {
        Row: {
          created_at: string
          id: string
          path: string
          referrer: string | null
          session_id: string | null
          source_ip: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          path: string
          referrer?: string | null
          session_id?: string | null
          source_ip?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          path?: string
          referrer?: string | null
          session_id?: string | null
          source_ip?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      sku_catalogue: {
        Row: {
          amount_cents: number
          app: string
          billing_type: Database["public"]["Enums"]["sku_billing_type"]
          catalogue_version: number
          created_at: string
          credit_expiry_days: number | null
          credits_granted: number
          currency: string
          intended_user: string
          kind: Database["public"]["Enums"]["sku_kind"]
          label: string
          metadata: Json
          refund_rule: string
          short_description: string
          sku_id: string
          status: Database["public"]["Enums"]["sku_status"]
          terms_version: string
          updated_at: string
          vat_cents: number
        }
        Insert: {
          amount_cents: number
          app: string
          billing_type: Database["public"]["Enums"]["sku_billing_type"]
          catalogue_version?: number
          created_at?: string
          credit_expiry_days?: number | null
          credits_granted?: number
          currency?: string
          intended_user?: string
          kind: Database["public"]["Enums"]["sku_kind"]
          label: string
          metadata?: Json
          refund_rule?: string
          short_description?: string
          sku_id: string
          status?: Database["public"]["Enums"]["sku_status"]
          terms_version?: string
          updated_at?: string
          vat_cents?: number
        }
        Update: {
          amount_cents?: number
          app?: string
          billing_type?: Database["public"]["Enums"]["sku_billing_type"]
          catalogue_version?: number
          created_at?: string
          credit_expiry_days?: number | null
          credits_granted?: number
          currency?: string
          intended_user?: string
          kind?: Database["public"]["Enums"]["sku_kind"]
          label?: string
          metadata?: Json
          refund_rule?: string
          short_description?: string
          sku_id?: string
          status?: Database["public"]["Enums"]["sku_status"]
          terms_version?: string
          updated_at?: string
          vat_cents?: number
        }
        Relationships: []
      }
      sku_costs: {
        Row: {
          cost_cents: number
          created_at: string
          currency: string
          notes: string | null
          sku: string
          updated_at: string
        }
        Insert: {
          cost_cents?: number
          created_at?: string
          currency?: string
          notes?: string | null
          sku: string
          updated_at?: string
        }
        Update: {
          cost_cents?: number
          created_at?: string
          currency?: string
          notes?: string | null
          sku?: string
          updated_at?: string
        }
        Relationships: []
      }
      sku_lifecycle_log: {
        Row: {
          actor_user_id: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["sku_status"] | null
          id: string
          reason: string
          sku_id: string
          to_status: Database["public"]["Enums"]["sku_status"]
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["sku_status"] | null
          id?: string
          reason: string
          sku_id: string
          to_status: Database["public"]["Enums"]["sku_status"]
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["sku_status"] | null
          id?: string
          reason?: string
          sku_id?: string
          to_status?: Database["public"]["Enums"]["sku_status"]
        }
        Relationships: [
          {
            foreignKeyName: "sku_lifecycle_log_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "sku_catalogue"
            referencedColumns: ["sku_id"]
          },
        ]
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
          cancel_at_period_end: boolean
          cancelled_at: string | null
          created_at: string
          currency: string
          current_period_end: string | null
          grace_period_ends_at: string | null
          id: string
          payfast_payment_id: string | null
          payfast_token: string | null
          product_id: string | null
          status: Database["public"]["Enums"]["subscription_status"]
          superseded_at: string | null
          superseded_by: string | null
          tier: Database["public"]["Enums"]["subscription_tier"]
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_cents?: number
          app: Database["public"]["Enums"]["subscription_app"]
          billing_cycle?: string
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          created_at?: string
          currency?: string
          current_period_end?: string | null
          grace_period_ends_at?: string | null
          id?: string
          payfast_payment_id?: string | null
          payfast_token?: string | null
          product_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          superseded_at?: string | null
          superseded_by?: string | null
          tier: Database["public"]["Enums"]["subscription_tier"]
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          app?: Database["public"]["Enums"]["subscription_app"]
          billing_cycle?: string
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          created_at?: string
          currency?: string
          current_period_end?: string | null
          grace_period_ends_at?: string | null
          id?: string
          payfast_payment_id?: string | null
          payfast_token?: string | null
          product_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          superseded_at?: string | null
          superseded_by?: string | null
          tier?: Database["public"]["Enums"]["subscription_tier"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
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
      webhook_events: {
        Row: {
          event_id: string
          first_seen_at: string
          http_status: number | null
          id: string
          metadata: Json
          outcome: string | null
          payload_hash: string
          processed_at: string | null
          provider: string
          response_body: string | null
        }
        Insert: {
          event_id: string
          first_seen_at?: string
          http_status?: number | null
          id?: string
          metadata?: Json
          outcome?: string | null
          payload_hash: string
          processed_at?: string | null
          provider: string
          response_body?: string | null
        }
        Update: {
          event_id?: string
          first_seen_at?: string
          http_status?: number | null
          id?: string
          metadata?: Json
          outcome?: string | null
          payload_hash?: string
          processed_at?: string | null
          provider?: string
          response_body?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      consent_current: {
        Row: {
          created_at: string | null
          decision: Database["public"]["Enums"]["consent_decision"] | null
          policy_version: string | null
          purpose: Database["public"]["Enums"]["consent_purpose"] | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      complete_reservation: {
        Args: { _reservation_id: string }
        Returns: {
          amount: number
          app: string
          completed_at: string | null
          created_at: string
          expires_at: string
          id: string
          idempotency_key: string
          ledger_entry_id: string | null
          metadata: Json
          reason: string
          released_at: string | null
          sku: string | null
          status: string
          updated_at: string
          user_id: string
          wallet_id: string
        }
        SetofOptions: {
          from: "*"
          to: "credit_reservations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      expire_stale_reservations: { Args: never; Returns: number }
      expire_stale_subscriptions: {
        Args: { _grace_days?: number }
        Returns: {
          cancelled_after_grace: number
          cancelled_at_period_end: number
          moved_to_past_due: number
        }[]
      }
      grant_pack_credits: {
        Args: {
          _amount: number
          _app: string
          _idempotency_key: string
          _metadata?: Json
          _pf_payment_id: string
          _sku: string
          _user_id: string
        }
        Returns: {
          app: string
          balance_after: number
          created_at: string
          delta: number
          id: string
          idempotency_key: string
          metadata: Json
          pf_payment_id: string | null
          reason: string
          sku: string | null
          user_id: string
          wallet_id: string
        }
        SetofOptions: {
          from: "*"
          to: "credit_ledger"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      hub_has_role: {
        Args: {
          _role: Database["public"]["Enums"]["hub_app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      hub_user_app_access: {
        Args: { _app_id: string; _user_id: string }
        Returns: boolean
      }
      is_org_admin: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      is_org_member: {
        Args: { _org_id: string; _user_id: string }
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
      recon_orphan_entitlements: {
        Args: never
        Returns: {
          application_key: string
          entitlement_id: string
          granted_at: string
          source_ref: string
          tier: string
          user_id: string
        }[]
      }
      recon_orphan_subscriptions: {
        Args: never
        Returns: {
          app: string
          current_period_end: string
          status: string
          subscription_id: string
          tier: string
          user_id: string
        }[]
      }
      recon_stale_reservations: {
        Args: never
        Returns: {
          age_seconds: number
          amount: number
          app: string
          expires_at: string
          reason: string
          reservation_id: string
          user_id: string
        }[]
      }
      recon_summary: {
        Args: never
        Returns: {
          orphan_entitlements_count: number
          orphan_subscriptions_count: number
          stale_reservations_count: number
          unposted_itns_count: number
          wallet_drift_count: number
        }[]
      }
      recon_unposted_itns: {
        Args: never
        Returns: {
          amount_cents: number
          itn_id: string
          payment_status: string
          pf_payment_id: string
          received_at: string
          sku: string
          user_id: string
        }[]
      }
      recon_wallet_drift: {
        Args: never
        Returns: {
          app: string
          drift: number
          ledger_balance: number
          recorded_balance: number
          user_id: string
          wallet_id: string
        }[]
      }
      release_reservation: {
        Args: { _reason?: string; _reservation_id: string }
        Returns: {
          amount: number
          app: string
          completed_at: string | null
          created_at: string
          expires_at: string
          id: string
          idempotency_key: string
          ledger_entry_id: string | null
          metadata: Json
          reason: string
          released_at: string | null
          sku: string | null
          status: string
          updated_at: string
          user_id: string
          wallet_id: string
        }
        SetofOptions: {
          from: "*"
          to: "credit_reservations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reserve_credits: {
        Args: {
          _amount: number
          _app: string
          _idempotency_key: string
          _metadata?: Json
          _reason: string
          _sku: string
          _user_id: string
        }
        Returns: {
          amount: number
          app: string
          completed_at: string | null
          created_at: string
          expires_at: string
          id: string
          idempotency_key: string
          ledger_entry_id: string | null
          metadata: Json
          reason: string
          released_at: string | null
          sku: string | null
          status: string
          updated_at: string
          user_id: string
          wallet_id: string
        }
        SetofOptions: {
          from: "*"
          to: "credit_reservations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_sku_for_purchase: {
        Args: { _sku_id: string; _user_id: string }
        Returns: {
          amount_cents: number
          app: string
          billing_type: Database["public"]["Enums"]["sku_billing_type"]
          catalogue_version: number
          credits_granted: number
          currency: string
          grandfathered: boolean
          kind: Database["public"]["Enums"]["sku_kind"]
          label: string
          sku_id: string
          status: Database["public"]["Enums"]["sku_status"]
          terms_version: string
          vat_cents: number
        }[]
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "user"
        | "billing_manager"
        | "institutional_manager"
        | "viewer"
      application_status: "active" | "beta" | "hidden" | "retired"
      consent_decision: "granted" | "withdrawn"
      consent_purpose: "essential" | "analytics" | "marketing" | "ai_training"
      dsr_kind: "export" | "erasure" | "rectification"
      dsr_status: "pending" | "in_progress" | "completed" | "rejected"
      governance_proposal_status:
        | "draft"
        | "review"
        | "approved"
        | "rejected"
        | "superseded"
        | "withdrawn"
      hub_app_role: "hub_admin" | "app_owner"
      hub_outcome_verdict: "improved" | "neutral" | "regressed" | "inconclusive"
      hub_suggestion_source: "rule" | "ai" | "cross_app" | "manual"
      hub_suggestion_status:
        | "pending"
        | "approved"
        | "applied"
        | "reverted"
        | "rejected"
        | "superseded"
      onboarding_status: "pending" | "in_progress" | "complete"
      org_member_role:
        | "owner"
        | "administrator"
        | "billing_manager"
        | "member"
        | "viewer"
        | "institutional_manager"
      product_status: "draft" | "active" | "retired"
      product_type:
        | "credit_package"
        | "subscription"
        | "institutional_plan"
        | "promotional_credit"
        | "add_on"
      sku_billing_type: "once" | "monthly" | "quote"
      sku_kind: "pack" | "pass" | "legacy_monthly" | "custom_quote"
      sku_status: "draft" | "active" | "grandfathered" | "retired" | "disabled"
      subscription_app:
        | "epublisher"
        | "creative_studio"
        | "sync_vision"
        | "youtube_optimizer"
        | "all_access"
        | "career_compass"
      subscription_status: "pending" | "active" | "past_due" | "cancelled"
      subscription_tier:
        | "free"
        | "starter"
        | "creator"
        | "pro"
        | "business"
        | "all_access"
        | "creator_pass"
        | "studio_pass"
        | "business_pass"
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
      app_role: [
        "admin",
        "user",
        "billing_manager",
        "institutional_manager",
        "viewer",
      ],
      application_status: ["active", "beta", "hidden", "retired"],
      consent_decision: ["granted", "withdrawn"],
      consent_purpose: ["essential", "analytics", "marketing", "ai_training"],
      dsr_kind: ["export", "erasure", "rectification"],
      dsr_status: ["pending", "in_progress", "completed", "rejected"],
      governance_proposal_status: [
        "draft",
        "review",
        "approved",
        "rejected",
        "superseded",
        "withdrawn",
      ],
      hub_app_role: ["hub_admin", "app_owner"],
      hub_outcome_verdict: ["improved", "neutral", "regressed", "inconclusive"],
      hub_suggestion_source: ["rule", "ai", "cross_app", "manual"],
      hub_suggestion_status: [
        "pending",
        "approved",
        "applied",
        "reverted",
        "rejected",
        "superseded",
      ],
      onboarding_status: ["pending", "in_progress", "complete"],
      org_member_role: [
        "owner",
        "administrator",
        "billing_manager",
        "member",
        "viewer",
        "institutional_manager",
      ],
      product_status: ["draft", "active", "retired"],
      product_type: [
        "credit_package",
        "subscription",
        "institutional_plan",
        "promotional_credit",
        "add_on",
      ],
      sku_billing_type: ["once", "monthly", "quote"],
      sku_kind: ["pack", "pass", "legacy_monthly", "custom_quote"],
      sku_status: ["draft", "active", "grandfathered", "retired", "disabled"],
      subscription_app: [
        "epublisher",
        "creative_studio",
        "sync_vision",
        "youtube_optimizer",
        "all_access",
        "career_compass",
      ],
      subscription_status: ["pending", "active", "past_due", "cancelled"],
      subscription_tier: [
        "free",
        "starter",
        "creator",
        "pro",
        "business",
        "all_access",
        "creator_pass",
        "studio_pass",
        "business_pass",
      ],
    },
  },
} as const
