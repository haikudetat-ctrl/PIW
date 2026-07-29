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
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
          company_id: string
          created_at: string
          email: string
          id: string
          name: string
          notes: string | null
          phone: string
          property_id: string | null
          service_requested: string
          stage: Database["public"]["Enums"]["lead_stage"]
          submitted_address: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          email: string
          id?: string
          name: string
          notes?: string | null
          phone: string
          property_id?: string | null
          service_requested?: string
          stage?: Database["public"]["Enums"]["lead_stage"]
          submitted_address: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          email?: string
          id?: string
          name?: string
          notes?: string | null
          phone?: string
          property_id?: string | null
          service_requested?: string
          stage?: Database["public"]["Enums"]["lead_stage"]
          submitted_address?: string
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
          capability: string
          company_id: string
          completed_at: string | null
          id: string
          pipeline_run_id: string | null
          provider: string
          request_key: string
          requested_at: string
          status: string
        }
        Insert: {
          capability: string
          company_id: string
          completed_at?: string | null
          id?: string
          pipeline_run_id?: string | null
          provider: string
          request_key: string
          requested_at?: string
          status: string
        }
        Update: {
          capability?: string
          company_id?: string
          completed_at?: string | null
          id?: string
          pipeline_run_id?: string | null
          provider?: string
          request_key?: string
          requested_at?: string
          status?: string
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
      complete_outbox_event: {
        Args: { p_event_id: string }
        Returns: undefined
      }
      current_company_id: { Args: never; Returns: string }
      enqueue_domain_event: {
        Args: { p_company_id: string; p_event: Json }
        Returns: string
      }
      fail_outbox_event: {
        Args: { p_error: string; p_event_id: string }
        Returns: undefined
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
    }
    Enums: {
      interaction_type: "call" | "email" | "text" | "site_visit" | "note"
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
      interaction_type: ["call", "email", "text", "site_visit", "note"],
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

