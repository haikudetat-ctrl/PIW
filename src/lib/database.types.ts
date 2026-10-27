export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      activeprospect_intake_receipts: {
        Row: {
          appointment_type: string
          company_id: string
          contact_owner: string
          event_id: string | null
          external_lead_id: string
          flow_id: string
          id: string
          is_test: boolean
          lead_id: string | null
          payload: Json
          received_at: string
          state: string
        }
        Insert: {
          appointment_type: string
          company_id: string
          contact_owner: string
          event_id?: string | null
          external_lead_id: string
          flow_id: string
          id?: string
          is_test: boolean
          lead_id?: string | null
          payload: Json
          received_at?: string
          state: string
        }
        Update: {
          appointment_type?: string
          company_id?: string
          contact_owner?: string
          event_id?: string | null
          external_lead_id?: string
          flow_id?: string
          id?: string
          is_test?: boolean
          lead_id?: string | null
          payload?: Json
          received_at?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "activeprospect_intake_receipts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activeprospect_intake_receipts_company_id_lead_id_fkey"
            columns: ["company_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "activeprospect_intake_receipts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "domain_events"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_conversion_deliveries: {
        Row: {
          attempt_count: number
          company_id: string
          conversion_time: string
          conversion_value: number | null
          created_at: string
          event_name: string
          http_status: number | null
          id: string
          last_attempted_at: string | null
          last_error_category: string | null
          last_validated_at: string | null
          lead_id: string
          next_attempt_at: string
          order_id: string
          payload_hash: string | null
          platform: string
          request_id: string | null
          retracted_at: string | null
          retraction_attempt_count: number
          retraction_reason: string | null
          retraction_status: string
          sent_at: string | null
          sent_with_identifiers: boolean | null
          sent_with_value: boolean | null
          skip_reason: string | null
          source_ref: string
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          company_id: string
          conversion_time: string
          conversion_value?: number | null
          created_at?: string
          event_name: string
          http_status?: number | null
          id?: string
          last_attempted_at?: string | null
          last_error_category?: string | null
          last_validated_at?: string | null
          lead_id: string
          next_attempt_at?: string
          order_id: string
          payload_hash?: string | null
          platform?: string
          request_id?: string | null
          retracted_at?: string | null
          retraction_attempt_count?: number
          retraction_reason?: string | null
          retraction_status?: string
          sent_at?: string | null
          sent_with_identifiers?: boolean | null
          sent_with_value?: boolean | null
          skip_reason?: string | null
          source_ref: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          company_id?: string
          conversion_time?: string
          conversion_value?: number | null
          created_at?: string
          event_name?: string
          http_status?: number | null
          id?: string
          last_attempted_at?: string | null
          last_error_category?: string | null
          last_validated_at?: string | null
          lead_id?: string
          next_attempt_at?: string
          order_id?: string
          payload_hash?: string | null
          platform?: string
          request_id?: string | null
          retracted_at?: string | null
          retraction_attempt_count?: number
          retraction_reason?: string | null
          retraction_status?: string
          sent_at?: string | null
          sent_with_identifiers?: boolean | null
          sent_with_value?: boolean | null
          skip_reason?: string | null
          source_ref?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_conversion_deliveries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_conversion_deliveries_company_id_lead_id_fkey"
            columns: ["company_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      ad_spend_daily: {
        Row: {
          ad_group_id: string
          ad_group_name: string | null
          campaign_id: string
          campaign_name: string | null
          clicks: number
          company_id: string
          cost_micros: number
          criterion_id: string
          currency_code: string
          grain: string
          imported_at: string
          impressions: number
          keyword_text: string | null
          match_type: string | null
          platform: string
          platform_conversions: number
          spend_date: string
        }
        Insert: {
          ad_group_id?: string
          ad_group_name?: string | null
          campaign_id: string
          campaign_name?: string | null
          clicks?: number
          company_id: string
          cost_micros?: number
          criterion_id?: string
          currency_code?: string
          grain: string
          imported_at?: string
          impressions?: number
          keyword_text?: string | null
          match_type?: string | null
          platform?: string
          platform_conversions?: number
          spend_date: string
        }
        Update: {
          ad_group_id?: string
          ad_group_name?: string | null
          campaign_id?: string
          campaign_name?: string | null
          clicks?: number
          company_id?: string
          cost_micros?: number
          criterion_id?: string
          currency_code?: string
          grain?: string
          imported_at?: string
          impressions?: number
          keyword_text?: string | null
          match_type?: string | null
          platform?: string
          platform_conversions?: number
          spend_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_spend_daily_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_spend_import_runs: {
        Row: {
          company_id: string
          date_from: string
          date_to: string
          error_category: string | null
          finished_at: string | null
          id: string
          platform: string
          rows_upserted: number | null
          started_at: string
          status: string
        }
        Insert: {
          company_id: string
          date_from: string
          date_to: string
          error_category?: string | null
          finished_at?: string | null
          id?: string
          platform?: string
          rows_upserted?: number | null
          started_at?: string
          status?: string
        }
        Update: {
          company_id?: string
          date_from?: string
          date_to?: string
          error_category?: string | null
          finished_at?: string | null
          id?: string
          platform?: string
          rows_upserted?: number | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_spend_import_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_profiles: {
        Row: {
          company_id: string
          created_at: string
          display_name: string
          id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          display_name: string
          id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          display_name?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_content_cache: {
        Row: {
          approval_status: string
          content_type: string
          context_key: string
          created_at: string
          embedding: string | null
          generated_text: string
          id: string
          last_used_at: string | null
          updated_at: string
        }
        Insert: {
          approval_status?: string
          content_type: string
          context_key: string
          created_at?: string
          embedding?: string | null
          generated_text: string
          id?: string
          last_used_at?: string | null
          updated_at?: string
        }
        Update: {
          approval_status?: string
          content_type?: string
          context_key?: string
          created_at?: string
          embedding?: string | null
          generated_text?: string
          id?: string
          last_used_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      appointment_rep_intros: {
        Row: {
          appointment_id: string
          company_id: string
          composed_body: string
          composed_subject: string
          created_at: string
          id: string
          rep_id: string
          scheduled_for: string
          sent_at: string | null
          status: Database["public"]["Enums"]["appointment_rep_intro_status"]
        }
        Insert: {
          appointment_id: string
          company_id: string
          composed_body: string
          composed_subject: string
          created_at?: string
          id?: string
          rep_id: string
          scheduled_for: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["appointment_rep_intro_status"]
        }
        Update: {
          appointment_id?: string
          company_id?: string
          composed_body?: string
          composed_subject?: string
          created_at?: string
          id?: string
          rep_id?: string
          scheduled_for?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["appointment_rep_intro_status"]
        }
        Relationships: [
          {
            foreignKeyName: "appointment_rep_intros_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_rep_intros_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_rep_intros_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "reps"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          attendee_email: string | null
          booking_link_id: string | null
          booking_source: string | null
          calendar_event_id: string | null
          calendar_sync_error: string | null
          calendar_sync_status: string | null
          calendar_synced_at: string | null
          calendar_synced_revision: number | null
          cancelled_at: string | null
          cancelled_by: string | null
          company_id: string
          created_at: string
          created_by: string | null
          customer_notes: string | null
          duration_minutes: number | null
          id: string
          lead_id: string
          meeting_type: string | null
          meeting_url: string | null
          notes: string | null
          rep_id: string | null
          reschedule_count: number
          revision: number
          scheduled_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        Insert: {
          attendee_email?: string | null
          booking_link_id?: string | null
          booking_source?: string | null
          calendar_event_id?: string | null
          calendar_sync_error?: string | null
          calendar_sync_status?: string | null
          calendar_synced_at?: string | null
          calendar_synced_revision?: number | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          customer_notes?: string | null
          duration_minutes?: number | null
          id?: string
          lead_id: string
          meeting_type?: string | null
          meeting_url?: string | null
          notes?: string | null
          rep_id?: string | null
          reschedule_count?: number
          revision?: number
          scheduled_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Update: {
          attendee_email?: string | null
          booking_link_id?: string | null
          booking_source?: string | null
          calendar_event_id?: string | null
          calendar_sync_error?: string | null
          calendar_sync_status?: string | null
          calendar_synced_at?: string | null
          calendar_synced_revision?: number | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          customer_notes?: string | null
          duration_minutes?: number | null
          id?: string
          lead_id?: string
          meeting_type?: string | null
          meeting_url?: string | null
          notes?: string | null
          rep_id?: string | null
          reschedule_count?: number
          revision?: number
          scheduled_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_booking_link_id_fkey"
            columns: ["booking_link_id"]
            isOneToOne: false
            referencedRelation: "booking_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "reps"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          company_id: string
          correlation_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: number
          metadata: Json
          worker_run_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          company_id: string
          correlation_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: never
          metadata?: Json
          worker_run_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          company_id?: string
          correlation_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: never
          metadata?: Json
          worker_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_worker_run_id_fkey"
            columns: ["worker_run_id"]
            isOneToOne: false
            referencedRelation: "worker_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_attempts: {
        Row: {
          action: string
          booking_link_id: string
          company_id: string
          id: number
          request_ip: unknown
          reserved_at: string
        }
        Insert: {
          action: string
          booking_link_id: string
          company_id: string
          id?: never
          request_ip: unknown
          reserved_at?: string
        }
        Update: {
          action?: string
          booking_link_id?: string
          company_id?: string
          id?: never
          request_ip?: unknown
          reserved_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_attempts_booking_link_id_fkey"
            columns: ["booking_link_id"]
            isOneToOne: false
            referencedRelation: "booking_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_attempts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_availability_windows: {
        Row: {
          company_id: string
          created_at: string
          end_minute: number
          id: string
          start_minute: number
          weekday: number
        }
        Insert: {
          company_id: string
          created_at?: string
          end_minute: number
          id?: string
          start_minute: number
          weekday: number
        }
        Update: {
          company_id?: string
          created_at?: string
          end_minute?: number
          id?: string
          start_minute?: number
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_availability_windows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "booking_settings"
            referencedColumns: ["company_id"]
          },
        ]
      }
      booking_blackouts: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          ends_at: string
          id: string
          reason: string | null
          starts_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          ends_at: string
          id?: string
          reason?: string | null
          starts_at: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          ends_at?: string
          id?: string
          reason?: string | null
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_blackouts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "booking_settings"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "booking_blackouts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_contact_ownership: {
        Row: {
          company_id: string
          contact_owner: string
          created_at: string
          lead_id: string | null
          phone_e164: string
        }
        Insert: {
          company_id: string
          contact_owner: string
          created_at?: string
          lead_id?: string | null
          phone_e164: string
        }
        Update: {
          company_id?: string
          contact_owner?: string
          created_at?: string
          lead_id?: string | null
          phone_e164?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_contact_ownership_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_contact_ownership_company_id_lead_id_fkey"
            columns: ["company_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      booking_links: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          last_opened_at: string | null
          lead_id: string
          revoked_at: string | null
          source: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          last_opened_at?: string | null
          lead_id: string
          revoked_at?: string | null
          source: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          last_opened_at?: string | null
          lead_id?: string
          revoked_at?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_links_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_links_company_id_lead_id_fkey"
            columns: ["company_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "booking_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_settings: {
        Row: {
          booking_horizon_days: number
          buffer_minutes: number
          company_id: string
          concurrent_capacity: number
          created_at: string
          google_calendar_id: string | null
          is_enabled: boolean
          meeting_duration_minutes: number
          meeting_title: string
          minimum_notice_minutes: number
          send_calendar_invites: boolean
          slot_interval_minutes: number
          support_phone: string | null
          timezone: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          booking_horizon_days?: number
          buffer_minutes?: number
          company_id: string
          concurrent_capacity?: number
          created_at?: string
          google_calendar_id?: string | null
          is_enabled?: boolean
          meeting_duration_minutes?: number
          meeting_title?: string
          minimum_notice_minutes?: number
          send_calendar_invites?: boolean
          slot_interval_minutes?: number
          support_phone?: string | null
          timezone?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          booking_horizon_days?: number
          buffer_minutes?: number
          company_id?: string
          concurrent_capacity?: number
          created_at?: string
          google_calendar_id?: string | null
          is_enabled?: boolean
          meeting_duration_minutes?: number
          meeting_title?: string
          minimum_notice_minutes?: number
          send_calendar_invites?: boolean
          slot_interval_minutes?: number
          support_phone?: string | null
          timezone?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_manufacturers: {
        Row: {
          code: string
          created_at: string
          id: string
          name: string
          website: string | null
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          name: string
          website?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          name?: string
          website?: string | null
        }
        Relationships: []
      }
      catalog_product_lines: {
        Row: {
          category: string
          code: string
          created_at: string
          description: string
          id: string
          manufacturer_id: string
          market_tier: string | null
          name: string
          source_notes: string
          specs: Json
          status: string
          updated_at: string
          verified_on: string
          warranty: Json
        }
        Insert: {
          category: string
          code: string
          created_at?: string
          description: string
          id?: string
          manufacturer_id: string
          market_tier?: string | null
          name: string
          source_notes: string
          specs?: Json
          status?: string
          updated_at?: string
          verified_on: string
          warranty?: Json
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          description?: string
          id?: string
          manufacturer_id?: string
          market_tier?: string | null
          name?: string
          source_notes?: string
          specs?: Json
          status?: string
          updated_at?: string
          verified_on?: string
          warranty?: Json
        }
        Relationships: [
          {
            foreignKeyName: "catalog_product_lines_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "catalog_manufacturers"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_products: {
        Row: {
          coverage_quantity: number
          coverage_unit: string
          created_at: string
          id: string
          product_line_id: string
          purchase_unit: string
          sku: string | null
          status: string
          variant: string | null
        }
        Insert: {
          coverage_quantity: number
          coverage_unit: string
          created_at?: string
          id?: string
          product_line_id: string
          purchase_unit: string
          sku?: string | null
          status?: string
          variant?: string | null
        }
        Update: {
          coverage_quantity?: number
          coverage_unit?: string
          created_at?: string
          id?: string
          product_line_id?: string
          purchase_unit?: string
          sku?: string | null
          status?: string
          variant?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_products_product_line_id_fkey"
            columns: ["product_line_id"]
            isOneToOne: false
            referencedRelation: "catalog_product_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_system_components: {
        Row: {
          component_line_id: string
          display_order: number
          id: string
          notes: string | null
          quantity_basis: string
          required_for_warranty: boolean
          system_line_id: string
        }
        Insert: {
          component_line_id: string
          display_order: number
          id?: string
          notes?: string | null
          quantity_basis: string
          required_for_warranty: boolean
          system_line_id: string
        }
        Update: {
          component_line_id?: string
          display_order?: number
          id?: string
          notes?: string | null
          quantity_basis?: string
          required_for_warranty?: boolean
          system_line_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_system_components_component_line_id_fkey"
            columns: ["component_line_id"]
            isOneToOne: false
            referencedRelation: "catalog_product_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_system_components_system_line_id_fkey"
            columns: ["system_line_id"]
            isOneToOne: false
            referencedRelation: "catalog_product_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      company_catalog_prices: {
        Row: {
          company_id: string
          created_at: string
          effective_from: string
          effective_until: string | null
          id: string
          product_id: string
          source: string
          supplier: string
          unit_cost_cents: number
        }
        Insert: {
          company_id: string
          created_at?: string
          effective_from: string
          effective_until?: string | null
          id?: string
          product_id: string
          source: string
          supplier: string
          unit_cost_cents: number
        }
        Update: {
          company_id?: string
          created_at?: string
          effective_from?: string
          effective_until?: string | null
          id?: string
          product_id?: string
          source?: string
          supplier?: string
          unit_cost_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_catalog_prices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_catalog_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
        ]
      }
      company_google_ads_settings: {
        Row: {
          appointment_ran_action_id: string | null
          appointment_set_action_id: string | null
          company_id: string
          consent_model: string
          created_at: string
          currency_code: string
          customer_id: string
          dry_run: boolean
          identifier_only_uploads: boolean
          login_customer_id: string | null
          monthly_budget_usd: number | null
          qualified_lead_action_id: string | null
          send_conversion_values: boolean
          sold_action_id: string | null
          spend_import_enabled: boolean
          updated_at: string
          uploads_enabled: boolean
        }
        Insert: {
          appointment_ran_action_id?: string | null
          appointment_set_action_id?: string | null
          company_id: string
          consent_model?: string
          created_at?: string
          currency_code?: string
          customer_id: string
          dry_run?: boolean
          identifier_only_uploads?: boolean
          login_customer_id?: string | null
          monthly_budget_usd?: number | null
          qualified_lead_action_id?: string | null
          send_conversion_values?: boolean
          sold_action_id?: string | null
          spend_import_enabled?: boolean
          updated_at?: string
          uploads_enabled?: boolean
        }
        Update: {
          appointment_ran_action_id?: string | null
          appointment_set_action_id?: string | null
          company_id?: string
          consent_model?: string
          created_at?: string
          currency_code?: string
          customer_id?: string
          dry_run?: boolean
          identifier_only_uploads?: boolean
          login_customer_id?: string | null
          monthly_budget_usd?: number | null
          qualified_lead_action_id?: string | null
          send_conversion_values?: boolean
          sold_action_id?: string | null
          spend_import_enabled?: boolean
          updated_at?: string
          uploads_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "company_google_ads_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_integrations: {
        Row: {
          company_id: string
          created_at: string
          enabled: boolean
          env_key_name: string
          field_map: Json
          history_start: string
          provider: string
        }
        Insert: {
          company_id: string
          created_at?: string
          enabled?: boolean
          env_key_name: string
          field_map?: Json
          history_start: string
          provider: string
        }
        Update: {
          company_id?: string
          created_at?: string
          enabled?: boolean
          env_key_name?: string
          field_map?: Json
          history_start?: string
          provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_integrations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_memberships: {
        Row: {
          company_id: string
          created_at: string
          is_active: boolean
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          is_active?: boolean
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          is_active?: boolean
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_memberships_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_public_hosts: {
        Row: {
          brand: Json
          company_id: string
          created_at: string
          host: string
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          brand?: Json
          company_id: string
          created_at?: string
          host: string
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          brand?: Json
          company_id?: string
          created_at?: string
          host?: string
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_public_hosts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_sms_settings: {
        Row: {
          company_id: string
          created_at: string
          enabled: boolean
          from_e164: string
          messaging_service_sid: string
          quiet_end_hour: number
          quiet_start_hour: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          enabled?: boolean
          from_e164: string
          messaging_service_sid: string
          quiet_end_hour?: number
          quiet_start_hour?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          enabled?: boolean
          from_e164?: string
          messaging_service_sid?: string
          quiet_end_hour?: number
          quiet_start_hour?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_sms_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      consultation_requests: {
        Row: {
          assessment_id: string
          booking_reference: string | null
          call_window: string | null
          company_id: string
          contact_method: string
          created_at: string
          estimate_id: string
          id: string
          lead_id: string
          property_id: string
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          assessment_id: string
          booking_reference?: string | null
          call_window?: string | null
          company_id: string
          contact_method: string
          created_at?: string
          estimate_id: string
          id?: string
          lead_id: string
          property_id: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          assessment_id?: string
          booking_reference?: string | null
          call_window?: string | null
          company_id?: string
          contact_method?: string
          created_at?: string
          estimate_id?: string
          id?: string
          lead_id?: string
          property_id?: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultation_requests_company_id_assessment_id_fkey"
            columns: ["company_id", "assessment_id"]
            isOneToOne: false
            referencedRelation: "roof_assessments"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "consultation_requests_company_id_estimate_id_fkey"
            columns: ["company_id", "estimate_id"]
            isOneToOne: false
            referencedRelation: "roof_estimates"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "consultation_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultation_requests_company_id_lead_id_fkey"
            columns: ["company_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "consultation_requests_company_id_property_id_fkey"
            columns: ["company_id", "property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      context_dialer_deliveries: {
        Row: {
          attempt_count: number
          company_id: string
          created_at: string
          estimate_id: string | null
          failure_reason: string | null
          id: string
          lead_id: string
          pipeline_run_id: string
          scheduled_for: string
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          company_id: string
          created_at?: string
          estimate_id?: string | null
          failure_reason?: string | null
          id?: string
          lead_id: string
          pipeline_run_id: string
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          company_id?: string
          created_at?: string
          estimate_id?: string | null
          failure_reason?: string | null
          id?: string
          lead_id?: string
          pipeline_run_id?: string
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "context_dialer_deliveries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "context_dialer_deliveries_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "roof_estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "context_dialer_deliveries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "context_dialer_deliveries_pipeline_run_id_fkey"
            columns: ["pipeline_run_id"]
            isOneToOne: true
            referencedRelation: "pipeline_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_budget_targets: {
        Row: {
          budget_micros: number
          created_at: string
          currency: string
          period_start: string
          timezone: string
          updated_at: string
        }
        Insert: {
          budget_micros?: number
          created_at?: string
          currency?: string
          period_start: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          budget_micros?: number
          created_at?: string
          currency?: string
          period_start?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      cost_collection_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          period_start: string
          provider_status: Json
          scheduled_for: string
          slack_error: string | null
          slack_status: string
          slot_key: string
          started_at: string
          status: string
          warnings: Json
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          period_start: string
          provider_status?: Json
          scheduled_for: string
          slack_error?: string | null
          slack_status?: string
          slot_key: string
          started_at?: string
          status?: string
          warnings?: Json
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          period_start?: string
          provider_status?: Json
          scheduled_for?: string
          slack_error?: string | null
          slack_status?: string
          slot_key?: string
          started_at?: string
          status?: string
          warnings?: Json
        }
        Relationships: []
      }
      cost_line_items: {
        Row: {
          allocation_bucket: string
          amount_micros: number
          collection_run_id: string
          confidence: string
          cost_kind: string
          created_at: string
          currency: string
          environment: string
          free_limit: number | null
          id: string
          metadata: Json
          provider: string
          resource_key: string | null
          service: string
          source_key: string
          source_timestamp: string
          source_url: string | null
          usage_quantity: number | null
          usage_unit: string | null
        }
        Insert: {
          allocation_bucket?: string
          amount_micros?: number
          collection_run_id: string
          confidence: string
          cost_kind: string
          created_at?: string
          currency?: string
          environment?: string
          free_limit?: number | null
          id?: string
          metadata?: Json
          provider: string
          resource_key?: string | null
          service: string
          source_key: string
          source_timestamp: string
          source_url?: string | null
          usage_quantity?: number | null
          usage_unit?: string | null
        }
        Update: {
          allocation_bucket?: string
          amount_micros?: number
          collection_run_id?: string
          confidence?: string
          cost_kind?: string
          created_at?: string
          currency?: string
          environment?: string
          free_limit?: number | null
          id?: string
          metadata?: Json
          provider?: string
          resource_key?: string | null
          service?: string
          source_key?: string
          source_timestamp?: string
          source_url?: string | null
          usage_quantity?: number | null
          usage_unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_line_items_collection_run_id_fkey"
            columns: ["collection_run_id"]
            isOneToOne: false
            referencedRelation: "cost_collection_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_rate_cards: {
        Row: {
          created_at: string
          currency: string
          effective_from: string
          effective_to: string | null
          free_limit: number | null
          id: string
          metadata: Json
          provider: string
          service: string
          source_url: string
          unit: string
          unit_price_micros: number
        }
        Insert: {
          created_at?: string
          currency?: string
          effective_from: string
          effective_to?: string | null
          free_limit?: number | null
          id?: string
          metadata?: Json
          provider: string
          service: string
          source_url: string
          unit: string
          unit_price_micros?: number
        }
        Update: {
          created_at?: string
          currency?: string
          effective_from?: string
          effective_to?: string | null
          free_limit?: number | null
          id?: string
          metadata?: Json
          provider?: string
          service?: string
          source_url?: string
          unit?: string
          unit_price_micros?: number
        }
        Relationships: []
      }
      cost_resource_inventory: {
        Row: {
          active: boolean
          allocation_bucket: string
          created_at: string
          display_name: string
          environment: string
          id: string
          metadata: Json
          provider: string
          resource_key: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          allocation_bucket?: string
          created_at?: string
          display_name: string
          environment?: string
          id?: string
          metadata?: Json
          provider: string
          resource_key: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          allocation_bucket?: string
          created_at?: string
          display_name?: string
          environment?: string
          id?: string
          metadata?: Json
          provider?: string
          resource_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      customer_identities: {
        Row: {
          company_id: string
          created_at: string
          customer_id: string
          email_normalized: string | null
          external_id: string
          matched_by: string
          phone_normalized: string | null
          source_system: string
        }
        Insert: {
          company_id: string
          created_at?: string
          customer_id: string
          email_normalized?: string | null
          external_id: string
          matched_by: string
          phone_normalized?: string | null
          source_system: string
        }
        Update: {
          company_id?: string
          created_at?: string
          customer_id?: string
          email_normalized?: string | null
          external_id?: string
          matched_by?: string
          phone_normalized?: string | null
          source_system?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_identities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_identities_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_journey_events: {
        Row: {
          company_id: string
          customer_id: string
          is_approximate: boolean
          occurred_at: string
          recorded_at: string
          source_ref: string
          source_system: string
          stage: string
        }
        Insert: {
          company_id: string
          customer_id: string
          is_approximate?: boolean
          occurred_at: string
          recorded_at?: string
          source_ref: string
          source_system: string
          stage: string
        }
        Update: {
          company_id?: string
          customer_id?: string
          is_approximate?: boolean
          occurred_at?: string
          recorded_at?: string
          source_ref?: string
          source_system?: string
          stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_journey_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_journey_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_match_conflicts: {
        Row: {
          candidate_count: number
          company_id: string
          external_id: string
          last_seen_at: string
          reason: string
          source_system: string
        }
        Insert: {
          candidate_count?: number
          company_id: string
          external_id: string
          last_seen_at?: string
          reason: string
          source_system: string
        }
        Update: {
          candidate_count?: number
          company_id?: string
          external_id?: string
          last_seen_at?: string
          reason?: string
          source_system?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_match_conflicts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          company_id: string
          created_at: string
          first_seen_at: string | null
          id: string
          source_name: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          first_seen_at?: string | null
          id?: string
          source_name?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          first_seen_at?: string | null
          id?: string
          source_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      domain_events: {
        Row: {
          causation_event_id: string | null
          company_id: string
          correlation_id: string
          created_at: string
          event_name: string
          id: string
          idempotency_key: string
          occurred_at: string
          payload: Json
          pipeline_run_id: string | null
          schema_version: number
        }
        Insert: {
          causation_event_id?: string | null
          company_id: string
          correlation_id: string
          created_at?: string
          event_name: string
          id: string
          idempotency_key: string
          occurred_at: string
          payload: Json
          pipeline_run_id?: string | null
          schema_version: number
        }
        Update: {
          causation_event_id?: string | null
          company_id?: string
          correlation_id?: string
          created_at?: string
          event_name?: string
          id?: string
          idempotency_key?: string
          occurred_at?: string
          payload?: Json
          pipeline_run_id?: string | null
          schema_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "domain_events_causation_event_id_fkey"
            columns: ["causation_event_id"]
            isOneToOne: false
            referencedRelation: "domain_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "domain_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "domain_events_pipeline_run_id_fkey"
            columns: ["pipeline_run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_deliveries: {
        Row: {
          channel: string
          company_id: string
          composed_body: string
          composed_subject: string | null
          created_at: string
          destination: string
          estimate_id: string
          failure_reason: string | null
          id: string
          lead_id: string
          scheduled_for: string
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          channel: string
          company_id: string
          composed_body: string
          composed_subject?: string | null
          created_at?: string
          destination: string
          estimate_id: string
          failure_reason?: string | null
          id?: string
          lead_id: string
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          channel?: string
          company_id?: string
          composed_body?: string
          composed_subject?: string | null
          created_at?: string
          destination?: string
          estimate_id?: string
          failure_reason?: string | null
          id?: string
          lead_id?: string
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_deliveries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_deliveries_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "roof_estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_deliveries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      event_outbox: {
        Row: {
          attempt_count: number
          available_at: string
          claimed_at: string | null
          claimed_by: string | null
          event_id: string
          last_error: string | null
          published_at: string | null
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          claimed_at?: string | null
          claimed_by?: string | null
          event_id: string
          last_error?: string | null
          published_at?: string | null
        }
        Update: {
          attempt_count?: number
          available_at?: string
          claimed_at?: string | null
          claimed_by?: string | null
          event_id?: string
          last_error?: string | null
          published_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_outbox_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "domain_events"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_artifacts: {
        Row: {
          company_id: string
          created_at: string
          id: string
          media_type: string
          sha256: string
          storage_path: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          media_type: string
          sha256: string
          storage_path: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          media_type?: string
          sha256?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_artifacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_events: {
        Row: {
          company_id: string
          error_category: string | null
          event_type: string
          id: string
          idempotency_key: string
          outcome: string
          processed_at: string | null
          raw_payload: Json
          received_at: string
          source_system: string
        }
        Insert: {
          company_id: string
          error_category?: string | null
          event_type: string
          id?: string
          idempotency_key: string
          outcome?: string
          processed_at?: string | null
          raw_payload?: Json
          received_at?: string
          source_system: string
        }
        Update: {
          company_id?: string
          error_category?: string | null
          event_type?: string
          id?: string
          idempotency_key?: string
          outcome?: string
          processed_at?: string | null
          raw_payload?: Json
          received_at?: string
          source_system?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_sync_runs: {
        Row: {
          business_timezone: string
          company_id: string
          error_category: string | null
          finished_at: string | null
          id: string
          metadata: Json
          next_cursor: string | null
          outcome: string
          records_seen: number
          records_written: number
          source_system: string
          started_at: string
          sync_key: string
        }
        Insert: {
          business_timezone?: string
          company_id: string
          error_category?: string | null
          finished_at?: string | null
          id?: string
          metadata?: Json
          next_cursor?: string | null
          outcome?: string
          records_seen?: number
          records_written?: number
          source_system: string
          started_at?: string
          sync_key: string
        }
        Update: {
          business_timezone?: string
          company_id?: string
          error_category?: string | null
          finished_at?: string | null
          id?: string
          metadata?: Json
          next_cursor?: string | null
          outcome?: string
          records_seen?: number
          records_written?: number
          source_system?: string
          started_at?: string
          sync_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_sync_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      interactions: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          lead_id: string
          occurred_at: string
          summary: string
          type: Database["public"]["Enums"]["interaction_type"]
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id: string
          occurred_at?: string
          summary: string
          type: Database["public"]["Enums"]["interaction_type"]
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id?: string
          occurred_at?: string
          summary?: string
          type?: Database["public"]["Enums"]["interaction_type"]
        }
        Relationships: [
          {
            foreignKeyName: "interactions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interactions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      jn_contacts: {
        Row: {
          address_line1: string | null
          city: string | null
          company_id: string
          display_name: string | null
          email_normalized: string | null
          first_name: string | null
          is_archived: boolean | null
          jn_created_at: string | null
          jn_updated_at: string | null
          jnid: string
          last_name: string | null
          phone_normalized: string | null
          projected_at: string
          record_type_name: string | null
          sales_rep_jnid: string | null
          sales_rep_name: string | null
          source_name: string | null
          state_text: string | null
          status_name: string | null
          zip: string | null
        }
        Insert: {
          address_line1?: string | null
          city?: string | null
          company_id: string
          display_name?: string | null
          email_normalized?: string | null
          first_name?: string | null
          is_archived?: boolean | null
          jn_created_at?: string | null
          jn_updated_at?: string | null
          jnid: string
          last_name?: string | null
          phone_normalized?: string | null
          projected_at?: string
          record_type_name?: string | null
          sales_rep_jnid?: string | null
          sales_rep_name?: string | null
          source_name?: string | null
          state_text?: string | null
          status_name?: string | null
          zip?: string | null
        }
        Update: {
          address_line1?: string | null
          city?: string | null
          company_id?: string
          display_name?: string | null
          email_normalized?: string | null
          first_name?: string | null
          is_archived?: boolean | null
          jn_created_at?: string | null
          jn_updated_at?: string | null
          jnid?: string
          last_name?: string | null
          phone_normalized?: string | null
          projected_at?: string
          record_type_name?: string | null
          sales_rep_jnid?: string | null
          sales_rep_name?: string | null
          source_name?: string | null
          state_text?: string | null
          status_name?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jn_contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      jn_estimates: {
        Row: {
          approved_total: number | null
          company_id: string
          estimate_total: number | null
          jn_created_at: string | null
          jn_updated_at: string | null
          jnid: string
          number: string | null
          projected_at: string
          related_job_jnid: string | null
          source: string | null
          status_name: string | null
        }
        Insert: {
          approved_total?: number | null
          company_id: string
          estimate_total?: number | null
          jn_created_at?: string | null
          jn_updated_at?: string | null
          jnid: string
          number?: string | null
          projected_at?: string
          related_job_jnid?: string | null
          source?: string | null
          status_name?: string | null
        }
        Update: {
          approved_total?: number | null
          company_id?: string
          estimate_total?: number | null
          jn_created_at?: string | null
          jn_updated_at?: string | null
          jnid?: string
          number?: string | null
          projected_at?: string
          related_job_jnid?: string | null
          source?: string | null
          status_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jn_estimates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      jn_files: {
        Row: {
          company_id: string
          content_type: string | null
          filename: string | null
          jn_created_at: string | null
          jn_updated_at: string | null
          jnid: string
          pages: number | null
          projected_at: string
          related_job_jnid: string | null
          size: number | null
        }
        Insert: {
          company_id: string
          content_type?: string | null
          filename?: string | null
          jn_created_at?: string | null
          jn_updated_at?: string | null
          jnid: string
          pages?: number | null
          projected_at?: string
          related_job_jnid?: string | null
          size?: number | null
        }
        Update: {
          company_id?: string
          content_type?: string | null
          filename?: string | null
          jn_created_at?: string | null
          jn_updated_at?: string | null
          jnid?: string
          pages?: number | null
          projected_at?: string
          related_job_jnid?: string | null
          size?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "jn_files_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      jn_jobs: {
        Row: {
          address_line1: string | null
          approved_total: number | null
          city: string | null
          company_id: string
          estimate_total: number | null
          is_active: boolean | null
          is_archived: boolean | null
          jn_created_at: string | null
          jn_updated_at: string | null
          jnid: string
          job_type: string | null
          number: string | null
          primary_contact_jnid: string | null
          projected_at: string
          record_type_name: string | null
          sales_rep_jnid: string | null
          sales_rep_name: string | null
          shingle_line: string | null
          state_text: string | null
          status_changed_at: string | null
          status_name: string | null
          zip: string | null
        }
        Insert: {
          address_line1?: string | null
          approved_total?: number | null
          city?: string | null
          company_id: string
          estimate_total?: number | null
          is_active?: boolean | null
          is_archived?: boolean | null
          jn_created_at?: string | null
          jn_updated_at?: string | null
          jnid: string
          job_type?: string | null
          number?: string | null
          primary_contact_jnid?: string | null
          projected_at?: string
          record_type_name?: string | null
          sales_rep_jnid?: string | null
          sales_rep_name?: string | null
          shingle_line?: string | null
          state_text?: string | null
          status_changed_at?: string | null
          status_name?: string | null
          zip?: string | null
        }
        Update: {
          address_line1?: string | null
          approved_total?: number | null
          city?: string | null
          company_id?: string
          estimate_total?: number | null
          is_active?: boolean | null
          is_archived?: boolean | null
          jn_created_at?: string | null
          jn_updated_at?: string | null
          jnid?: string
          job_type?: string | null
          number?: string | null
          primary_contact_jnid?: string | null
          projected_at?: string
          record_type_name?: string | null
          sales_rep_jnid?: string | null
          sales_rep_name?: string | null
          shingle_line?: string | null
          state_text?: string | null
          status_changed_at?: string | null
          status_name?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jn_jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      job_inspections: {
        Row: {
          company_id: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          inspection_type: string
          inspector_name: string | null
          job_permit_id: string
          result_notes: string | null
          scheduled_at: string | null
          status: Database["public"]["Enums"]["job_inspection_status"]
          updated_at: string
        }
        Insert: {
          company_id: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          inspection_type: string
          inspector_name?: string | null
          job_permit_id: string
          result_notes?: string | null
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["job_inspection_status"]
          updated_at?: string
        }
        Update: {
          company_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          inspection_type?: string
          inspector_name?: string | null
          job_permit_id?: string
          result_notes?: string | null
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["job_inspection_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_inspections_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_inspections_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_inspections_job_permit_id_fkey"
            columns: ["job_permit_id"]
            isOneToOne: false
            referencedRelation: "job_permits"
            referencedColumns: ["id"]
          },
        ]
      }
      job_permits: {
        Row: {
          approved_at: string | null
          company_id: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          job_id: string
          municipality: string | null
          notes: string | null
          permit_number: string | null
          permit_type: string
          status: Database["public"]["Enums"]["job_permit_status"]
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          job_id: string
          municipality?: string | null
          notes?: string | null
          permit_number?: string | null
          permit_type: string
          status?: Database["public"]["Enums"]["job_permit_status"]
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          job_id?: string
          municipality?: string | null
          notes?: string | null
          permit_number?: string | null
          permit_type?: string
          status?: Database["public"]["Enums"]["job_permit_status"]
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_permits_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_permits_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_permits_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobnimbus_census: {
        Row: {
          captured_at: string
          company_id: string
          contact_field_counts: Json
          contacts: number
          id: string
          job_field_counts: Json
          jobs: number
          unmapped_statuses: Json
        }
        Insert: {
          captured_at?: string
          company_id: string
          contact_field_counts: Json
          contacts: number
          id?: string
          job_field_counts: Json
          jobs: number
          unmapped_statuses?: Json
        }
        Update: {
          captured_at?: string
          company_id?: string
          contact_field_counts?: Json
          contacts?: number
          id?: string
          job_field_counts?: Json
          jobs?: number
          unmapped_statuses?: Json
        }
        Relationships: [
          {
            foreignKeyName: "jobnimbus_census_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      jobnimbus_contacts: {
        Row: {
          company_id: string
          contact_id: string
          display_name: string | null
          email_normalized: string | null
          external_lead_id: string | null
          id: string
          ingested_at: string
          phone_normalized: string | null
          raw_payload: Json
          status: string | null
          vendor_created_at: string | null
          vendor_updated_at: string | null
        }
        Insert: {
          company_id: string
          contact_id: string
          display_name?: string | null
          email_normalized?: string | null
          external_lead_id?: string | null
          id?: string
          ingested_at?: string
          phone_normalized?: string | null
          raw_payload: Json
          status?: string | null
          vendor_created_at?: string | null
          vendor_updated_at?: string | null
        }
        Update: {
          company_id?: string
          contact_id?: string
          display_name?: string | null
          email_normalized?: string | null
          external_lead_id?: string | null
          id?: string
          ingested_at?: string
          phone_normalized?: string | null
          raw_payload?: Json
          status?: string | null
          vendor_created_at?: string | null
          vendor_updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobnimbus_contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      jobnimbus_jobs: {
        Row: {
          appointment_at: string | null
          appointment_status: string | null
          company_id: string
          contact_id: string | null
          external_lead_id: string | null
          id: string
          ingested_at: string
          job_id: string
          raw_payload: Json
          reengagement_triggered: boolean
          sold_value: number | null
          source_system: string
          stage: string | null
          status: string | null
          vendor_created_at: string | null
          vendor_updated_at: string | null
        }
        Insert: {
          appointment_at?: string | null
          appointment_status?: string | null
          company_id: string
          contact_id?: string | null
          external_lead_id?: string | null
          id?: string
          ingested_at?: string
          job_id: string
          raw_payload: Json
          reengagement_triggered?: boolean
          sold_value?: number | null
          source_system?: string
          stage?: string | null
          status?: string | null
          vendor_created_at?: string | null
          vendor_updated_at?: string | null
        }
        Update: {
          appointment_at?: string | null
          appointment_status?: string | null
          company_id?: string
          contact_id?: string | null
          external_lead_id?: string | null
          id?: string
          ingested_at?: string
          job_id?: string
          raw_payload?: Json
          reengagement_triggered?: boolean
          sold_value?: number | null
          source_system?: string
          stage?: string | null
          status?: string | null
          vendor_created_at?: string | null
          vendor_updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobnimbus_jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      jobnimbus_records: {
        Row: {
          company_id: string
          content_hash: string
          first_seen_at: string
          jn_updated_at: string | null
          jnid: string
          last_seen_at: string
          payload: Json
          record_type: string
        }
        Insert: {
          company_id: string
          content_hash: string
          first_seen_at?: string
          jn_updated_at?: string | null
          jnid: string
          last_seen_at?: string
          payload: Json
          record_type: string
        }
        Update: {
          company_id?: string
          content_hash?: string
          first_seen_at?: string
          jn_updated_at?: string | null
          jnid?: string
          last_seen_at?: string
          payload?: Json
          record_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobnimbus_records_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      jobnimbus_roofr_reports: {
        Row: {
          api_calls: number
          area_weighted_pitch_12: number | null
          company_id: string
          facets: number | null
          file_jnid: string
          flat_squares: number | null
          job_jnid: string
          max_pitch_12: number | null
          outcome: string
          pitch_area: Json
          predominant_pitch_12: number | null
          processed_at: string
          rate_limit_response_count: number
          total_squares: number | null
          transient_error_count: number
          two_layer_squares: number | null
          two_story_squares: number | null
          waste_ladder: Json
        }
        Insert: {
          api_calls?: number
          area_weighted_pitch_12?: number | null
          company_id: string
          facets?: number | null
          file_jnid: string
          flat_squares?: number | null
          job_jnid: string
          max_pitch_12?: number | null
          outcome: string
          pitch_area?: Json
          predominant_pitch_12?: number | null
          processed_at?: string
          rate_limit_response_count?: number
          total_squares?: number | null
          transient_error_count?: number
          two_layer_squares?: number | null
          two_story_squares?: number | null
          waste_ladder?: Json
        }
        Update: {
          api_calls?: number
          area_weighted_pitch_12?: number | null
          company_id?: string
          facets?: number | null
          file_jnid?: string
          flat_squares?: number | null
          job_jnid?: string
          max_pitch_12?: number | null
          outcome?: string
          pitch_area?: Json
          predominant_pitch_12?: number | null
          processed_at?: string
          rate_limit_response_count?: number
          total_squares?: number | null
          transient_error_count?: number
          two_layer_squares?: number | null
          two_story_squares?: number | null
          waste_ladder?: Json
        }
        Relationships: [
          {
            foreignKeyName: "jobnimbus_roofr_reports_company_id_file_jnid_fkey"
            columns: ["company_id", "file_jnid"]
            isOneToOne: true
            referencedRelation: "jn_files"
            referencedColumns: ["company_id", "jnid"]
          },
        ]
      }
      jobnimbus_status_stages: {
        Row: {
          company_id: string | null
          implies: string[]
          stage: string | null
          status_name: string
        }
        Insert: {
          company_id?: string | null
          implies?: string[]
          stage?: string | null
          status_name: string
        }
        Update: {
          company_id?: string | null
          implies?: string[]
          stage?: string | null
          status_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobnimbus_status_stages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      jobnimbus_sync_runs: {
        Row: {
          api_calls: number
          company_id: string
          error: string | null
          finished_at: string | null
          id: string
          mode: string
          rate_limit_error_count: number
          record_type: string
          records_changed: number
          records_seen: number
          started_at: string
          status: string
          transient_error_count: number
          watermark_from: string | null
          watermark_to: string | null
        }
        Insert: {
          api_calls?: number
          company_id: string
          error?: string | null
          finished_at?: string | null
          id?: string
          mode: string
          rate_limit_error_count?: number
          record_type: string
          records_changed?: number
          records_seen?: number
          started_at?: string
          status?: string
          transient_error_count?: number
          watermark_from?: string | null
          watermark_to?: string | null
        }
        Update: {
          api_calls?: number
          company_id?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          mode?: string
          rate_limit_error_count?: number
          record_type?: string
          records_changed?: number
          records_seen?: number
          started_at?: string
          status?: string
          transient_error_count?: number
          watermark_from?: string | null
          watermark_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobnimbus_sync_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      jobnimbus_sync_state: {
        Row: {
          company_id: string
          last_full_at: string | null
          record_type: string
          watermark: string
        }
        Insert: {
          company_id: string
          last_full_at?: string | null
          record_type: string
          watermark: string
        }
        Update: {
          company_id?: string
          last_full_at?: string | null
          record_type?: string
          watermark?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobnimbus_sync_state_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          lead_id: string | null
          notes: string | null
          property_id: string
          status: Database["public"]["Enums"]["job_status"]
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id?: string | null
          notes?: string | null
          property_id: string
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id?: string | null
          notes?: string | null
          property_id?: string
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_ad_attribution: {
        Row: {
          channel: string
          click_id_type: string | null
          click_ids_purged_at: string | null
          clicked_at: string | null
          company_id: string
          fbclid: string | null
          first_touch: Json | null
          gbraid: string | null
          gclid: string | null
          google_ad_group_id: string | null
          google_campaign_id: string | null
          google_creative_id: string | null
          google_device: string | null
          google_keyword: string | null
          google_match_type: string | null
          google_network: string | null
          google_target_id: string | null
          landing_path: string | null
          last_touch: Json | null
          lead_id: string
          msclkid: string | null
          recorded_at: string
          token_verified: boolean
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          wbraid: string | null
        }
        Insert: {
          channel: string
          click_id_type?: string | null
          click_ids_purged_at?: string | null
          clicked_at?: string | null
          company_id: string
          fbclid?: string | null
          first_touch?: Json | null
          gbraid?: string | null
          gclid?: string | null
          google_ad_group_id?: string | null
          google_campaign_id?: string | null
          google_creative_id?: string | null
          google_device?: string | null
          google_keyword?: string | null
          google_match_type?: string | null
          google_network?: string | null
          google_target_id?: string | null
          landing_path?: string | null
          last_touch?: Json | null
          lead_id: string
          msclkid?: string | null
          recorded_at?: string
          token_verified: boolean
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          wbraid?: string | null
        }
        Update: {
          channel?: string
          click_id_type?: string | null
          click_ids_purged_at?: string | null
          clicked_at?: string | null
          company_id?: string
          fbclid?: string | null
          first_touch?: Json | null
          gbraid?: string | null
          gclid?: string | null
          google_ad_group_id?: string | null
          google_campaign_id?: string | null
          google_creative_id?: string | null
          google_device?: string | null
          google_keyword?: string | null
          google_match_type?: string | null
          google_network?: string | null
          google_target_id?: string | null
          landing_path?: string | null
          last_touch?: Json | null
          lead_id?: string
          msclkid?: string | null
          recorded_at?: string
          token_verified?: boolean
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          wbraid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_ad_attribution_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_ad_attribution_company_id_lead_id_fkey"
            columns: ["company_id", "lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      lead_attribution_touches: {
        Row: {
          assessment_id: string | null
          attribution: Json
          company_id: string
          entry_point: string
          estimate_id: string | null
          id: string
          lead_id: string
          occurred_at: string
          presentation_key: string
          referrer: string | null
          submission_id: string
        }
        Insert: {
          assessment_id?: string | null
          attribution?: Json
          company_id: string
          entry_point: string
          estimate_id?: string | null
          id?: string
          lead_id: string
          occurred_at?: string
          presentation_key: string
          referrer?: string | null
          submission_id: string
        }
        Update: {
          assessment_id?: string | null
          attribution?: Json
          company_id?: string
          entry_point?: string
          estimate_id?: string | null
          id?: string
          lead_id?: string
          occurred_at?: string
          presentation_key?: string
          referrer?: string | null
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_attribution_touches_company_id_assessment_id_fkey"
            columns: ["company_id", "assessment_id"]
            isOneToOne: false
            referencedRelation: "roof_assessments"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "lead_attribution_touches_company_id_estimate_id_fkey"
            columns: ["company_id", "estimate_id"]
            isOneToOne: false
            referencedRelation: "roof_estimates"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "lead_attribution_touches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_attribution_touches_company_id_lead_id_fkey"
            columns: ["company_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      lead_consent_evidence: {
        Row: {
          company_id: string
          consent_type: string
          disclosure_version: string
          granted: boolean
          granted_at: string
          id: string
          ip_address: unknown
          lead_id: string
          recorded_at: string
          source: string
          submission_id: string
          user_agent: string | null
        }
        Insert: {
          company_id: string
          consent_type: string
          disclosure_version: string
          granted: boolean
          granted_at: string
          id?: string
          ip_address?: unknown
          lead_id: string
          recorded_at?: string
          source: string
          submission_id: string
          user_agent?: string | null
        }
        Update: {
          company_id?: string
          consent_type?: string
          disclosure_version?: string
          granted?: boolean
          granted_at?: string
          id?: string
          ip_address?: unknown
          lead_id?: string
          recorded_at?: string
          source?: string
          submission_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_consent_evidence_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_consent_evidence_company_id_lead_id_fkey"
            columns: ["company_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      lead_consents: {
        Row: {
          company_id: string
          consent_type: string
          disclosure_version: string
          granted: boolean
          granted_at: string
          id: string
          ip_address: unknown
          lead_id: string
          source: string
          user_agent: string | null
        }
        Insert: {
          company_id: string
          consent_type: string
          disclosure_version: string
          granted: boolean
          granted_at?: string
          id?: string
          ip_address?: unknown
          lead_id: string
          source?: string
          user_agent?: string | null
        }
        Update: {
          company_id?: string
          consent_type?: string
          disclosure_version?: string
          granted?: boolean
          granted_at?: string
          id?: string
          ip_address?: unknown
          lead_id?: string
          source?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_consents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_consents_company_lead_fkey"
            columns: ["company_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      lead_distribution_deliveries: {
        Row: {
          attempt_count: number
          available_at: string
          claimed_at: string | null
          company_id: string
          created_at: string
          destination: string
          external_id: string | null
          id: string
          last_error: string | null
          lead_id: string
          outcome: string | null
          pipeline_run_id: string
          sent_at: string | null
          source_label: string
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          claimed_at?: string | null
          company_id: string
          created_at?: string
          destination: string
          external_id?: string | null
          id?: string
          last_error?: string | null
          lead_id: string
          outcome?: string | null
          pipeline_run_id: string
          sent_at?: string | null
          source_label: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          claimed_at?: string | null
          company_id?: string
          created_at?: string
          destination?: string
          external_id?: string | null
          id?: string
          last_error?: string | null
          lead_id?: string
          outcome?: string | null
          pipeline_run_id?: string
          sent_at?: string | null
          source_label?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_distribution_deliveries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_distribution_deliveries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_distribution_deliveries_pipeline_run_id_fkey"
            columns: ["pipeline_run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_quality_flags: {
        Row: {
          company_id: string
          flag: string
          flagged_at: string
          flagged_by: string | null
          lead_id: string
          note: string | null
        }
        Insert: {
          company_id: string
          flag: string
          flagged_at?: string
          flagged_by?: string | null
          lead_id: string
          note?: string | null
        }
        Update: {
          company_id?: string
          flag?: string
          flagged_at?: string
          flagged_by?: string | null
          lead_id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_quality_flags_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_quality_flags_company_id_lead_id_fkey"
            columns: ["company_id", "lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "lead_quality_flags_flagged_by_fkey"
            columns: ["flagged_by"]
            isOneToOne: false
            referencedRelation: "admin_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_stage_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          company_id: string
          from_stage: Database["public"]["Enums"]["lead_stage"] | null
          id: string
          lead_id: string
          note: string | null
          to_stage: Database["public"]["Enums"]["lead_stage"]
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          company_id: string
          from_stage?: Database["public"]["Enums"]["lead_stage"] | null
          id?: string
          lead_id: string
          note?: string | null
          to_stage: Database["public"]["Enums"]["lead_stage"]
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          company_id?: string
          from_stage?: Database["public"]["Enums"]["lead_stage"] | null
          id?: string
          lead_id?: string
          note?: string | null
          to_stage?: Database["public"]["Enums"]["lead_stage"]
        }
        Relationships: [
          {
            foreignKeyName: "lead_stage_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "admin_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_stage_history_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_stage_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leadconduit_events: {
        Row: {
          attribution: Json
          campaign: string | null
          company_id: string
          consent_reference: string | null
          email_normalized: string | null
          event_id: string
          event_type: string
          external_lead_id: string | null
          first_observed_at: string
          flow_id: string | null
          id: string
          ingested_at: string
          ingestion_channels: string[]
          is_test: boolean
          lead_id: string | null
          lead_name: string | null
          occurred_at: string
          outcome: string | null
          phone_normalized: string | null
          piw_lead_id: string | null
          poll_observed_at: string | null
          processing_attempts: number
          processing_claimed_at: string | null
          processing_claimed_by: string | null
          processing_error_category: string | null
          processing_next_attempt_at: string | null
          processing_status: string
          raw_payload: Json
          raw_status: string | null
          reason_category: string | null
          rule_id: string | null
          rule_name: string | null
          rule_scope: string | null
          rule_scope_id: string | null
          source_id: string | null
          source_name: string | null
          step_id: string | null
          step_name: string | null
          submitted_address: string | null
          submitted_email: string | null
          submitted_phone: string | null
          trustedform_url: string | null
          webhook_received_at: string | null
        }
        Insert: {
          attribution?: Json
          campaign?: string | null
          company_id: string
          consent_reference?: string | null
          email_normalized?: string | null
          event_id: string
          event_type: string
          external_lead_id?: string | null
          first_observed_at: string
          flow_id?: string | null
          id?: string
          ingested_at?: string
          ingestion_channels?: string[]
          is_test?: boolean
          lead_id?: string | null
          lead_name?: string | null
          occurred_at: string
          outcome?: string | null
          phone_normalized?: string | null
          piw_lead_id?: string | null
          poll_observed_at?: string | null
          processing_attempts?: number
          processing_claimed_at?: string | null
          processing_claimed_by?: string | null
          processing_error_category?: string | null
          processing_next_attempt_at?: string | null
          processing_status?: string
          raw_payload: Json
          raw_status?: string | null
          reason_category?: string | null
          rule_id?: string | null
          rule_name?: string | null
          rule_scope?: string | null
          rule_scope_id?: string | null
          source_id?: string | null
          source_name?: string | null
          step_id?: string | null
          step_name?: string | null
          submitted_address?: string | null
          submitted_email?: string | null
          submitted_phone?: string | null
          trustedform_url?: string | null
          webhook_received_at?: string | null
        }
        Update: {
          attribution?: Json
          campaign?: string | null
          company_id?: string
          consent_reference?: string | null
          email_normalized?: string | null
          event_id?: string
          event_type?: string
          external_lead_id?: string | null
          first_observed_at?: string
          flow_id?: string | null
          id?: string
          ingested_at?: string
          ingestion_channels?: string[]
          is_test?: boolean
          lead_id?: string | null
          lead_name?: string | null
          occurred_at?: string
          outcome?: string | null
          phone_normalized?: string | null
          piw_lead_id?: string | null
          poll_observed_at?: string | null
          processing_attempts?: number
          processing_claimed_at?: string | null
          processing_claimed_by?: string | null
          processing_error_category?: string | null
          processing_next_attempt_at?: string | null
          processing_status?: string
          raw_payload?: Json
          raw_status?: string | null
          reason_category?: string | null
          rule_id?: string | null
          rule_name?: string | null
          rule_scope?: string | null
          rule_scope_id?: string | null
          source_id?: string | null
          source_name?: string | null
          step_id?: string | null
          step_name?: string | null
          submitted_address?: string | null
          submitted_email?: string | null
          submitted_phone?: string | null
          trustedform_url?: string | null
          webhook_received_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leadconduit_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leadconduit_events_company_piw_lead_fkey"
            columns: ["company_id", "piw_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      leadconduit_flow_rules: {
        Row: {
          company_id: string
          flow_id: string
          id: string
          lhv: string
          observed_at: string
          operator: string
          rule_id: string
          rule_name: string | null
          rule_scope: string
          rule_scope_id: string
        }
        Insert: {
          company_id: string
          flow_id: string
          id?: string
          lhv: string
          observed_at: string
          operator: string
          rule_id: string
          rule_name?: string | null
          rule_scope: string
          rule_scope_id: string
        }
        Update: {
          company_id?: string
          flow_id?: string
          id?: string
          lhv?: string
          observed_at?: string
          operator?: string
          rule_id?: string
          rule_name?: string | null
          rule_scope?: string
          rule_scope_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leadconduit_flow_rules_company_flow_fkey"
            columns: ["company_id", "flow_id"]
            isOneToOne: false
            referencedRelation: "leadconduit_flows"
            referencedColumns: ["company_id", "flow_id"]
          },
          {
            foreignKeyName: "leadconduit_flow_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      leadconduit_flow_steps: {
        Row: {
          company_id: string
          enabled: boolean
          flow_id: string
          id: string
          observed_at: string
          outcome: string | null
          step_id: string
          step_name: string | null
          step_order: number
          step_type: string
        }
        Insert: {
          company_id: string
          enabled: boolean
          flow_id: string
          id?: string
          observed_at: string
          outcome?: string | null
          step_id: string
          step_name?: string | null
          step_order: number
          step_type: string
        }
        Update: {
          company_id?: string
          enabled?: boolean
          flow_id?: string
          id?: string
          observed_at?: string
          outcome?: string | null
          step_id?: string
          step_name?: string | null
          step_order?: number
          step_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "leadconduit_flow_steps_company_flow_fkey"
            columns: ["company_id", "flow_id"]
            isOneToOne: false
            referencedRelation: "leadconduit_flows"
            referencedColumns: ["company_id", "flow_id"]
          },
          {
            foreignKeyName: "leadconduit_flow_steps_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      leadconduit_flows: {
        Row: {
          company_id: string
          destination_ids: string[]
          enabled: boolean
          field_ids: string[]
          flow_id: string
          id: string
          ingested_at: string
          name: string
          raw_payload: Json
          source_ids: string[]
          vendor_created_at: string | null
          vendor_updated_at: string | null
        }
        Insert: {
          company_id: string
          destination_ids?: string[]
          enabled?: boolean
          field_ids?: string[]
          flow_id: string
          id?: string
          ingested_at?: string
          name: string
          raw_payload: Json
          source_ids?: string[]
          vendor_created_at?: string | null
          vendor_updated_at?: string | null
        }
        Update: {
          company_id?: string
          destination_ids?: string[]
          enabled?: boolean
          field_ids?: string[]
          flow_id?: string
          id?: string
          ingested_at?: string
          name?: string
          raw_payload?: Json
          source_ids?: string[]
          vendor_created_at?: string | null
          vendor_updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leadconduit_flows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      leadconduit_source_metadata: {
        Row: {
          acceptance_metadata: Json
          company_id: string
          field_names: string[]
          flow_id: string
          id: string
          observed_at: string
          raw_payload: Json
          source_id: string
          source_name: string | null
        }
        Insert: {
          acceptance_metadata?: Json
          company_id: string
          field_names?: string[]
          flow_id: string
          id?: string
          observed_at: string
          raw_payload?: Json
          source_id: string
          source_name?: string | null
        }
        Update: {
          acceptance_metadata?: Json
          company_id?: string
          field_names?: string[]
          flow_id?: string
          id?: string
          observed_at?: string
          raw_payload?: Json
          source_id?: string
          source_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leadconduit_source_metadata_company_flow_fkey"
            columns: ["company_id", "flow_id"]
            isOneToOne: false
            referencedRelation: "leadconduit_flows"
            referencedColumns: ["company_id", "flow_id"]
          },
          {
            foreignKeyName: "leadconduit_source_metadata_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      leadmaster_custom_fields: {
        Row: {
          company_id: string
          field_id: string
          field_type: string | null
          id: string
          ingested_at: string
          label: string
          raw_payload: Json
          workgroup: string
        }
        Insert: {
          company_id: string
          field_id: string
          field_type?: string | null
          id?: string
          ingested_at?: string
          label: string
          raw_payload: Json
          workgroup?: string
        }
        Update: {
          company_id?: string
          field_id?: string
          field_type?: string | null
          id?: string
          ingested_at?: string
          label?: string
          raw_payload?: Json
          workgroup?: string
        }
        Relationships: [
          {
            foreignKeyName: "leadmaster_custom_fields_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      leadmaster_records: {
        Row: {
          company_id: string
          disposition: string | null
          email_normalized: string | null
          entered_at: string
          external_lead_id: string | null
          id: string
          ingested_at: string
          lead_source: string | null
          opportunity_id: string | null
          opportunity_stage: string | null
          opportunity_status: string | null
          opportunity_value: number | null
          phone_normalized: string | null
          raw_payload: Json
          recdno: string | null
          record_id: string
          record_kind: string
          vendor_updated_at: string | null
          workgroup: string | null
        }
        Insert: {
          company_id: string
          disposition?: string | null
          email_normalized?: string | null
          entered_at: string
          external_lead_id?: string | null
          id?: string
          ingested_at?: string
          lead_source?: string | null
          opportunity_id?: string | null
          opportunity_stage?: string | null
          opportunity_status?: string | null
          opportunity_value?: number | null
          phone_normalized?: string | null
          raw_payload: Json
          recdno?: string | null
          record_id: string
          record_kind: string
          vendor_updated_at?: string | null
          workgroup?: string | null
        }
        Update: {
          company_id?: string
          disposition?: string | null
          email_normalized?: string | null
          entered_at?: string
          external_lead_id?: string | null
          id?: string
          ingested_at?: string
          lead_source?: string | null
          opportunity_id?: string | null
          opportunity_stage?: string | null
          opportunity_status?: string | null
          opportunity_value?: number | null
          phone_normalized?: string | null
          raw_payload?: Json
          recdno?: string | null
          record_id?: string
          record_kind?: string
          vendor_updated_at?: string | null
          workgroup?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leadmaster_records_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          campaign: string | null
          client_ip_address: unknown
          client_user_agent: string | null
          company_id: string
          consent_reference: string | null
          contacted_at: string | null
          created_at: string
          email: string
          email_normalized: string | null
          external_lead_id: string | null
          fbc: string | null
          fbclid: string | null
          fbp: string | null
          first_contact_attempted_at: string | null
          first_contact_channel: string | null
          google_place_id: string | null
          id: string
          is_test: boolean
          meta_lead_id: string | null
          name: string
          notes: string | null
          original_lead_source: string | null
          phone: string
          phone_e164: string | null
          property_id: string | null
          service_requested: string
          source_account_id: string | null
          source_record_id: string | null
          source_submitted_at: string | null
          source_system: string
          speed_to_lead_status: string
          stage: Database["public"]["Enums"]["lead_stage"]
          submitted_address: string
          time_to_first_contact_seconds: number | null
          trustedform_url: string | null
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          campaign?: string | null
          client_ip_address?: unknown
          client_user_agent?: string | null
          company_id: string
          consent_reference?: string | null
          contacted_at?: string | null
          created_at?: string
          email: string
          email_normalized?: string | null
          external_lead_id?: string | null
          fbc?: string | null
          fbclid?: string | null
          fbp?: string | null
          first_contact_attempted_at?: string | null
          first_contact_channel?: string | null
          google_place_id?: string | null
          id?: string
          is_test?: boolean
          meta_lead_id?: string | null
          name: string
          notes?: string | null
          original_lead_source?: string | null
          phone: string
          phone_e164?: string | null
          property_id?: string | null
          service_requested?: string
          source_account_id?: string | null
          source_record_id?: string | null
          source_submitted_at?: string | null
          source_system?: string
          speed_to_lead_status?: string
          stage?: Database["public"]["Enums"]["lead_stage"]
          submitted_address: string
          time_to_first_contact_seconds?: number | null
          trustedform_url?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          campaign?: string | null
          client_ip_address?: unknown
          client_user_agent?: string | null
          company_id?: string
          consent_reference?: string | null
          contacted_at?: string | null
          created_at?: string
          email?: string
          email_normalized?: string | null
          external_lead_id?: string | null
          fbc?: string | null
          fbclid?: string | null
          fbp?: string | null
          first_contact_attempted_at?: string | null
          first_contact_channel?: string | null
          google_place_id?: string | null
          id?: string
          is_test?: boolean
          meta_lead_id?: string | null
          name?: string
          notes?: string | null
          original_lead_source?: string | null
          phone?: string
          phone_e164?: string | null
          property_id?: string | null
          service_requested?: string
          source_account_id?: string | null
          source_record_id?: string | null
          source_submitted_at?: string | null
          source_system?: string
          speed_to_lead_status?: string
          stage?: Database["public"]["Enums"]["lead_stage"]
          submitted_address?: string
          time_to_first_contact_seconds?: number | null
          trustedform_url?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_company_property_fkey"
            columns: ["company_id", "property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      meta_conversion_events: {
        Row: {
          created_at: string
          currency: string
          event_id: string
          event_name: string
          event_time: string
          id: string
          lead_id: string
          meta_response_body: Json | null
          meta_response_status: number | null
          value: number | null
        }
        Insert: {
          created_at?: string
          currency?: string
          event_id: string
          event_name: string
          event_time: string
          id?: string
          lead_id: string
          meta_response_body?: Json | null
          meta_response_status?: number | null
          value?: number | null
        }
        Update: {
          created_at?: string
          currency?: string
          event_id?: string
          event_name?: string
          event_time?: string
          id?: string
          lead_id?: string
          meta_response_body?: Json | null
          meta_response_status?: number | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_conversion_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_event_deliveries: {
        Row: {
          assessment_id: string | null
          attempt_count: number
          company_id: string
          consent_id: string
          created_at: string
          event_id: string
          event_name: string
          event_time: string
          id: string
          last_attempted_at: string | null
          last_error_category: string | null
          lead_id: string
          meta_http_status: number | null
          meta_trace_id: string | null
          payload_hash: string | null
          policy_version: string
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assessment_id?: string | null
          attempt_count?: number
          company_id: string
          consent_id: string
          created_at?: string
          event_id?: string
          event_name: string
          event_time: string
          id?: string
          last_attempted_at?: string | null
          last_error_category?: string | null
          lead_id: string
          meta_http_status?: number | null
          meta_trace_id?: string | null
          payload_hash?: string | null
          policy_version: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assessment_id?: string | null
          attempt_count?: number
          company_id?: string
          consent_id?: string
          created_at?: string
          event_id?: string
          event_name?: string
          event_time?: string
          id?: string
          last_attempted_at?: string | null
          last_error_category?: string | null
          lead_id?: string
          meta_http_status?: number | null
          meta_trace_id?: string | null
          payload_hash?: string | null
          policy_version?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_event_deliveries_company_id_assessment_id_fkey"
            columns: ["company_id", "assessment_id"]
            isOneToOne: false
            referencedRelation: "roof_assessments"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "meta_event_deliveries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_event_deliveries_company_id_lead_id_fkey"
            columns: ["company_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          company_id: string
          correlation_id: string | null
          created_at: string
          id: string
          lead_id: string | null
          read_at: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
        }
        Insert: {
          body?: string | null
          company_id: string
          correlation_id?: string | null
          created_at?: string
          id?: string
          lead_id?: string | null
          read_at?: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
        }
        Update: {
          body?: string | null
          company_id?: string
          correlation_id?: string | null
          created_at?: string
          id?: string
          lead_id?: string | null
          read_at?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
        }
        Relationships: [
          {
            foreignKeyName: "notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      observations: {
        Row: {
          company_id: string
          confidence: number
          created_at: string
          entity_id: string
          entity_type: string
          fact_type: string
          id: string
          method: Database["public"]["Enums"]["observation_method"]
          normalized_value: Json
          raw_value: Json | null
          source_record_id: string | null
          status: Database["public"]["Enums"]["observation_status"]
          transformation_version: string | null
          units: string | null
        }
        Insert: {
          company_id: string
          confidence: number
          created_at?: string
          entity_id: string
          entity_type: string
          fact_type: string
          id?: string
          method: Database["public"]["Enums"]["observation_method"]
          normalized_value: Json
          raw_value?: Json | null
          source_record_id?: string | null
          status?: Database["public"]["Enums"]["observation_status"]
          transformation_version?: string | null
          units?: string | null
        }
        Update: {
          company_id?: string
          confidence?: number
          created_at?: string
          entity_id?: string
          entity_type?: string
          fact_type?: string
          id?: string
          method?: Database["public"]["Enums"]["observation_method"]
          normalized_value?: Json
          raw_value?: Json | null
          source_record_id?: string | null
          status?: Database["public"]["Enums"]["observation_status"]
          transformation_version?: string | null
          units?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "observations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observations_source_record_id_fkey"
            columns: ["source_record_id"]
            isOneToOne: false
            referencedRelation: "source_records"
            referencedColumns: ["id"]
          },
        ]
      }
      paid_media_alerts: {
        Row: {
          alert_date: string
          alert_key: string
          company_id: string
          created_at: string
          delivered: boolean
          message: string
          severity: string
        }
        Insert: {
          alert_date: string
          alert_key: string
          company_id: string
          created_at?: string
          delivered?: boolean
          message: string
          severity: string
        }
        Update: {
          alert_date?: string
          alert_key?: string
          company_id?: string
          created_at?: string
          delivered?: boolean
          message?: string
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "paid_media_alerts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      parcels: {
        Row: {
          acreage: number | null
          block: string
          building_description: string | null
          company_id: string
          county: string | null
          created_at: string
          dwelling_units: number | null
          geometry: unknown
          gis_pin: string | null
          id: string
          improvement_value_cents: number | null
          is_primary: boolean
          land_description: string | null
          land_value_cents: number | null
          lot: string
          municipality_code: string | null
          municipality_name: string | null
          net_value_cents: number | null
          pams_pin: string | null
          property_class: string | null
          property_id: string
          property_location: string | null
          provider_request_id: string | null
          qualifier: string | null
          street_address: string | null
          year_built: number | null
        }
        Insert: {
          acreage?: number | null
          block: string
          building_description?: string | null
          company_id: string
          county?: string | null
          created_at?: string
          dwelling_units?: number | null
          geometry?: unknown
          gis_pin?: string | null
          id?: string
          improvement_value_cents?: number | null
          is_primary?: boolean
          land_description?: string | null
          land_value_cents?: number | null
          lot: string
          municipality_code?: string | null
          municipality_name?: string | null
          net_value_cents?: number | null
          pams_pin?: string | null
          property_class?: string | null
          property_id: string
          property_location?: string | null
          provider_request_id?: string | null
          qualifier?: string | null
          street_address?: string | null
          year_built?: number | null
        }
        Update: {
          acreage?: number | null
          block?: string
          building_description?: string | null
          company_id?: string
          county?: string | null
          created_at?: string
          dwelling_units?: number | null
          geometry?: unknown
          gis_pin?: string | null
          id?: string
          improvement_value_cents?: number | null
          is_primary?: boolean
          land_description?: string | null
          land_value_cents?: number | null
          lot?: string
          municipality_code?: string | null
          municipality_name?: string | null
          net_value_cents?: number | null
          pams_pin?: string | null
          property_class?: string | null
          property_id?: string
          property_location?: string | null
          provider_request_id?: string | null
          qualifier?: string | null
          street_address?: string | null
          year_built?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "parcels_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcels_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcels_provider_request_id_fkey"
            columns: ["provider_request_id"]
            isOneToOne: false
            referencedRelation: "provider_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_runs: {
        Row: {
          company_id: string
          correlation_id: string
          finished_at: string | null
          id: string
          lead_id: string | null
          pipeline_version: number
          property_id: string | null
          started_at: string
          status: Database["public"]["Enums"]["pipeline_status"]
        }
        Insert: {
          company_id: string
          correlation_id: string
          finished_at?: string | null
          id?: string
          lead_id?: string | null
          pipeline_version: number
          property_id?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["pipeline_status"]
        }
        Update: {
          company_id?: string
          correlation_id?: string
          finished_at?: string | null
          id?: string
          lead_id?: string | null
          pipeline_version?: number
          property_id?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["pipeline_status"]
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_runs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_runs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      privacy_consent_evidence: {
        Row: {
          advertising_granted: boolean
          analytics_granted: boolean
          company_id: string | null
          consent_id: string
          created_at: string
          evidence_id: string
          gpc_detected: boolean
          lead_id: string | null
          necessary_granted: boolean
          occurred_at: string
          policy_version: string
          request_ip: unknown
          source: string
          user_agent: string | null
        }
        Insert: {
          advertising_granted?: boolean
          analytics_granted?: boolean
          company_id?: string | null
          consent_id: string
          created_at?: string
          evidence_id: string
          gpc_detected: boolean
          lead_id?: string | null
          necessary_granted?: boolean
          occurred_at: string
          policy_version: string
          request_ip?: unknown
          source: string
          user_agent?: string | null
        }
        Update: {
          advertising_granted?: boolean
          analytics_granted?: boolean
          company_id?: string | null
          consent_id?: string
          created_at?: string
          evidence_id?: string
          gpc_detected?: boolean
          lead_id?: string | null
          necessary_granted?: boolean
          occurred_at?: string
          policy_version?: string
          request_ip?: unknown
          source?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "privacy_consent_evidence_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "privacy_consent_evidence_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          canonical_address: string | null
          company_id: string
          county: string | null
          created_at: string
          id: string
          location: unknown
          merged_into_property_id: string | null
          municipality: string | null
          resolution_status: string
          state_code: string
          updated_at: string
        }
        Insert: {
          canonical_address?: string | null
          company_id: string
          county?: string | null
          created_at?: string
          id?: string
          location?: unknown
          merged_into_property_id?: string | null
          municipality?: string | null
          resolution_status?: string
          state_code?: string
          updated_at?: string
        }
        Update: {
          canonical_address?: string | null
          company_id?: string
          county?: string | null
          created_at?: string
          id?: string
          location?: unknown
          merged_into_property_id?: string | null
          municipality?: string | null
          resolution_status?: string
          state_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "properties_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "properties_merged_into_property_id_fkey"
            columns: ["merged_into_property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_addresses: {
        Row: {
          approval_review_task_id: string | null
          approved_at: string | null
          approved_by: string | null
          assessment_access_attempt_id: string | null
          canonical_address: string | null
          company_id: string
          confidence: number
          county: string | null
          created_at: string
          evidence_source: string | null
          google_place_id: string | null
          id: string
          latitude: number | null
          location: unknown
          longitude: number | null
          match_method: Database["public"]["Enums"]["address_match_method"]
          municipality: string | null
          normalized_address: string | null
          property_id: string
          provider_duration_ms: number | null
          provider_request_id: string | null
          retrieved_at: string | null
          source_identifier: string | null
          state_code: string | null
          submitted_address: string
          worker_run_id: string | null
          zip: string | null
        }
        Insert: {
          approval_review_task_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          assessment_access_attempt_id?: string | null
          canonical_address?: string | null
          company_id: string
          confidence: number
          county?: string | null
          created_at?: string
          evidence_source?: string | null
          google_place_id?: string | null
          id?: string
          latitude?: number | null
          location?: unknown
          longitude?: number | null
          match_method: Database["public"]["Enums"]["address_match_method"]
          municipality?: string | null
          normalized_address?: string | null
          property_id: string
          provider_duration_ms?: number | null
          provider_request_id?: string | null
          retrieved_at?: string | null
          source_identifier?: string | null
          state_code?: string | null
          submitted_address: string
          worker_run_id?: string | null
          zip?: string | null
        }
        Update: {
          approval_review_task_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          assessment_access_attempt_id?: string | null
          canonical_address?: string | null
          company_id?: string
          confidence?: number
          county?: string | null
          created_at?: string
          evidence_source?: string | null
          google_place_id?: string | null
          id?: string
          latitude?: number | null
          location?: unknown
          longitude?: number | null
          match_method?: Database["public"]["Enums"]["address_match_method"]
          municipality?: string | null
          normalized_address?: string | null
          property_id?: string
          provider_duration_ms?: number | null
          provider_request_id?: string | null
          retrieved_at?: string | null
          source_identifier?: string | null
          state_code?: string | null
          submitted_address?: string
          worker_run_id?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "property_addresses_approval_review_task_id_fkey"
            columns: ["approval_review_task_id"]
            isOneToOne: false
            referencedRelation: "review_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_addresses_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "admin_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_addresses_company_access_attempt_fkey"
            columns: ["company_id", "assessment_access_attempt_id"]
            isOneToOne: false
            referencedRelation: "roof_assessment_access_attempts"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "property_addresses_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_addresses_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_addresses_provider_request_id_fkey"
            columns: ["provider_request_id"]
            isOneToOne: false
            referencedRelation: "provider_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_addresses_worker_run_id_fkey"
            columns: ["worker_run_id"]
            isOneToOne: true
            referencedRelation: "worker_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      property_preview_email_sends: {
        Row: {
          company_id: string
          email_normalized: string
          id: string
          preview_id: string
          sent_at: string
        }
        Insert: {
          company_id: string
          email_normalized: string
          id?: string
          preview_id: string
          sent_at?: string
        }
        Update: {
          company_id?: string
          email_normalized?: string
          id?: string
          preview_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_preview_email_sends_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_preview_email_sends_company_id_preview_id_fkey"
            columns: ["company_id", "preview_id"]
            isOneToOne: false
            referencedRelation: "property_previews"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      property_preview_email_suppressions: {
        Row: {
          company_id: string
          created_at: string
          email_normalized: string
        }
        Insert: {
          company_id: string
          created_at?: string
          email_normalized: string
        }
        Update: {
          company_id?: string
          created_at?: string
          email_normalized?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_preview_email_suppressions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      property_preview_rate_buckets: {
        Row: {
          bucket_key: string
          request_count: number
          window_start: string
        }
        Insert: {
          bucket_key: string
          request_count?: number
          window_start: string
        }
        Update: {
          bucket_key?: string
          request_count?: number
          window_start?: string
        }
        Relationships: []
      }
      property_previews: {
        Row: {
          address_mode: string
          attribution: Json
          campaign: string | null
          canonical_address: string | null
          company_id: string
          contact_viewed_at: string | null
          converted_lead_id: string | null
          created_at: string
          email_accepted_at: string | null
          email_disclosure_version: string | null
          entry_point: string
          experiment_arm: string
          expires_at: string
          google_place_id: string | null
          id: string
          ip_address: unknown
          latitude: number | null
          longitude: number | null
          measurement_status: string
          normalized_address: string
          place_resolved_at: string | null
          presentation_key: string
          privacy_consent_token: string | null
          processing_accepted_at: string
          processing_disclosure_version: string
          property_id: string
          referrer: string | null
          reminders_sent: number
          responses: Json
          reveal_mode: string
          revealed_at: string | null
          roof_insight_id: string | null
          saved_email: string | null
          saved_email_normalized: string | null
          status: string
          submission_id: string | null
          submitted_address: string
          token_hash: string
          unsubscribed_at: string | null
          updated_at: string
          user_agent: string
        }
        Insert: {
          address_mode: string
          attribution?: Json
          campaign?: string | null
          canonical_address?: string | null
          company_id: string
          contact_viewed_at?: string | null
          converted_lead_id?: string | null
          created_at?: string
          email_accepted_at?: string | null
          email_disclosure_version?: string | null
          entry_point: string
          experiment_arm?: string
          expires_at: string
          google_place_id?: string | null
          id?: string
          ip_address: unknown
          latitude?: number | null
          longitude?: number | null
          measurement_status?: string
          normalized_address: string
          place_resolved_at?: string | null
          presentation_key: string
          privacy_consent_token?: string | null
          processing_accepted_at: string
          processing_disclosure_version: string
          property_id: string
          referrer?: string | null
          reminders_sent?: number
          responses?: Json
          reveal_mode?: string
          revealed_at?: string | null
          roof_insight_id?: string | null
          saved_email?: string | null
          saved_email_normalized?: string | null
          status?: string
          submission_id?: string | null
          submitted_address: string
          token_hash: string
          unsubscribed_at?: string | null
          updated_at?: string
          user_agent: string
        }
        Update: {
          address_mode?: string
          attribution?: Json
          campaign?: string | null
          canonical_address?: string | null
          company_id?: string
          contact_viewed_at?: string | null
          converted_lead_id?: string | null
          created_at?: string
          email_accepted_at?: string | null
          email_disclosure_version?: string | null
          entry_point?: string
          experiment_arm?: string
          expires_at?: string
          google_place_id?: string | null
          id?: string
          ip_address?: unknown
          latitude?: number | null
          longitude?: number | null
          measurement_status?: string
          normalized_address?: string
          place_resolved_at?: string | null
          presentation_key?: string
          privacy_consent_token?: string | null
          processing_accepted_at?: string
          processing_disclosure_version?: string
          property_id?: string
          referrer?: string | null
          reminders_sent?: number
          responses?: Json
          reveal_mode?: string
          revealed_at?: string | null
          roof_insight_id?: string | null
          saved_email?: string | null
          saved_email_normalized?: string | null
          status?: string
          submission_id?: string | null
          submitted_address?: string
          token_hash?: string
          unsubscribed_at?: string | null
          updated_at?: string
          user_agent?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_previews_company_id_converted_lead_id_fkey"
            columns: ["company_id", "converted_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "property_previews_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_previews_company_id_property_id_fkey"
            columns: ["company_id", "property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "property_previews_roof_insight_id_fkey"
            columns: ["roof_insight_id"]
            isOneToOne: false
            referencedRelation: "roof_insights"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_add_ons: {
        Row: {
          adjustment_code: string | null
          calculation_kind: string
          company_id: string
          display_order: number
          explanation: string | null
          id: string
          included: boolean
          label: string
          proposal_id: string
          quantity: number
          unit_value: number
        }
        Insert: {
          adjustment_code?: string | null
          calculation_kind: string
          company_id: string
          display_order: number
          explanation?: string | null
          id?: string
          included?: boolean
          label: string
          proposal_id: string
          quantity?: number
          unit_value: number
        }
        Update: {
          adjustment_code?: string | null
          calculation_kind?: string
          company_id?: string
          display_order?: number
          explanation?: string | null
          id?: string
          included?: boolean
          label?: string
          proposal_id?: string
          quantity?: number
          unit_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "proposal_add_ons_company_id_proposal_id_fkey"
            columns: ["company_id", "proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      proposal_options: {
        Row: {
          company_id: string
          customer_description: string
          customer_name: string
          differentiators: Json
          display_order: number
          manufacturer_name: string | null
          price_per_square_cents: number
          product_line_id: string | null
          product_line_name: string | null
          proposal_id: string
          tier_key: string
          warranty_summary: string
        }
        Insert: {
          company_id: string
          customer_description: string
          customer_name: string
          differentiators?: Json
          display_order: number
          manufacturer_name?: string | null
          price_per_square_cents: number
          product_line_id?: string | null
          product_line_name?: string | null
          proposal_id: string
          tier_key: string
          warranty_summary: string
        }
        Update: {
          company_id?: string
          customer_description?: string
          customer_name?: string
          differentiators?: Json
          display_order?: number
          manufacturer_name?: string | null
          price_per_square_cents?: number
          product_line_id?: string | null
          product_line_name?: string | null
          proposal_id?: string
          tier_key?: string
          warranty_summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_options_company_id_proposal_id_fkey"
            columns: ["company_id", "proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "proposal_options_product_line_id_fkey"
            columns: ["product_line_id"]
            isOneToOne: false
            referencedRelation: "catalog_product_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      proposals: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          layers_to_remove: number | null
          lead_id: string
          measurement_ref: string | null
          measurement_source: string
          notes: string | null
          pitch_12: number | null
          pricing_version: string
          rate_card_id: string
          recommended_tier: string
          roof_squares: number
          sent_at: string | null
          status: string
          stories: number | null
          updated_at: string
          valid_until: string
          version: number
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          layers_to_remove?: number | null
          lead_id: string
          measurement_ref?: string | null
          measurement_source: string
          notes?: string | null
          pitch_12?: number | null
          pricing_version: string
          rate_card_id: string
          recommended_tier?: string
          roof_squares: number
          sent_at?: string | null
          status?: string
          stories?: number | null
          updated_at?: string
          valid_until: string
          version: number
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          layers_to_remove?: number | null
          lead_id?: string
          measurement_ref?: string | null
          measurement_source?: string
          notes?: string | null
          pitch_12?: number | null
          pricing_version?: string
          rate_card_id?: string
          recommended_tier?: string
          roof_squares?: number
          sent_at?: string | null
          status?: string
          stories?: number | null
          updated_at?: string
          valid_until?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "proposals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_company_id_lead_id_fkey"
            columns: ["company_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "proposals_company_id_rate_card_id_fkey"
            columns: ["company_id", "rate_card_id"]
            isOneToOne: false
            referencedRelation: "roof_pricing_rate_cards"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      provider_cost_entries: {
        Row: {
          actual_cost_micros: number | null
          created_at: string
          currency: string
          estimated_cost_micros: number
          id: string
          provider_request_id: string
        }
        Insert: {
          actual_cost_micros?: number | null
          created_at?: string
          currency?: string
          estimated_cost_micros?: number
          id?: string
          provider_request_id: string
        }
        Update: {
          actual_cost_micros?: number | null
          created_at?: string
          currency?: string
          estimated_cost_micros?: number
          id?: string
          provider_request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_cost_entries_provider_request_id_fkey"
            columns: ["provider_request_id"]
            isOneToOne: false
            referencedRelation: "provider_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_requests: {
        Row: {
          attempt: number
          capability: string
          company_id: string
          completed_at: string | null
          error_code: string | null
          error_message: string | null
          id: string
          pipeline_run_id: string | null
          provider: string
          request_key: string
          requested_at: string
          status: string
          worker_run_id: string | null
        }
        Insert: {
          attempt?: number
          capability: string
          company_id: string
          completed_at?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          pipeline_run_id?: string | null
          provider: string
          request_key: string
          requested_at?: string
          status: string
          worker_run_id?: string | null
        }
        Update: {
          attempt?: number
          capability?: string
          company_id?: string
          completed_at?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          pipeline_run_id?: string | null
          provider?: string
          request_key?: string
          requested_at?: string
          status?: string
          worker_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_requests_pipeline_run_id_fkey"
            columns: ["pipeline_run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_requests_worker_run_id_fkey"
            columns: ["worker_run_id"]
            isOneToOne: false
            referencedRelation: "worker_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_usage_monthly: {
        Row: {
          api_name: string
          call_limit: number
          period_start: string
          reserved_count: number
          updated_at: string
        }
        Insert: {
          api_name: string
          call_limit: number
          period_start: string
          reserved_count?: number
          updated_at?: string
        }
        Update: {
          api_name?: string
          call_limit?: number
          period_start?: string
          reserved_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      rep_identities: {
        Row: {
          company_id: string
          created_at: string
          external_email: string | null
          external_name: string | null
          external_user_id: string
          id: string
          match_method: string | null
          source_system: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          external_email?: string | null
          external_name?: string | null
          external_user_id: string
          id?: string
          match_method?: string | null
          source_system: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          external_email?: string | null
          external_name?: string | null
          external_user_id?: string
          id?: string
          match_method?: string | null
          source_system?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rep_identities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      reps: {
        Row: {
          bio: string | null
          community_connection: string | null
          company_id: string
          created_at: string
          credentials: string | null
          email: string | null
          id: string
          is_active: boolean
          name: string
          photo_url: string | null
          updated_at: string
        }
        Insert: {
          bio?: string | null
          community_connection?: string | null
          company_id: string
          created_at?: string
          credentials?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          photo_url?: string | null
          updated_at?: string
        }
        Update: {
          bio?: string | null
          community_connection?: string | null
          company_id?: string
          created_at?: string
          credentials?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          photo_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reps_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      review_tasks: {
        Row: {
          candidate_data: Json
          company_id: string
          created_at: string
          id: string
          lead_id: string
          pipeline_run_id: string
          property_id: string
          reason: Database["public"]["Enums"]["review_task_reason"]
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          retry_count: number
          status: Database["public"]["Enums"]["review_task_status"]
          triggering_event_name: string
          worker_run_id: string | null
        }
        Insert: {
          candidate_data?: Json
          company_id: string
          created_at?: string
          id?: string
          lead_id: string
          pipeline_run_id: string
          property_id: string
          reason: Database["public"]["Enums"]["review_task_reason"]
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          retry_count?: number
          status?: Database["public"]["Enums"]["review_task_status"]
          triggering_event_name: string
          worker_run_id?: string | null
        }
        Update: {
          candidate_data?: Json
          company_id?: string
          created_at?: string
          id?: string
          lead_id?: string
          pipeline_run_id?: string
          property_id?: string
          reason?: Database["public"]["Enums"]["review_task_reason"]
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          retry_count?: number
          status?: Database["public"]["Enums"]["review_task_status"]
          triggering_event_name?: string
          worker_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_tasks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_tasks_pipeline_run_id_fkey"
            columns: ["pipeline_run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_tasks_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "admin_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_tasks_worker_run_id_fkey"
            columns: ["worker_run_id"]
            isOneToOne: false
            referencedRelation: "worker_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      roof_assessment_access_attempts: {
        Row: {
          assessment_id: string
          attempt_kind: string
          company_id: string
          consumed_at: string | null
          continuation_secret_hash: string
          created_at: string
          destination_phone_e164: string
          estimate_id: string
          expires_at: string
          id: string
          lead_id: string
          property_id: string
          provider_attempt_id: string | null
          provider_attempt_metadata: Json
          request_ip: unknown
          requested_entry_point: string
          requested_presentation_key: string
          submission_id: string
          token_rotated_at: string | null
          updated_at: string
          verification_send_count: number
          verification_sent_at: string | null
          verification_started_at: string | null
          verified_at: string | null
        }
        Insert: {
          assessment_id: string
          attempt_kind: string
          company_id: string
          consumed_at?: string | null
          continuation_secret_hash: string
          created_at?: string
          destination_phone_e164: string
          estimate_id: string
          expires_at: string
          id?: string
          lead_id: string
          property_id: string
          provider_attempt_id?: string | null
          provider_attempt_metadata?: Json
          request_ip: unknown
          requested_entry_point: string
          requested_presentation_key: string
          submission_id: string
          token_rotated_at?: string | null
          updated_at?: string
          verification_send_count?: number
          verification_sent_at?: string | null
          verification_started_at?: string | null
          verified_at?: string | null
        }
        Update: {
          assessment_id?: string
          attempt_kind?: string
          company_id?: string
          consumed_at?: string | null
          continuation_secret_hash?: string
          created_at?: string
          destination_phone_e164?: string
          estimate_id?: string
          expires_at?: string
          id?: string
          lead_id?: string
          property_id?: string
          provider_attempt_id?: string | null
          provider_attempt_metadata?: Json
          request_ip?: unknown
          requested_entry_point?: string
          requested_presentation_key?: string
          submission_id?: string
          token_rotated_at?: string | null
          updated_at?: string
          verification_send_count?: number
          verification_sent_at?: string | null
          verification_started_at?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roof_assessment_access_attempts_company_id_assessment_id_fkey"
            columns: ["company_id", "assessment_id"]
            isOneToOne: false
            referencedRelation: "roof_assessments"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "roof_assessment_access_attempts_company_id_estimate_id_fkey"
            columns: ["company_id", "estimate_id"]
            isOneToOne: false
            referencedRelation: "roof_estimates"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "roof_assessment_access_attempts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roof_assessment_access_attempts_company_id_lead_id_fkey"
            columns: ["company_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "roof_assessment_access_attempts_company_id_property_id_fkey"
            columns: ["company_id", "property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      roof_assessment_consultation_attempts: {
        Row: {
          assessment_id: string
          company_id: string
          id: string
          request_ip: unknown
          reserved_at: string
        }
        Insert: {
          assessment_id: string
          company_id: string
          id?: string
          request_ip: unknown
          reserved_at?: string
        }
        Update: {
          assessment_id?: string
          company_id?: string
          id?: string
          request_ip?: unknown
          reserved_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roof_assessment_consultation_atte_company_id_assessment_id_fkey"
            columns: ["company_id", "assessment_id"]
            isOneToOne: false
            referencedRelation: "roof_assessments"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "roof_assessment_consultation_attempts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      roof_assessment_result_view_attempts: {
        Row: {
          id: string
          request_ip: unknown
          reserved_at: string
          token_hash: string
        }
        Insert: {
          id?: string
          request_ip: unknown
          reserved_at?: string
          token_hash: string
        }
        Update: {
          id?: string
          request_ip?: unknown
          reserved_at?: string
          token_hash?: string
        }
        Relationships: []
      }
      roof_assessment_verification_sends: {
        Row: {
          approved_at: string | null
          attempt_id: string
          company_id: string
          created_at: string
          destination_phone_e164: string
          id: string
          provider_attempt_id: string | null
          provider_status: string
          request_ip: unknown
          reserved_at: string
          sent_at: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          attempt_id: string
          company_id: string
          created_at?: string
          destination_phone_e164: string
          id?: string
          provider_attempt_id?: string | null
          provider_status?: string
          request_ip: unknown
          reserved_at?: string
          sent_at?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          attempt_id?: string
          company_id?: string
          created_at?: string
          destination_phone_e164?: string
          id?: string
          provider_attempt_id?: string | null
          provider_status?: string
          request_ip?: unknown
          reserved_at?: string
          sent_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roof_assessment_verification_sends_company_id_attempt_id_fkey"
            columns: ["company_id", "attempt_id"]
            isOneToOne: false
            referencedRelation: "roof_assessment_access_attempts"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "roof_assessment_verification_sends_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      roof_assessments: {
        Row: {
          abandoned_at: string | null
          assessment_version: string
          company_id: string
          completed_at: string | null
          current_step: number
          entry_point: string
          estimate_id: string
          id: string
          last_answered_at: string | null
          lead_id: string
          presentation_key: string
          property_revealed_at: string | null
          recommendation: string | null
          responses: Json
          result_viewed_at: string | null
          revision: number
          scores: Json
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          abandoned_at?: string | null
          assessment_version?: string
          company_id: string
          completed_at?: string | null
          current_step?: number
          entry_point?: string
          estimate_id: string
          id?: string
          last_answered_at?: string | null
          lead_id: string
          presentation_key?: string
          property_revealed_at?: string | null
          recommendation?: string | null
          responses?: Json
          result_viewed_at?: string | null
          revision?: number
          scores?: Json
          started_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          abandoned_at?: string | null
          assessment_version?: string
          company_id?: string
          completed_at?: string | null
          current_step?: number
          entry_point?: string
          estimate_id?: string
          id?: string
          last_answered_at?: string | null
          lead_id?: string
          presentation_key?: string
          property_revealed_at?: string | null
          recommendation?: string | null
          responses?: Json
          result_viewed_at?: string | null
          revision?: number
          scores?: Json
          started_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roof_assessments_company_estimate_fkey"
            columns: ["company_id", "estimate_id"]
            isOneToOne: false
            referencedRelation: "roof_estimates"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "roof_assessments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roof_assessments_company_lead_fkey"
            columns: ["company_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      roof_estimate_packages: {
        Row: {
          calculated_at: string
          company_id: string
          customer_description: string
          customer_name: string
          differentiators: Json
          display_order: number
          estimate_id: string
          high_cents_per_square: number
          id: string
          low_cents_per_square: number
          manufacturer_name: string | null
          measured_roof_squares: number
          pricing_version: string
          product_line_id: string | null
          product_line_name: string | null
          range_high_cents: number
          range_low_cents: number
          rate_card_id: string
          tier_key: string
          warranty_summary: string
        }
        Insert: {
          calculated_at?: string
          company_id: string
          customer_description: string
          customer_name: string
          differentiators: Json
          display_order: number
          estimate_id: string
          high_cents_per_square: number
          id?: string
          low_cents_per_square: number
          manufacturer_name?: string | null
          measured_roof_squares: number
          pricing_version: string
          product_line_id?: string | null
          product_line_name?: string | null
          range_high_cents: number
          range_low_cents: number
          rate_card_id: string
          tier_key: string
          warranty_summary: string
        }
        Update: {
          calculated_at?: string
          company_id?: string
          customer_description?: string
          customer_name?: string
          differentiators?: Json
          display_order?: number
          estimate_id?: string
          high_cents_per_square?: number
          id?: string
          low_cents_per_square?: number
          manufacturer_name?: string | null
          measured_roof_squares?: number
          pricing_version?: string
          product_line_id?: string | null
          product_line_name?: string | null
          range_high_cents?: number
          range_low_cents?: number
          rate_card_id?: string
          tier_key?: string
          warranty_summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "roof_estimate_packages_company_id_estimate_id_fkey"
            columns: ["company_id", "estimate_id"]
            isOneToOne: false
            referencedRelation: "roof_estimates"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "roof_estimate_packages_company_id_rate_card_id_fkey"
            columns: ["company_id", "rate_card_id"]
            isOneToOne: false
            referencedRelation: "roof_pricing_rate_cards"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "roof_estimate_packages_product_line_id_fkey"
            columns: ["product_line_id"]
            isOneToOne: false
            referencedRelation: "catalog_product_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      roof_estimates: {
        Row: {
          assumptions: Json
          company_id: string
          created_at: string
          failure_reason: string | null
          google_place_id: string | null
          id: string
          lead_id: string
          price_per_square_high_cents: number
          price_per_square_low_cents: number
          pricing_version: string
          property_id: string
          public_token: string
          range_high_cents: number | null
          range_low_cents: number | null
          reused_from_estimate_id: string | null
          roof_insight_id: string | null
          roof_squares: number | null
          status: string
          total_roof_sqft: number | null
          updated_at: string
        }
        Insert: {
          assumptions?: Json
          company_id: string
          created_at?: string
          failure_reason?: string | null
          google_place_id?: string | null
          id?: string
          lead_id: string
          price_per_square_high_cents?: number
          price_per_square_low_cents?: number
          pricing_version?: string
          property_id: string
          public_token?: string
          range_high_cents?: number | null
          range_low_cents?: number | null
          reused_from_estimate_id?: string | null
          roof_insight_id?: string | null
          roof_squares?: number | null
          status?: string
          total_roof_sqft?: number | null
          updated_at?: string
        }
        Update: {
          assumptions?: Json
          company_id?: string
          created_at?: string
          failure_reason?: string | null
          google_place_id?: string | null
          id?: string
          lead_id?: string
          price_per_square_high_cents?: number
          price_per_square_low_cents?: number
          pricing_version?: string
          property_id?: string
          public_token?: string
          range_high_cents?: number | null
          range_low_cents?: number | null
          reused_from_estimate_id?: string | null
          roof_insight_id?: string | null
          roof_squares?: number | null
          status?: string
          total_roof_sqft?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roof_estimates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roof_estimates_company_lead_fkey"
            columns: ["company_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "roof_estimates_company_property_fkey"
            columns: ["company_id", "property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "roof_estimates_company_property_insight_fkey"
            columns: ["company_id", "property_id", "roof_insight_id"]
            isOneToOne: false
            referencedRelation: "roof_insights"
            referencedColumns: ["company_id", "property_id", "id"]
          },
          {
            foreignKeyName: "roof_estimates_reused_from_estimate_id_fkey"
            columns: ["reused_from_estimate_id"]
            isOneToOne: false
            referencedRelation: "roof_estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      roof_insights: {
        Row: {
          building_name: string | null
          cache_expires_at: string
          company_id: string
          created_at: string
          google_place_id: string | null
          id: string
          imagery_date: string | null
          imagery_quality: string | null
          latitude: number | null
          longitude: number | null
          lookup_status: string
          normalized_address: string
          plane_count: number | null
          property_id: string
          provider: string
          raw_response: Json | null
          roof_segments: Json
          source_retrieved_at: string
          total_roof_sqft: number | null
          updated_at: string
        }
        Insert: {
          building_name?: string | null
          cache_expires_at?: string
          company_id: string
          created_at?: string
          google_place_id?: string | null
          id?: string
          imagery_date?: string | null
          imagery_quality?: string | null
          latitude?: number | null
          longitude?: number | null
          lookup_status: string
          normalized_address: string
          plane_count?: number | null
          property_id: string
          provider?: string
          raw_response?: Json | null
          roof_segments?: Json
          source_retrieved_at?: string
          total_roof_sqft?: number | null
          updated_at?: string
        }
        Update: {
          building_name?: string | null
          cache_expires_at?: string
          company_id?: string
          created_at?: string
          google_place_id?: string | null
          id?: string
          imagery_date?: string | null
          imagery_quality?: string | null
          latitude?: number | null
          longitude?: number | null
          lookup_status?: string
          normalized_address?: string
          plane_count?: number | null
          property_id?: string
          provider?: string
          raw_response?: Json | null
          roof_segments?: Json
          source_retrieved_at?: string
          total_roof_sqft?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roof_insights_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roof_insights_company_property_fkey"
            columns: ["company_id", "property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      roof_pricing_adjustments: {
        Row: {
          active: boolean
          adjustment_code: string
          calculation_kind: string
          company_id: string
          customer_explanation: string
          customer_label: string
          display_order: number
          high_value: number
          id: string
          low_value: number
          rate_card_id: string
        }
        Insert: {
          active?: boolean
          adjustment_code: string
          calculation_kind: string
          company_id: string
          customer_explanation: string
          customer_label: string
          display_order: number
          high_value: number
          id?: string
          low_value: number
          rate_card_id: string
        }
        Update: {
          active?: boolean
          adjustment_code?: string
          calculation_kind?: string
          company_id?: string
          customer_explanation?: string
          customer_label?: string
          display_order?: number
          high_value?: number
          id?: string
          low_value?: number
          rate_card_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roof_pricing_adjustments_company_id_rate_card_id_fkey"
            columns: ["company_id", "rate_card_id"]
            isOneToOne: false
            referencedRelation: "roof_pricing_rate_cards"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      roof_pricing_rate_cards: {
        Row: {
          company_id: string
          created_at: string
          currency_code: string
          effective_from: string
          effective_until: string | null
          id: string
          market: string
          name: string
          status: string
          updated_at: string
          version: string
        }
        Insert: {
          company_id: string
          created_at?: string
          currency_code?: string
          effective_from: string
          effective_until?: string | null
          id?: string
          market: string
          name: string
          status?: string
          updated_at?: string
          version: string
        }
        Update: {
          company_id?: string
          created_at?: string
          currency_code?: string
          effective_from?: string
          effective_until?: string | null
          id?: string
          market?: string
          name?: string
          status?: string
          updated_at?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "roof_pricing_rate_cards_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      roof_pricing_tiers: {
        Row: {
          company_id: string
          customer_description: string
          customer_name: string
          differentiators: Json
          display_order: number
          high_cents_per_square: number
          id: string
          internal_scope_code: string
          low_cents_per_square: number
          product_line_id: string | null
          rate_card_id: string
          tier_key: string
          warranty_summary: string
        }
        Insert: {
          company_id: string
          customer_description: string
          customer_name: string
          differentiators: Json
          display_order: number
          high_cents_per_square: number
          id?: string
          internal_scope_code: string
          low_cents_per_square: number
          product_line_id?: string | null
          rate_card_id: string
          tier_key: string
          warranty_summary: string
        }
        Update: {
          company_id?: string
          customer_description?: string
          customer_name?: string
          differentiators?: Json
          display_order?: number
          high_cents_per_square?: number
          id?: string
          internal_scope_code?: string
          low_cents_per_square?: number
          product_line_id?: string | null
          rate_card_id?: string
          tier_key?: string
          warranty_summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "roof_pricing_tiers_company_id_rate_card_id_fkey"
            columns: ["company_id", "rate_card_id"]
            isOneToOne: false
            referencedRelation: "roof_pricing_rate_cards"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "roof_pricing_tiers_product_line_id_fkey"
            columns: ["product_line_id"]
            isOneToOne: false
            referencedRelation: "catalog_product_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_messages: {
        Row: {
          body: string
          company_id: string
          created_at: string
          direction: string
          error_code: string | null
          from_e164: string
          id: string
          lead_id: string | null
          provider_sid: string | null
          read_at: string | null
          segments: number | null
          sent_by: string | null
          status: string
          status_updated_at: string
          to_e164: string
        }
        Insert: {
          body: string
          company_id: string
          created_at?: string
          direction: string
          error_code?: string | null
          from_e164: string
          id?: string
          lead_id?: string | null
          provider_sid?: string | null
          read_at?: string | null
          segments?: number | null
          sent_by?: string | null
          status: string
          status_updated_at?: string
          to_e164: string
        }
        Update: {
          body?: string
          company_id?: string
          created_at?: string
          direction?: string
          error_code?: string | null
          from_e164?: string
          id?: string
          lead_id?: string | null
          provider_sid?: string | null
          read_at?: string | null
          segments?: number | null
          sent_by?: string | null
          status?: string
          status_updated_at?: string
          to_e164?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_messages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      source_costs: {
        Row: {
          amount: number
          company_id: string
          cost_type: string
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          source_name: string
        }
        Insert: {
          amount: number
          company_id: string
          cost_type: string
          created_at?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          source_name: string
        }
        Update: {
          amount?: number
          company_id?: string
          cost_type?: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          source_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_costs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      source_records: {
        Row: {
          company_id: string
          effective_at: string | null
          id: string
          provider: string
          raw_payload: Json | null
          retrieved_at: string
          source_identifier: string
          source_url: string | null
        }
        Insert: {
          company_id: string
          effective_at?: string | null
          id?: string
          provider: string
          raw_payload?: Json | null
          retrieved_at: string
          source_identifier: string
          source_url?: string | null
        }
        Update: {
          company_id?: string
          effective_at?: string | null
          id?: string
          provider?: string
          raw_payload?: Json | null
          retrieved_at?: string
          source_identifier?: string
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_records_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      speed_to_lead_events: {
        Row: {
          channel: string | null
          event_type: string
          id: string
          lead_id: string
          metadata: Json
          occurred_at: string
        }
        Insert: {
          channel?: string | null
          event_type: string
          id?: string
          lead_id: string
          metadata?: Json
          occurred_at?: string
        }
        Update: {
          channel?: string | null
          event_type?: string
          id?: string
          lead_id?: string
          metadata?: Json
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "speed_to_lead_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      structures: {
        Row: {
          company_id: string
          created_at: string
          footprint_geometry: unknown
          id: string
          is_primary: boolean
          parcel_id: string | null
          property_id: string
          source: string
        }
        Insert: {
          company_id: string
          created_at?: string
          footprint_geometry?: unknown
          id?: string
          is_primary?: boolean
          parcel_id?: string | null
          property_id: string
          source: string
        }
        Update: {
          company_id?: string
          created_at?: string
          footprint_geometry?: unknown
          id?: string
          is_primary?: boolean
          parcel_id?: string | null
          property_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "structures_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "structures_parcel_id_fkey"
            columns: ["parcel_id"]
            isOneToOne: false
            referencedRelation: "parcels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "structures_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      suppression_list: {
        Row: {
          channel: string
          company_id: string
          created_at: string
          email_normalized: string | null
          id: string
          phone_e164: string | null
          reason: string
          source_system: string
        }
        Insert: {
          channel: string
          company_id: string
          created_at?: string
          email_normalized?: string | null
          id?: string
          phone_e164?: string | null
          reason: string
          source_system: string
        }
        Update: {
          channel?: string
          company_id?: string
          created_at?: string
          email_normalized?: string | null
          id?: string
          phone_e164?: string | null
          reason?: string
          source_system?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppression_list_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_to: string | null
          company_id: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_at: string | null
          id: string
          lead_id: string
          origin: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          company_id: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          lead_id: string
          origin?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          company_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          lead_id?: string
          origin?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "admin_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_status_mappings: {
        Row: {
          canonical_field: string
          canonical_value: string
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          mapping_basis: string
          mapping_notes: string | null
          mapping_version: number
          raw_status: string
          source_system: string
        }
        Insert: {
          canonical_field: string
          canonical_value: string
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          mapping_basis?: string
          mapping_notes?: string | null
          mapping_version?: number
          raw_status: string
          source_system: string
        }
        Update: {
          canonical_field?: string
          canonical_value?: string
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          mapping_basis?: string
          mapping_notes?: string | null
          mapping_version?: number
          raw_status?: string
          source_system?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_status_mappings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      website_arrivals: {
        Row: {
          campaign_slug: string | null
          company_id: string
          created_at: string
          experiment_arm: string | null
          fbclid: string | null
          gad_campaignid: string | null
          gad_source: string | null
          gbraid: string | null
          gclid: string | null
          google_ad_group_id: string | null
          google_campaign_id: string | null
          google_creative_id: string | null
          google_device: string | null
          google_keyword: string | null
          google_loc_physical_ms: string | null
          google_match_type: string | null
          google_network: string | null
          google_target_id: string | null
          id: string
          is_likely_bot: boolean
          meta_placement: string | null
          meta_site_source: string | null
          msclkid: string | null
          occurred_at: string
          referrer_host: string | null
          request_path: string
          user_agent: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          visitor_hash: string
          wbraid: string | null
        }
        Insert: {
          campaign_slug?: string | null
          company_id: string
          created_at?: string
          experiment_arm?: string | null
          fbclid?: string | null
          gad_campaignid?: string | null
          gad_source?: string | null
          gbraid?: string | null
          gclid?: string | null
          google_ad_group_id?: string | null
          google_campaign_id?: string | null
          google_creative_id?: string | null
          google_device?: string | null
          google_keyword?: string | null
          google_loc_physical_ms?: string | null
          google_match_type?: string | null
          google_network?: string | null
          google_target_id?: string | null
          id?: string
          is_likely_bot?: boolean
          meta_placement?: string | null
          meta_site_source?: string | null
          msclkid?: string | null
          occurred_at?: string
          referrer_host?: string | null
          request_path: string
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          visitor_hash: string
          wbraid?: string | null
        }
        Update: {
          campaign_slug?: string | null
          company_id?: string
          created_at?: string
          experiment_arm?: string | null
          fbclid?: string | null
          gad_campaignid?: string | null
          gad_source?: string | null
          gbraid?: string | null
          gclid?: string | null
          google_ad_group_id?: string | null
          google_campaign_id?: string | null
          google_creative_id?: string | null
          google_device?: string | null
          google_keyword?: string | null
          google_loc_physical_ms?: string | null
          google_match_type?: string | null
          google_network?: string | null
          google_target_id?: string | null
          id?: string
          is_likely_bot?: boolean
          meta_placement?: string | null
          meta_site_source?: string | null
          msclkid?: string | null
          occurred_at?: string
          referrer_host?: string | null
          request_path?: string
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          visitor_hash?: string
          wbraid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "website_arrivals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_runs: {
        Row: {
          attempt_count: number
          error: Json | null
          finished_at: string | null
          id: string
          idempotency_key: string
          input: Json
          output: Json | null
          pipeline_run_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["worker_status"]
          worker_type: string
          worker_version: number
        }
        Insert: {
          attempt_count?: number
          error?: Json | null
          finished_at?: string | null
          id?: string
          idempotency_key: string
          input?: Json
          output?: Json | null
          pipeline_run_id: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["worker_status"]
          worker_type: string
          worker_version: number
        }
        Update: {
          attempt_count?: number
          error?: Json | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string
          input?: Json
          output?: Json | null
          pipeline_run_id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["worker_status"]
          worker_type?: string
          worker_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "worker_runs_pipeline_run_id_fkey"
            columns: ["pipeline_run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      jobnimbus_job_roof_measurements: {
        Row: {
          area_weighted_pitch_12: number | null
          company_id: string | null
          facets: number | null
          file_jnid: string | null
          filename: string | null
          flat_squares: number | null
          job_jnid: string | null
          max_pitch_12: number | null
          pitch_area: Json | null
          predominant_pitch_12: number | null
          processed_at: string | null
          report_created_at: string | null
          total_squares: number | null
          two_layer_squares: number | null
          two_story_squares: number | null
          waste_ladder: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "jobnimbus_roofr_reports_company_id_file_jnid_fkey"
            columns: ["company_id", "file_jnid"]
            isOneToOne: true
            referencedRelation: "jn_files"
            referencedColumns: ["company_id", "jnid"]
          },
        ]
      }
      jobnimbus_reengagement_blind_spots: {
        Row: {
          appointment_at: string | null
          appointment_status: string | null
          company_id: string | null
          contact_id: string | null
          dashboard_state: string | null
          display_name: string | null
          job_id: string | null
          job_stage: string | null
          job_status: string | null
          vendor_updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobnimbus_jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      leadconduit_filtered_leads: {
        Row: {
          company_id: string | null
          email_normalized: string | null
          entered_at: string | null
          flow_id: string | null
          is_test: boolean | null
          lead_id: string | null
          lead_name: string | null
          likely_filter_category: string | null
          phone_normalized: string | null
          piw_reference: string | null
          source_id: string | null
          source_name: string | null
          stopped_at: string | null
          submitted_address: string | null
          submitted_email: string | null
          submitted_phone: string | null
          trustedform_url: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leadconduit_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_funnel_daily: {
        Row: {
          campaign_leads: number | null
          campaign_visitor_days: number | null
          company_id: string | null
          funnel_date: string | null
          main_site_leads: number | null
          main_site_visitor_days: number | null
          previews_contact_viewed: number | null
          previews_converted: number | null
          previews_created: number | null
          previews_revealed: number | null
          reports_saved: number | null
          value_first_campaign_visitor_days: number | null
          value_first_main_site_visitor_days: number | null
        }
        Relationships: []
      }
      reconciled_lead_routes: {
        Row: {
          appointment_at: string | null
          company_id: string | null
          flow_id: string | null
          jobnimbus_appointment_status: string | null
          jobnimbus_canonical_status: string | null
          jobnimbus_contact_id: string | null
          jobnimbus_job_id: string | null
          jobnimbus_mapping_basis: string | null
          jobnimbus_match_method: string | null
          jobnimbus_stage: string | null
          jobnimbus_status: string | null
          lead_entered_at: string | null
          lead_source: string | null
          leadconduit_canonical_status: string | null
          leadconduit_event_id: string | null
          leadconduit_lead_id: string | null
          leadconduit_mapping_basis: string | null
          leadconduit_outcome: string | null
          leadconduit_status: string | null
          leadmaster_canonical_status: string | null
          leadmaster_disposition: string | null
          leadmaster_entered_at: string | null
          leadmaster_mapping_basis: string | null
          leadmaster_match_method: string | null
          leadmaster_opportunity_stage: string | null
          leadmaster_opportunity_status: string | null
          leadmaster_recdno: string | null
          leadmaster_record_id: string | null
          sold_value: number | null
        }
        Relationships: [
          {
            foreignKeyName: "leadconduit_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      website_arrivals_daily: {
        Row: {
          ad_name: string | null
          arrival_date: string | null
          arrivals: number | null
          bot_arrivals: number | null
          campaign_slug: string | null
          company_id: string | null
          distinct_visitors: number | null
          meta_placement: string | null
          paid_arrivals: number | null
        }
        Relationships: [
          {
            foreignKeyName: "website_arrivals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      abandon_inactive_roof_assessments: {
        Args: { p_batch_size?: number }
        Returns: {
          assessment_id: string
        }[]
      }
      accept_activeprospect_booking_intake: {
        Args: {
          p_appointment_type: string
          p_company_id: string
          p_contact_owner: string
          p_flow_id: string
          p_payload: Json
        }
        Returns: {
          duplicate: boolean
          event: Json
          lead_id: string
          receipt_id: string
          state: string
        }[]
      }
      acknowledge_roof_assessment_result_view: {
        Args: {
          p_advertising_granted: boolean
          p_analytics_granted: boolean
          p_assessment_id: string
          p_company_id: string
          p_consent_id: string
          p_estimate_id: string
          p_gpc_detected: boolean
          p_policy_version: string
          p_request_ip: unknown
          p_source: string
          p_user_agent: string
        }
        Returns: {
          meta_delivery_id: string
          meta_event_id: string
          meta_event_name: string
          meta_event_time: string
          result_viewed_at: string
        }[]
      }
      activate_roof_pricing_rate_card: {
        Args: { p_company_id: string; p_rate_card_id: string }
        Returns: undefined
      }
      ad_conversion_consent_state: {
        Args: { p_at: string; p_company_id: string; p_lead_id: string }
        Returns: string
      }
      ad_conversion_order_id: {
        Args: { p_event_name: string; p_lead_id: string }
        Returns: string
      }
      apply_roof_assessment_property_prefetch: {
        Args: {
          p_attempt_id: string
          p_canonical_address: string
          p_company_id: string
          p_confidence: number
          p_county: string
          p_google_place_id: string
          p_latitude: number
          p_longitude: number
          p_match_method: Database["public"]["Enums"]["address_match_method"]
          p_municipality: string
          p_provider: string
          p_provider_duration_ms: number
          p_retrieved_at: string
          p_source_identifier: string
          p_state_code: string
          p_submitted_address: string
          p_zip: string
        }
        Returns: {
          assessment_id: string
          pipeline_run_id: string
          property_id: string
          side_effects_applied: boolean
        }[]
      }
      approve_verified_roof_assessment_resume: {
        Args: {
          p_attempt_id: string
          p_company_id: string
          p_provider_attempt_id: string
        }
        Returns: {
          assessment_id: string
          public_token: string
          token_rotated_at: string
        }[]
      }
      attach_customer_identity: {
        Args: {
          p_company_id: string
          p_email: string
          p_explicit_customer_id: string
          p_external_id: string
          p_phone: string
          p_seen_at: string
          p_source_name: string
          p_source_system: string
        }
        Returns: string
      }
      authorize_same_browser_roof_assessment_resume: {
        Args: {
          p_assessment_id: string
          p_attempt_id: string
          p_company_id: string
          p_continuation_secret_hash: string
        }
        Returns: {
          assessment_id: string
          public_token: string
          token_rotated_at: string
        }[]
      }
      book_virtual_consultation: {
        Args: {
          p_attendee_email: string
          p_customer_notes: string
          p_link_id: string
          p_request_ip: unknown
          p_starts_at: string
        }
        Returns: {
          appointment_id: string
          duration_minutes: number
          event: Json
          outcome: string
          problem: string
          revision: number
          scheduled_at: string
        }[]
      }
      cancel_virtual_consultation: {
        Args: { p_link_id: string; p_request_ip: unknown }
        Returns: {
          appointment_id: string
          event: Json
          outcome: string
          revision: number
        }[]
      }
      capture_jobnimbus_census: {
        Args: { p_company_id: string }
        Returns: string
      }
      change_lead_stage: {
        Args: {
          p_changed_by: string
          p_company_id: string
          p_lead_id: string
          p_note: string
          p_to_stage: Database["public"]["Enums"]["lead_stage"]
        }
        Returns: {
          from_stage: Database["public"]["Enums"]["lead_stage"]
        }[]
      }
      claim_ad_conversion: {
        Args: { p_delivery_id: string; p_now: string }
        Returns: {
          attempt_count: number
          click_id: string
          click_id_type: string
          company_id: string
          consent_model: string
          consent_state: string
          conversion_action_id: string
          conversion_time: string
          conversion_value: number
          created_at: string
          currency_code: string
          customer_id: string
          dry_run: boolean
          email: string
          event_name: string
          id: string
          identifier_only_uploads: boolean
          lead_id: string
          login_customer_id: string
          order_id: string
          phone_e164: string
          send_conversion_values: boolean
        }[]
      }
      claim_lead_distribution_delivery: {
        Args: { p_company_id: string; p_delivery_id: string; p_now: string }
        Returns: {
          attempt_count: number
          company_id: string
          delivery_id: string
          destination: string
          email: string
          lead_id: string
          name: string
          notes: string
          phone: string
          source_ip_address: unknown
          source_label: string
          source_submitted_at: string
          source_system: string
          source_user_agent: string
          submitted_address: string
          trustedform_url: string
          utm_campaign: string
          utm_source: string
        }[]
      }
      claim_meta_delivery: {
        Args: { p_claimed_at: string; p_delivery_id: string }
        Returns: {
          assessment_id: string | null
          attempt_count: number
          company_id: string
          consent_id: string
          created_at: string
          event_id: string
          event_name: string
          event_time: string
          id: string
          last_attempted_at: string | null
          last_error_category: string | null
          lead_id: string
          meta_http_status: number | null
          meta_trace_id: string | null
          payload_hash: string | null
          policy_version: string
          sent_at: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "meta_event_deliveries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_outbox_events: {
        Args: { p_claimed_by: string; p_limit: number }
        Returns: {
          attempt_count: number
          event_id: string
          payload: Json
        }[]
      }
      claim_property_address: {
        Args: {
          p_attempt: number
          p_canonical_address: string
          p_company_id: string
          p_confidence: number
          p_county: string
          p_latitude: number
          p_lead_id: string
          p_longitude: number
          p_match_method: Database["public"]["Enums"]["address_match_method"]
          p_municipality: string
          p_pipeline_run_id: string
          p_property_id: string
          p_provider_request_id: string
          p_state_code: string
          p_submitted_address: string
          p_worker_run_id: string
          p_zip: string
        }
        Returns: {
          candidate_property_ids: string[]
          canonical_property_id: string
          observation_property_id: string
          outcome: string
          side_effects_applied: boolean
        }[]
      }
      clear_lead_quality_flag: {
        Args: { p_lead_id: string }
        Returns: undefined
      }
      company_role_rank: { Args: { p_role: string }; Returns: number }
      complete_ad_conversion: {
        Args: {
          p_delivery_id: string
          p_error_category?: string
          p_http_status?: number
          p_now: string
          p_outcome: string
          p_payload_hash?: string
          p_request_id?: string
          p_sent_with_identifiers?: boolean
          p_sent_with_value?: boolean
          p_skip_reason?: string
        }
        Returns: {
          attempt_count: number
          company_id: string
          conversion_time: string
          conversion_value: number | null
          created_at: string
          event_name: string
          http_status: number | null
          id: string
          last_attempted_at: string | null
          last_error_category: string | null
          last_validated_at: string | null
          lead_id: string
          next_attempt_at: string
          order_id: string
          payload_hash: string | null
          platform: string
          request_id: string | null
          retracted_at: string | null
          retraction_attempt_count: number
          retraction_reason: string | null
          retraction_status: string
          sent_at: string | null
          sent_with_identifiers: boolean | null
          sent_with_value: boolean | null
          skip_reason: string | null
          source_ref: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "ad_conversion_deliveries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      complete_ad_conversion_retraction: {
        Args: {
          p_delivery_id: string
          p_error_category?: string
          p_now: string
          p_succeeded: boolean
        }
        Returns: undefined
      }
      complete_lead_distribution_delivery: {
        Args: {
          p_available_at: string
          p_delivery_id: string
          p_external_id: string
          p_last_error: string
          p_outcome: string
          p_status: string
        }
        Returns: {
          attempt_count: number
          available_at: string
          claimed_at: string | null
          company_id: string
          created_at: string
          destination: string
          external_id: string | null
          id: string
          last_error: string | null
          lead_id: string
          outcome: string | null
          pipeline_run_id: string
          sent_at: string | null
          source_label: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "lead_distribution_deliveries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      complete_meta_delivery: {
        Args: {
          p_completed_at: string
          p_delivery_id: string
          p_diagnostic: string
          p_meta_http_status: number
          p_payload_hash: string
          p_status: string
        }
        Returns: {
          assessment_id: string | null
          attempt_count: number
          company_id: string
          consent_id: string
          created_at: string
          event_id: string
          event_name: string
          event_time: string
          id: string
          last_attempted_at: string | null
          last_error_category: string | null
          lead_id: string
          meta_http_status: number | null
          meta_trace_id: string | null
          payload_hash: string | null
          policy_version: string
          sent_at: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "meta_event_deliveries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      complete_outbox_event: {
        Args: { p_event_id: string }
        Returns: undefined
      }
      complete_roof_assessment: {
        Args: {
          p_assessment_id: string
          p_company_id: string
          p_expected_responses: Json
          p_expected_revision: number
          p_high_intent: boolean
          p_recommendation: string
          p_response_patch: Json
          p_scores: Json
        }
        Returns: {
          applied: boolean
          current_step: number
          id: string
          last_answered_at: string
          property_revealed_at: string
          recommendation: string
          responses: Json
          revision: number
          status: string
        }[]
      }
      consume_property_preview_rate_limit: {
        Args: { p_bucket_key: string; p_limit: number; p_window: string }
        Returns: boolean
      }
      consume_roof_assessment_result_view_limit: {
        Args: { p_public_token: string; p_request_ip: unknown }
        Returns: {
          allowed: boolean
        }[]
      }
      create_company: {
        Args: { p_jobnimbus_env_key: string; p_name: string }
        Returns: string
      }
      create_property_preview: {
        Args: {
          p_address_mode: string
          p_attribution: Json
          p_campaign: string
          p_company_id: string
          p_daily_company_limit?: number
          p_entry_point: string
          p_google_place_id: string
          p_hourly_ip_limit?: number
          p_ip_address: string
          p_presentation_key: string
          p_processing_accepted_at: string
          p_processing_disclosure_version: string
          p_referrer: string
          p_submitted_address: string
          p_token_hash: string
          p_user_agent: string
        }
        Returns: {
          preview_id: string
          property_id: string
          rate_limited: boolean
          reused_property: boolean
        }[]
      }
      current_company_id: { Args: never; Returns: string }
      current_company_role: { Args: never; Returns: string }
      current_member_company_id: { Args: never; Returns: string }
      discover_jobnimbus_reps: {
        Args: { p_company_id: string }
        Returns: number
      }
      enqueue_domain_event: {
        Args: { p_company_id: string; p_event: Json }
        Returns: string
      }
      enqueue_google_ads_conversions: {
        Args: { p_company_id: string; p_now: string }
        Returns: Json
      }
      enqueue_roof_assessment_quote_pipeline_event: {
        Args: { p_attempt_id: string }
        Returns: string
      }
      ensure_booking_link: {
        Args: {
          p_company_id: string
          p_created_by: string
          p_lead_id: string
          p_source: string
        }
        Returns: {
          expires_at: string
          link_id: string
          reused: boolean
        }[]
      }
      escalate_property_identity_review: {
        Args: {
          p_attempt: number
          p_candidate_data: Json
          p_company_id: string
          p_lead_id: string
          p_pipeline_run_id: string
          p_property_id: string
          p_reason: Database["public"]["Enums"]["review_task_reason"]
          p_triggering_event_name: string
          p_worker_run_id: string
        }
        Returns: {
          created: boolean
          review_task_id: string
          side_effects_applied: boolean
          status: Database["public"]["Enums"]["review_task_status"]
        }[]
      }
      expire_property_previews: { Args: never; Returns: number }
      fail_outbox_event: {
        Args: { p_error: string; p_event_id: string }
        Returns: undefined
      }
      finalize_property_preview_conversion: {
        Args: {
          p_company_id: string
          p_submission_id: string
          p_token_hash: string
        }
        Returns: {
          attempt_kind: string
          lead_id: string
        }[]
      }
      finalize_roof_estimate_packages: {
        Args: {
          p_company_id: string
          p_estimate_id: string
          p_roof_insight_id: string
        }
        Returns: {
          calculated_at: string
          company_id: string
          customer_description: string
          customer_name: string
          differentiators: Json
          display_order: number
          estimate_id: string
          high_cents_per_square: number
          id: string
          low_cents_per_square: number
          manufacturer_name: string | null
          measured_roof_squares: number
          pricing_version: string
          product_line_id: string | null
          product_line_name: string | null
          range_high_cents: number
          range_low_cents: number
          rate_card_id: string
          tier_key: string
          warranty_summary: string
        }[]
        SetofOptions: {
          from: "*"
          to: "roof_estimate_packages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      flag_lead_quality: {
        Args: { p_flag: string; p_lead_id: string; p_note?: string }
        Returns: {
          company_id: string
          flag: string
          flagged_at: string
          flagged_by: string | null
          lead_id: string
          note: string | null
        }
        SetofOptions: {
          from: "*"
          to: "lead_quality_flags"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_my_access: {
        Args: never
        Returns: {
          company_id: string
          display_name: string
          is_platform_admin: boolean
          role: string
          user_id: string
        }[]
      }
      grant_company_membership: {
        Args: {
          p_company_id: string
          p_display_name: string
          p_email: string
          p_role: string
        }
        Returns: string
      }
      has_company_role: { Args: { p_minimum: string }; Returns: boolean }
      is_assigned_jobnimbus_rep: {
        Args: { p_company_id: string; p_sales_rep_jnid: string }
        Returns: boolean
      }
      is_platform_admin: { Args: never; Returns: boolean }
      is_scanner_request_path: { Args: { p_path: string }; Returns: boolean }
      is_suppressed: {
        Args: {
          p_channel: string
          p_company_id: string
          p_email_normalized: string
          p_phone_e164: string
        }
        Returns: boolean
      }
      land_jobnimbus_batch: {
        Args: {
          p_company_id: string
          p_record_type: string
          p_records: Json
          p_watermark: string
        }
        Returns: number
      }
      link_rep_identities_by_email: {
        Args: { p_company_id: string }
        Returns: number
      }
      list_company_members: {
        Args: never
        Returns: {
          confirmed: boolean
          display_name: string
          email: string
          invited_at: string
          is_active: boolean
          last_sign_in_at: string
          open_tasks: number
          role: string
          user_id: string
        }[]
      }
      list_due_ad_conversion_retractions: {
        Args: { p_limit: number; p_now: string }
        Returns: {
          company_id: string
          conversion_action_id: string
          customer_id: string
          dry_run: boolean
          event_name: string
          id: string
          login_customer_id: string
          order_id: string
        }[]
      }
      list_due_ad_conversions: {
        Args: { p_limit: number; p_now: string }
        Returns: {
          id: string
        }[]
      }
      list_my_companies: {
        Args: never
        Returns: {
          id: string
          is_current: boolean
          name: string
        }[]
      }
      list_pending_lead_distribution_deliveries: {
        Args: { p_company_id: string; p_limit: number; p_now: string }
        Returns: {
          delivery_id: string
          destination: string
          lead_id: string
          source_label: string
        }[]
      }
      list_pending_meta_deliveries: {
        Args: { p_limit: number; p_observed_at: string }
        Returns: {
          id: string
        }[]
      }
      lookup_ai_content_cache: {
        Args: {
          p_content_type: string
          p_context_key: string
          p_query_embedding?: string
          p_similarity_threshold?: number
        }
        Returns: {
          context_key: string
          generated_text: string
          id: string
          match_type: string
          similarity: number
        }[]
      }
      mark_integration_event_processed: {
        Args: {
          p_error_category?: string
          p_event_id: string
          p_outcome: string
        }
        Returns: undefined
      }
      mark_property_preview_progress: {
        Args: { p_company_id: string; p_step: string; p_token_hash: string }
        Returns: undefined
      }
      mark_roof_assessment_result_viewed: {
        Args: {
          p_assessment_id: string
          p_company_id: string
          p_estimate_id: string
        }
        Returns: {
          result_viewed_at: string
        }[]
      }
      mark_sms_read: { Args: { p_lead_id: string }; Returns: number }
      match_customer_by_contact: {
        Args: { p_company_id: string; p_email: string; p_phone: string }
        Returns: Record<string, unknown>
      }
      normalize_property_address: {
        Args: { p_address: string }
        Returns: string
      }
      paid_search_health: {
        Args: { p_company_id: string; p_now: string }
        Returns: Json
      }
      pipeline_jobnimbus: {
        Args: { p_limit?: number; p_since?: string; p_stage?: string }
        Returns: Json
      }
      platform_health: { Args: never; Returns: Json }
      prune_booking_attempts: { Args: never; Returns: number }
      purge_expired_click_ids: { Args: { p_now: string }; Returns: Json }
      record_integration_event: {
        Args: {
          p_company_id: string
          p_event_type: string
          p_idempotency_key: string
          p_raw_payload: Json
          p_source_system: string
        }
        Returns: {
          event_id: string
          is_duplicate: boolean
        }[]
      }
      record_privacy_consent: {
        Args: {
          p_advertising_granted: boolean
          p_analytics_granted: boolean
          p_company_id: string
          p_consent_id: string
          p_evidence_id: string
          p_gpc_detected: boolean
          p_lead_id: string
          p_occurred_at: string
          p_policy_version: string
          p_request_ip: unknown
          p_source: string
          p_user_agent: string
        }
        Returns: {
          evidence_id: string
        }[]
      }
      record_property_preview_responses: {
        Args: { p_company_id: string; p_responses: Json; p_token_hash: string }
        Returns: undefined
      }
      record_public_privacy_consent: {
        Args: {
          p_advertising_granted: boolean
          p_analytics_granted: boolean
          p_consent_id: string
          p_evidence_id: string
          p_gpc_detected: boolean
          p_occurred_at: string
          p_policy_version: string
          p_request_ip: unknown
          p_source: string
          p_user_agent: string
        }
        Returns: {
          advertising_granted: boolean
          analytics_granted: boolean
          consent_id: string
          evidence_id: string
          gpc_detected: boolean
          occurred_at: string
          policy_version: string
        }[]
      }
      record_roof_assessment_verification_start: {
        Args: {
          p_attempt_id: string
          p_company_id: string
          p_provider_attempt_id: string
          p_reservation_id: string
        }
        Returns: undefined
      }
      redact_leadconduit_checkpoint_contacts: {
        Args: {
          p_company_id: string
          p_delivered_after: string
          p_filtered_after: string
        }
        Returns: number
      }
      refresh_customer_journey: {
        Args: { p_company_id: string }
        Returns: Json
      }
      report_funnel: { Args: { p_from: string; p_to: string }; Returns: Json }
      report_jobs: { Args: { p_from: string; p_to: string }; Returns: Json }
      report_measurements: { Args: never; Returns: Json }
      report_paid_search: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      request_estimate_callback: {
        Args: {
          p_call_window: string
          p_due_at: string
          p_public_token: string
        }
        Returns: {
          call_window: string
          created: boolean
          task_id: string
        }[]
      }
      request_roof_consultation: {
        Args: {
          p_assessment_id: string
          p_call_window: string
          p_company_id: string
          p_contact_method: string
          p_estimate_id: string
          p_request_ip: unknown
          p_timezone: string
        }
        Returns: {
          call_window: string
          contact_method: string
          created_at: string
          request_id: string
          status: string
          timezone: string
        }[]
      }
      reschedule_virtual_consultation: {
        Args: { p_link_id: string; p_request_ip: unknown; p_starts_at: string }
        Returns: {
          appointment_id: string
          duration_minutes: number
          event: Json
          outcome: string
          problem: string
          revision: number
          scheduled_at: string
        }[]
      }
      reserve_meta_assessment_delivery: {
        Args: {
          p_assessment_id: string
          p_company_id: string
          p_consent_id: string
          p_event_time: string
          p_policy_version: string
        }
        Returns: {
          assessment_id: string | null
          attempt_count: number
          company_id: string
          consent_id: string
          created_at: string
          event_id: string
          event_name: string
          event_time: string
          id: string
          last_attempted_at: string | null
          last_error_category: string | null
          lead_id: string
          meta_http_status: number | null
          meta_trace_id: string | null
          payload_hash: string | null
          policy_version: string
          sent_at: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "meta_event_deliveries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      reserve_meta_lead_delivery: {
        Args: {
          p_company_id: string
          p_consent_id: string
          p_event_time: string
          p_lead_id: string
          p_policy_version: string
        }
        Returns: {
          assessment_id: string | null
          attempt_count: number
          company_id: string
          consent_id: string
          created_at: string
          event_id: string
          event_name: string
          event_time: string
          id: string
          last_attempted_at: string | null
          last_error_category: string | null
          lead_id: string
          meta_http_status: number | null
          meta_trace_id: string | null
          payload_hash: string | null
          policy_version: string
          sent_at: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "meta_event_deliveries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      reserve_meta_qualified_lead_delivery: {
        Args: {
          p_company_id: string
          p_consent_id: string
          p_event_time: string
          p_lead_id: string
          p_policy_version: string
        }
        Returns: {
          assessment_id: string | null
          attempt_count: number
          company_id: string
          consent_id: string
          created_at: string
          event_id: string
          event_name: string
          event_time: string
          id: string
          last_attempted_at: string | null
          last_error_category: string | null
          lead_id: string
          meta_http_status: number | null
          meta_trace_id: string | null
          payload_hash: string | null
          policy_version: string
          sent_at: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "meta_event_deliveries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      reserve_provider_usage: {
        Args: { p_api_name: string; p_limit: number; p_period_start: string }
        Returns: {
          allowed: boolean
          call_limit: number
          reserved_count: number
        }[]
      }
      reserve_roof_assessment_verification_start: {
        Args: { p_attempt_id: string; p_request_ip: unknown }
        Returns: {
          company_id: string
          destination_phone_e164: string
          reservation_id: string
          reserved_at: string
        }[]
      }
      resolve_review_task: {
        Args: {
          p_action: string
          p_admin_id: string
          p_company_id: string
          p_notes: string
          p_review_task_id: string
          p_selected_candidate_index: number
        }
        Returns: {
          new_status: Database["public"]["Enums"]["review_task_status"]
          next_attempt: number
          pipeline_run_id: string
          property_id: string
        }[]
      }
      resolve_roof_assessment_property_prefetch_scope: {
        Args: {
          attempt_id: string
          company_id: string
          google_place_id: string
        }
        Returns: {
          assessment_id: string
          eligible: boolean
          pipeline_run_id: string
          property_id: string
        }[]
      }
      reuse_roof_estimate_packages: {
        Args: {
          p_company_id: string
          p_source_estimate_id: string
          p_target_estimate_id: string
        }
        Returns: {
          calculated_at: string
          company_id: string
          customer_description: string
          customer_name: string
          differentiators: Json
          display_order: number
          estimate_id: string
          high_cents_per_square: number
          id: string
          low_cents_per_square: number
          manufacturer_name: string | null
          measured_roof_squares: number
          pricing_version: string
          product_line_id: string | null
          product_line_name: string | null
          range_high_cents: number
          range_low_cents: number
          rate_card_id: string
          tier_key: string
          warranty_summary: string
        }[]
        SetofOptions: {
          from: "*"
          to: "roof_estimate_packages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      rotate_roof_estimate_public_token: {
        Args: { p_attempt_id: string; p_company_id: string }
        Returns: {
          assessment_id: string
          public_token: string
          token_rotated_at: string
        }[]
      }
      save_booking_settings: {
        Args: {
          p_company_id: string
          p_settings: Json
          p_updated_by: string
          p_windows: Json
        }
        Returns: {
          is_enabled: boolean
          updated_at: string
        }[]
      }
      save_property_preview_email: {
        Args: {
          p_accepted_at: string
          p_company_id: string
          p_daily_limit?: number
          p_disclosure_version: string
          p_email: string
          p_token_hash: string
        }
        Returns: {
          allowed: boolean
          preview_id: string
        }[]
      }
      save_roof_assessment_ownership: {
        Args: {
          p_assessment_id: string
          p_company_id: string
          p_expected_revision: number
          p_high_intent: boolean
          p_ownership: string
          p_scores: Json
        }
        Returns: {
          applied: boolean
          current_step: number
          id: string
          last_answered_at: string
          property_revealed_at: string
          recommendation: string
          responses: Json
          revision: number
          status: string
        }[]
      }
      save_roof_assessment_progress: {
        Args: {
          p_assessment_id: string
          p_company_id: string
          p_current_step: number
          p_expected_responses: Json
          p_expected_revision: number
          p_high_intent: boolean
          p_property_revealed_at: string
          p_response_patch: Json
          p_scores: Json
        }
        Returns: {
          applied: boolean
          current_step: number
          id: string
          last_answered_at: string
          property_revealed_at: string
          recommendation: string
          responses: Json
          revision: number
          status: string
        }[]
      }
      staff_cancel_virtual_consultation: {
        Args: { p_appointment_id: string; p_company_id: string }
        Returns: {
          event: Json
          outcome: string
          revision: number
        }[]
      }
      start_or_resume_roof_assessment: {
        Args: {
          p_attribution: Json
          p_company_id: string
          p_consent_granted_at: string
          p_disclosure_version: string
          p_email_normalized: string
          p_entry_point: string
          p_google_place_id: string
          p_ip_address: string
          p_name: string
          p_phone_e164: string
          p_presentation_key: string
          p_referrer: string
          p_submission_id: string
          p_submitted_address: string
          p_user_agent: string
        }
        Returns: {
          attempt_id: string
          continuation_secret: string
          expires_at: string
          is_replay: boolean
        }[]
      }
      submit_all_season_campaign_estimate: {
        Args: {
          p_attribution: Json
          p_campaign_slug: string
          p_company_id: string
          p_correlation_id: string
          p_disclosure_version: string
          p_email: string
          p_google_place_id?: string
          p_ip_address: string
          p_name: string
          p_phone: string
          p_pipeline_version: number
          p_submission_id: string
          p_submitted_address: string
          p_submitted_at: string
          p_user_agent: string
        }
        Returns: {
          estimate_id: string
          event_id: string
          event_payload: Json
          is_duplicate: boolean
          lead_id: string
          pipeline_run_id: string
          property_id: string
          public_token: string
        }[]
      }
      submit_all_season_lead: {
        Args: {
          p_attribution: Json
          p_company_id: string
          p_disclosure_version: string
          p_email: string
          p_email_normalized: string
          p_google_place_id: string
          p_ip_address: string
          p_name: string
          p_phone: string
          p_phone_e164: string
          p_pipeline_version: number
          p_service_requested: string
          p_submission_id: string
          p_submitted_address: string
          p_submitted_at: string
          p_user_agent: string
        }
        Returns: {
          is_duplicate: boolean
          lead_id: string
          pipeline_run_id: string
          property_id: string
        }[]
      }
      submit_lead_intake: {
        Args: {
          p_company_id: string
          p_correlation_id: string
          p_email: string
          p_name: string
          p_notes: string
          p_phone: string
          p_pipeline_version: number
          p_submitted_address: string
        }
        Returns: {
          lead_id: string
          pipeline_run_id: string
          property_id: string
        }[]
      }
      submit_lead_intake_from_source: {
        Args: {
          p_campaign?: string
          p_company_id: string
          p_consent_reference?: string
          p_correlation_id: string
          p_email: string
          p_email_normalized?: string
          p_external_lead_id?: string
          p_is_test?: boolean
          p_name: string
          p_notes: string
          p_original_lead_source?: string
          p_phone: string
          p_phone_e164?: string
          p_pipeline_version: number
          p_source_account_id?: string
          p_source_record_id?: string
          p_source_system: string
          p_submitted_address: string
          p_trustedform_url?: string
        }
        Returns: {
          is_duplicate: boolean
          lead_id: string
          pipeline_run_id: string
          property_id: string
        }[]
      }
      submit_roof_estimate_lead: {
        Args: {
          p_company_id: string
          p_correlation_id: string
          p_disclosure_version: string
          p_email: string
          p_google_place_id?: string
          p_ip_address: string
          p_name: string
          p_phone: string
          p_pipeline_version: number
          p_submitted_address: string
          p_user_agent: string
        }
        Returns: {
          estimate_id: string
          lead_id: string
          pipeline_run_id: string
          property_id: string
          public_token: string
        }[]
      }
      switch_active_company: {
        Args: { p_company_id: string }
        Returns: undefined
      }
      update_company_member: {
        Args: { p_is_active: boolean; p_role: string; p_user_id: string }
        Returns: undefined
      }
      upsert_leadconduit_event_batch: {
        Args: {
          p_channel: string
          p_company_id: string
          p_events: Json
          p_observed_at: string
        }
        Returns: number
      }
      virtual_consultation_slot_problem: {
        Args: {
          p_company_id: string
          p_exclude_appointment_id: string
          p_now: string
          p_starts_at: string
        }
        Returns: string
      }
    }
    Enums: {
      address_match_method:
        | "exact_single_match"
        | "no_match"
        | "multiple_matches"
      appointment_rep_intro_status: "queued" | "sent" | "failed"
      appointment_status:
        | "scheduled"
        | "confirmed"
        | "completed"
        | "cancelled"
        | "no_show"
      interaction_type: "call" | "email" | "text" | "site_visit" | "note"
      job_inspection_status:
        | "scheduled"
        | "passed"
        | "failed"
        | "cancelled"
        | "rescheduled"
      job_permit_status:
        | "not_started"
        | "pending_submission"
        | "submitted"
        | "under_review"
        | "approved"
        | "rejected"
        | "expired"
      job_status: "active" | "on_hold" | "complete" | "cancelled"
      lead_stage:
        | "new"
        | "contacting"
        | "appointment_set"
        | "estimating"
        | "proposal_sent"
        | "won"
        | "lost"
        | "nurture"
      notification_type:
        | "lead_submitted"
        | "review_task_created"
        | "pipeline_stuck"
        | "pipeline_failed"
        | "callback_requested"
      observation_method: "measured" | "calculated" | "assumed" | "reported"
      observation_status: "current" | "superseded" | "disputed" | "rejected"
      pipeline_status:
        | "received"
        | "validating"
        | "enriching"
        | "analyzing"
        | "scoring"
        | "estimating"
        | "complete"
        | "partial"
        | "review_required"
        | "failed"
      review_task_reason:
        | "low_address_confidence"
        | "duplicate_candidates"
        | "multiple_parcels"
        | "condo_ambiguity"
        | "commercial_property"
        | "unsupported_property_type"
      review_task_status:
        | "open"
        | "resolved"
        | "rejected"
        | "retried"
        | "unsupported"
      task_status: "open" | "complete" | "cancelled"
      worker_status:
        | "queued"
        | "running"
        | "completed"
        | "partial"
        | "review_required"
        | "failed"
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
      address_match_method: [
        "exact_single_match",
        "no_match",
        "multiple_matches",
      ],
      appointment_rep_intro_status: ["queued", "sent", "failed"],
      appointment_status: [
        "scheduled",
        "confirmed",
        "completed",
        "cancelled",
        "no_show",
      ],
      interaction_type: ["call", "email", "text", "site_visit", "note"],
      job_inspection_status: [
        "scheduled",
        "passed",
        "failed",
        "cancelled",
        "rescheduled",
      ],
      job_permit_status: [
        "not_started",
        "pending_submission",
        "submitted",
        "under_review",
        "approved",
        "rejected",
        "expired",
      ],
      job_status: ["active", "on_hold", "complete", "cancelled"],
      lead_stage: [
        "new",
        "contacting",
        "appointment_set",
        "estimating",
        "proposal_sent",
        "won",
        "lost",
        "nurture",
      ],
      notification_type: [
        "lead_submitted",
        "review_task_created",
        "pipeline_stuck",
        "pipeline_failed",
        "callback_requested",
      ],
      observation_method: ["measured", "calculated", "assumed", "reported"],
      observation_status: ["current", "superseded", "disputed", "rejected"],
      pipeline_status: [
        "received",
        "validating",
        "enriching",
        "analyzing",
        "scoring",
        "estimating",
        "complete",
        "partial",
        "review_required",
        "failed",
      ],
      review_task_reason: [
        "low_address_confidence",
        "duplicate_candidates",
        "multiple_parcels",
        "condo_ambiguity",
        "commercial_property",
        "unsupported_property_type",
      ],
      review_task_status: [
        "open",
        "resolved",
        "rejected",
        "retried",
        "unsupported",
      ],
      task_status: ["open", "complete", "cancelled"],
      worker_status: [
        "queued",
        "running",
        "completed",
        "partial",
        "review_required",
        "failed",
      ],
    },
  },
} as const

