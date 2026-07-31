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
          company_id: string
          created_at: string
          created_by: string | null
          duration_minutes: number | null
          id: string
          lead_id: string
          notes: string | null
          rep_id: string | null
          scheduled_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          duration_minutes?: number | null
          id?: string
          lead_id: string
          notes?: string | null
          rep_id?: string | null
          scheduled_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          duration_minutes?: number | null
          id?: string
          lead_id?: string
          notes?: string | null
          rep_id?: string | null
          scheduled_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Relationships: [
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
      leads: {
        Row: {
          campaign: string | null
          company_id: string
          consent_reference: string | null
          created_at: string
          email: string
          email_normalized: string | null
          external_lead_id: string | null
          id: string
          is_test: boolean
          name: string
          notes: string | null
          original_lead_source: string | null
          phone: string
          phone_e164: string | null
          property_id: string | null
          service_requested: string
          source_account_id: string | null
          source_record_id: string | null
          source_system: string
          stage: Database["public"]["Enums"]["lead_stage"]
          submitted_address: string
          trustedform_url: string | null
          updated_at: string
        }
        Insert: {
          campaign?: string | null
          company_id: string
          consent_reference?: string | null
          created_at?: string
          email: string
          email_normalized?: string | null
          external_lead_id?: string | null
          id?: string
          is_test?: boolean
          name: string
          notes?: string | null
          original_lead_source?: string | null
          phone: string
          phone_e164?: string | null
          property_id?: string | null
          service_requested?: string
          source_account_id?: string | null
          source_record_id?: string | null
          source_system?: string
          stage?: Database["public"]["Enums"]["lead_stage"]
          submitted_address: string
          trustedform_url?: string | null
          updated_at?: string
        }
        Update: {
          campaign?: string | null
          company_id?: string
          consent_reference?: string | null
          created_at?: string
          email?: string
          email_normalized?: string | null
          external_lead_id?: string | null
          id?: string
          is_test?: boolean
          name?: string
          notes?: string | null
          original_lead_source?: string | null
          phone?: string
          phone_e164?: string | null
          property_id?: string | null
          service_requested?: string
          source_account_id?: string | null
          source_record_id?: string | null
          source_system?: string
          stage?: Database["public"]["Enums"]["lead_stage"]
          submitted_address?: string
          trustedform_url?: string | null
          updated_at?: string
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
            foreignKeyName: "leads_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
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
          canonical_address: string | null
          company_id: string
          confidence: number
          county: string | null
          created_at: string
          id: string
          latitude: number | null
          location: unknown
          longitude: number | null
          match_method: Database["public"]["Enums"]["address_match_method"]
          municipality: string | null
          normalized_address: string | null
          property_id: string
          provider_request_id: string | null
          state_code: string | null
          submitted_address: string
          worker_run_id: string
          zip: string | null
        }
        Insert: {
          approval_review_task_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          canonical_address?: string | null
          company_id: string
          confidence: number
          county?: string | null
          created_at?: string
          id?: string
          latitude?: number | null
          location?: unknown
          longitude?: number | null
          match_method: Database["public"]["Enums"]["address_match_method"]
          municipality?: string | null
          normalized_address?: string | null
          property_id: string
          provider_request_id?: string | null
          state_code?: string | null
          submitted_address: string
          worker_run_id: string
          zip?: string | null
        }
        Update: {
          approval_review_task_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          canonical_address?: string | null
          company_id?: string
          confidence?: number
          county?: string | null
          created_at?: string
          id?: string
          latitude?: number | null
          location?: unknown
          longitude?: number | null
          match_method?: Database["public"]["Enums"]["address_match_method"]
          municipality?: string | null
          normalized_address?: string | null
          property_id?: string
          provider_request_id?: string | null
          state_code?: string | null
          submitted_address?: string
          worker_run_id?: string
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
      reps: {
        Row: {
          bio: string | null
          community_connection: string | null
          company_id: string
          created_at: string
          credentials: string | null
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
      [_ in never]: never
    }
    Functions: {
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
      complete_outbox_event: {
        Args: { p_event_id: string }
        Returns: undefined
      }
      current_company_id: { Args: never; Returns: string }
      enqueue_domain_event: {
        Args: { p_company_id: string; p_event: Json }
        Returns: string
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
      fail_outbox_event: {
        Args: { p_error: string; p_event_id: string }
        Returns: undefined
      }
      is_suppressed: {
        Args: {
          p_channel: string
          p_company_id: string
          p_email_normalized: string
          p_phone_e164: string
        }
        Returns: boolean
      }
      mark_integration_event_processed: {
        Args: {
          p_error_category?: string
          p_event_id: string
          p_outcome: string
        }
        Returns: undefined
      }
      normalize_property_address: {
        Args: { p_address: string }
        Returns: string
      }
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

