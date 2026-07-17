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
      anon_rate_limit_events: {
        Row: {
          bucket: string
          created_at: string
          id: number
          ip_hash: string
        }
        Insert: {
          bucket: string
          created_at?: string
          id?: never
          ip_hash: string
        }
        Update: {
          bucket?: string
          created_at?: string
          id?: never
          ip_hash?: string
        }
        Relationships: []
      }
      clients: {
        Row: {
          channel: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          deleted_at: string | null
          id: string
          is_demo: boolean
          memo: string | null
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          channel: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_demo?: boolean
          memo?: string | null
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_demo?: boolean
          memo?: string | null
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      contract_events: {
        Row: {
          actor: string
          contract_id: string
          created_at: string
          event_type: string
          from_status: string | null
          id: string
          meta: Json
          to_status: string
          user_id: string
        }
        Insert: {
          actor: string
          contract_id: string
          created_at?: string
          event_type: string
          from_status?: string | null
          id?: string
          meta?: Json
          to_status: string
          user_id: string
        }
        Update: {
          actor?: string
          contract_id?: string
          created_at?: string
          event_type?: string
          from_status?: string | null
          id?: string
          meta?: Json
          to_status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_events_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_signatures: {
        Row: {
          consent: Json
          contract_id: string
          doc_hash: string
          id: string
          meta: Json
          party: Database["public"]["Enums"]["contract_signature_party"]
          request_id: string | null
          signature_image_data: string | null
          signature_image_path: string | null
          signed_at: string
          signer_email: string | null
          signer_name: string | null
          user_id: string
        }
        Insert: {
          consent?: Json
          contract_id: string
          doc_hash: string
          id?: string
          meta?: Json
          party: Database["public"]["Enums"]["contract_signature_party"]
          request_id?: string | null
          signature_image_data?: string | null
          signature_image_path?: string | null
          signed_at?: string
          signer_email?: string | null
          signer_name?: string | null
          user_id: string
        }
        Update: {
          consent?: Json
          contract_id?: string
          doc_hash?: string
          id?: string
          meta?: Json
          party?: Database["public"]["Enums"]["contract_signature_party"]
          request_id?: string | null
          signature_image_data?: string | null
          signature_image_path?: string | null
          signed_at?: string
          signer_email?: string | null
          signer_name?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_signatures_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_signatures_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "signature_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          amount: number
          clauses: Json
          client_id: string
          contract_pdf_url: string | null
          source_pdf_url: string | null
          created_at: string
          deleted_at: string | null
          doc_hash: string | null
          end_date: string
          id: string
          is_demo: boolean
          plain_summary: string | null
          scope: string
          signature_image_path: string | null
          signature_meta: Json | null
          start_date: string
          status: Database["public"]["Enums"]["contract_status"]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          clauses?: Json
          client_id: string
          contract_pdf_url?: string | null
          source_pdf_url?: string | null
          created_at?: string
          deleted_at?: string | null
          doc_hash?: string | null
          end_date: string
          id?: string
          is_demo?: boolean
          plain_summary?: string | null
          scope: string
          signature_image_path?: string | null
          signature_meta?: Json | null
          start_date: string
          status?: Database["public"]["Enums"]["contract_status"]
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          clauses?: Json
          client_id?: string
          contract_pdf_url?: string | null
          source_pdf_url?: string | null
          created_at?: string
          deleted_at?: string | null
          doc_hash?: string | null
          end_date?: string
          id?: string
          is_demo?: boolean
          plain_summary?: string | null
          scope?: string
          signature_image_path?: string | null
          signature_meta?: Json | null
          start_date?: string
          status?: Database["public"]["Enums"]["contract_status"]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_events: {
        Row: {
          actor: string
          created_at: string
          event_type: string
          from_status: string | null
          id: string
          invoice_id: string
          meta: Json
          to_status: string
          user_id: string
        }
        Insert: {
          actor: string
          created_at?: string
          event_type: string
          from_status?: string | null
          id?: string
          invoice_id: string
          meta?: Json
          to_status: string
          user_id: string
        }
        Update: {
          actor?: string
          created_at?: string
          event_type?: string
          from_status?: string | null
          id?: string
          invoice_id?: string
          meta?: Json
          to_status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_events_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount: number
          client_id: string
          contract_id: string | null
          contract_snapshot: Json | null
          created_at: string
          deleted_at: string | null
          due_date: string
          id: string
          is_demo: boolean
          issue_date: string
          net_amount: number
          paid_at: string | null
          payment_method: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
          user_id: string
          withholding_amount: number
          withholding_type: Database["public"]["Enums"]["withholding_type"]
        }
        Insert: {
          amount: number
          client_id: string
          contract_id?: string | null
          contract_snapshot?: Json | null
          created_at?: string
          deleted_at?: string | null
          due_date: string
          id?: string
          is_demo?: boolean
          issue_date: string
          net_amount: number
          paid_at?: string | null
          payment_method?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
          user_id: string
          withholding_amount: number
          withholding_type: Database["public"]["Enums"]["withholding_type"]
        }
        Update: {
          amount?: number
          client_id?: string
          contract_id?: string | null
          contract_snapshot?: Json | null
          created_at?: string
          deleted_at?: string | null
          due_date?: string
          id?: string
          is_demo?: boolean
          issue_date?: string
          net_amount?: number
          paid_at?: string | null
          payment_method?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
          user_id?: string
          withholding_amount?: number
          withholding_type?: Database["public"]["Enums"]["withholding_type"]
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          bank_account_holder: string | null
          bank_account_number: string | null
          bank_name: string | null
          created_at: string
          default_withholding_type: Database["public"]["Enums"]["withholding_type"]
          display_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bank_account_holder?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          created_at?: string
          default_withholding_type?: Database["public"]["Enums"]["withholding_type"]
          display_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          bank_account_holder?: string | null
          bank_account_number?: string | null
          bank_name?: string | null
          created_at?: string
          default_withholding_type?: Database["public"]["Enums"]["withholding_type"]
          display_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rate_limit_events: {
        Row: {
          bucket: string
          created_at: string
          id: number
          user_id: string
        }
        Insert: {
          bucket: string
          created_at?: string
          id?: never
          user_id: string
        }
        Update: {
          bucket?: string
          created_at?: string
          id?: never
          user_id?: string
        }
        Relationships: []
      }
      signature_requests: {
        Row: {
          completed_at: string | null
          completion_tsa_token: string | null
          contract_id: string
          created_at: string
          expires_at: string
          first_viewed_at: string | null
          frozen_doc_hash: string
          id: string
          recipient_email: string
          recipient_name: string | null
          sent_tsa_token: string | null
          status: Database["public"]["Enums"]["signature_request_status"]
          token_hash: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          completion_tsa_token?: string | null
          contract_id: string
          created_at?: string
          expires_at: string
          first_viewed_at?: string | null
          frozen_doc_hash: string
          id?: string
          recipient_email: string
          recipient_name?: string | null
          sent_tsa_token?: string | null
          status?: Database["public"]["Enums"]["signature_request_status"]
          token_hash: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          completion_tsa_token?: string | null
          contract_id?: string
          created_at?: string
          expires_at?: string
          first_viewed_at?: string | null
          frozen_doc_hash?: string
          id?: string
          recipient_email?: string
          recipient_name?: string | null
          sent_tsa_token?: string | null
          status?: Database["public"]["Enums"]["signature_request_status"]
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signature_requests_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      complete_counterparty_signature_with_event: {
        Args: {
          p_consent: Json
          p_ip: string
          p_signature_image_data: string
          p_signer_name: string | null
          p_token_hash: string
          p_ua: string
        }
        Returns: Json
      }
      consume_anon_rate_limit: {
        Args: {
          p_bucket: string
          p_ip_hash: string
          p_limit: number
          p_window_seconds: number
        }
        Returns: boolean
      }
      consume_rate_limit: {
        Args: { p_bucket: string; p_max: number; p_window_seconds: number }
        Returns: Json
      }
      get_certificate_data: {
        Args: { p_token_hash: string }
        Returns: Json
      }
      get_signed_contract_data: {
        Args: { p_token_hash: string }
        Returns: Json
      }
      get_signing_session: {
        Args: { p_token_hash: string }
        Returns: Json
      }
      import_signed_contract_with_event: {
        Args: {
          p_actor: string
          p_amount: number
          p_clauses: Json
          p_client_id: string
          p_contract_id: string
          p_doc_hash: string
          p_end_date: string
          p_event_type: string
          p_meta?: Json
          p_plain_summary: string | null
          p_scope: string
          p_source_pdf_url: string
          p_start_date: string
          p_title: string
        }
        Returns: string
      }
      issue_invoice_with_event: {
        Args: {
          p_actor: string
          p_amount: number
          p_client_id: string
          p_contract_id: string
          p_due_date: string
          p_event_type: string
          p_issue_date: string
          p_meta?: Json
          p_net_amount: number
          p_withholding_amount: number
          p_withholding_type: Database["public"]["Enums"]["withholding_type"]
        }
        Returns: string
      }
      revoke_signature_request_with_event: {
        Args: { p_actor: string; p_meta?: Json; p_request_id: string }
        Returns: string
      }
      send_signature_request_with_event: {
        Args: {
          p_actor: string
          p_consent: Json
          p_contract_id: string
          p_doc_hash: string
          p_meta?: Json
          p_recipient_email: string
          p_recipient_name: string | null
          p_signature_image_data?: string | null
          p_signature_image_path: string
          p_signature_meta: Json
          p_signer_email: string
          p_signer_name: string | null
          p_token_hash: string
        }
        Returns: string
      }
      set_invoice_payment_with_event: {
        Args: {
          p_actor: string
          p_event_type: string
          p_invoice_id: string
          p_meta?: Json
          p_paid_at: string | null
          p_payment_method: string | null
          p_to_status: Database["public"]["Enums"]["payment_status"]
        }
        Returns: string
      }
      sign_contract_with_event: {
        Args: {
          p_actor: string
          p_contract_id: string
          p_doc_hash: string
          p_event_type: string
          p_meta?: Json
          p_signature_image_path: string
          p_signature_meta: Json
        }
        Returns: string
      }
      store_completion_tsa_token: {
        Args: { p_token: string; p_token_hash: string }
        Returns: boolean
      }
      transition_contract_status_with_event: {
        Args: {
          p_actor: string
          p_contract_id: string
          p_event_type: string
          p_meta?: Json
          p_reset_signature_artifacts: boolean
          p_to_status: Database["public"]["Enums"]["contract_status"]
        }
        Returns: string
      }
    }
    Enums: {
      contract_signature_party: "owner" | "counterparty"
      contract_status: "draft" | "sent" | "signed" | "active" | "done" | "canceled"
      payment_status: "draft" | "unpaid" | "paid"
      signature_request_status: "pending" | "completed" | "revoked"
      withholding_type: "wt_3_3" | "wt_8_8" | "none"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      contract_signature_party: ["owner", "counterparty"],
      contract_status: ["draft", "sent", "signed", "active", "done", "canceled"],
      payment_status: ["draft", "unpaid", "paid"],
      signature_request_status: ["pending", "completed", "revoked"],
      withholding_type: ["wt_3_3", "wt_8_8", "none"],
    },
  },
} as const
