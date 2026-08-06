export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_insights: {
        Row: {
          created_at: string
          headline: string
          id: string
          kind: Database["public"]["Enums"]["ai_insight_kind"]
          latency_ms: number
          model_id: string
          payload: Json
          prompt_version: string
          requested_by: string | null
          resource_id: string | null
          resource_type: string | null
          severity: Database["public"]["Enums"]["ai_insight_severity"]
          summary: string
          tenant_id: string
          tokens_input: number
          tokens_output: number
        }
        Insert: {
          created_at?: string
          headline: string
          id?: string
          kind: Database["public"]["Enums"]["ai_insight_kind"]
          latency_ms?: number
          model_id?: string
          payload?: Json
          prompt_version?: string
          requested_by?: string | null
          resource_id?: string | null
          resource_type?: string | null
          severity?: Database["public"]["Enums"]["ai_insight_severity"]
          summary: string
          tenant_id: string
          tokens_input?: number
          tokens_output?: number
        }
        Update: {
          created_at?: string
          headline?: string
          id?: string
          kind?: Database["public"]["Enums"]["ai_insight_kind"]
          latency_ms?: number
          model_id?: string
          payload?: Json
          prompt_version?: string
          requested_by?: string | null
          resource_id?: string | null
          resource_type?: string | null
          severity?: Database["public"]["Enums"]["ai_insight_severity"]
          summary?: string
          tenant_id?: string
          tokens_input?: number
          tokens_output?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_insights_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_insights_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_insights_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_thresholds: {
        Row: {
          created_at: string
          created_by: string | null
          director_threshold: number | null
          id: string
          kind: Database["public"]["Enums"]["approval_kind"]
          notes: string | null
          om_threshold: number | null
          petty_auto_approve_below: number | null
          petty_hard_ceiling: number | null
          petty_receipt_required_above: number | null
          pm_threshold: number | null
          settlement_sla_days: number | null
          supervisor_threshold: number | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          director_threshold?: number | null
          id?: string
          kind: Database["public"]["Enums"]["approval_kind"]
          notes?: string | null
          om_threshold?: number | null
          petty_auto_approve_below?: number | null
          petty_hard_ceiling?: number | null
          petty_receipt_required_above?: number | null
          pm_threshold?: number | null
          settlement_sla_days?: number | null
          supervisor_threshold?: number | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          director_threshold?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["approval_kind"]
          notes?: string | null
          om_threshold?: number | null
          petty_auto_approve_below?: number | null
          petty_hard_ceiling?: number | null
          petty_receipt_required_above?: number | null
          pm_threshold?: number | null
          settlement_sla_days?: number | null
          supervisor_threshold?: number | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_thresholds_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_thresholds_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_thresholds_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_thresholds_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_thresholds_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          created_at: string
          filename: string
          id: string
          mime_type: string
          resource_id: string
          resource_type: string
          size_bytes: number
          storage_path: string
          tenant_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          filename: string
          id?: string
          mime_type: string
          resource_id: string
          resource_type: string
          size_bytes: number
          storage_path: string
          tenant_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          filename?: string
          id?: string
          mime_type?: string
          resource_id?: string
          resource_type?: string
          size_bytes?: number
          storage_path?: string
          tenant_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
        ]
      }
      bpo_contracts: {
        Row: {
          client_id: string
          contract_number: string
          created_at: string
          created_by: string | null
          currency: string
          end_date: string | null
          id: string
          mrr_amount: number
          notes: string | null
          start_date: string
          status: Database["public"]["Enums"]["contract_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          client_id: string
          contract_number: string
          created_at?: string
          created_by?: string | null
          currency?: string
          end_date?: string | null
          id?: string
          mrr_amount?: number
          notes?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["contract_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          contract_number?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          end_date?: string | null
          id?: string
          mrr_amount?: number
          notes?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["contract_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bpo_contracts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bpo_contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bpo_contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bpo_contracts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_details: {
        Row: {
          budget_id: string
          category: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          outstanding_amount: number
          planned_amount: number
          realized_amount: number
          remaining_amount: number | null
          seq: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          budget_id: string
          category: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          outstanding_amount?: number
          planned_amount?: number
          realized_amount?: number
          remaining_amount?: number | null
          seq: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          budget_id?: string
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          outstanding_amount?: number
          planned_amount?: number
          realized_amount?: number
          remaining_amount?: number | null
          seq?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_details_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_details_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_details_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_details_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_details_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_details_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_request_approval_logs: {
        Row: {
          action: Database["public"]["Enums"]["approval_action"]
          actor_employee_id: string | null
          actor_role: Database["public"]["Enums"]["employee_role"] | null
          budget_request_id: string
          comment: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["budget_request_status"]
          id: number
          tenant_id: string
          to_status: Database["public"]["Enums"]["budget_request_status"]
        }
        Insert: {
          action: Database["public"]["Enums"]["approval_action"]
          actor_employee_id?: string | null
          actor_role?: Database["public"]["Enums"]["employee_role"] | null
          budget_request_id: string
          comment?: string | null
          created_at?: string
          from_status: Database["public"]["Enums"]["budget_request_status"]
          id?: never
          tenant_id: string
          to_status: Database["public"]["Enums"]["budget_request_status"]
        }
        Update: {
          action?: Database["public"]["Enums"]["approval_action"]
          actor_employee_id?: string | null
          actor_role?: Database["public"]["Enums"]["employee_role"] | null
          budget_request_id?: string
          comment?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["budget_request_status"]
          id?: never
          tenant_id?: string
          to_status?: Database["public"]["Enums"]["budget_request_status"]
        }
        Relationships: [
          {
            foreignKeyName: "budget_request_approval_logs_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_request_approval_logs_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_request_approval_logs_budget_request_id_fkey"
            columns: ["budget_request_id"]
            isOneToOne: false
            referencedRelation: "budget_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_request_approval_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_request_lines: {
        Row: {
          budget_detail_id: string
          budget_request_id: string
          created_at: string
          delta_amount: number
          direction: Database["public"]["Enums"]["budget_request_line_direction"]
          id: string
          tenant_id: string
        }
        Insert: {
          budget_detail_id: string
          budget_request_id: string
          created_at?: string
          delta_amount: number
          direction: Database["public"]["Enums"]["budget_request_line_direction"]
          id?: string
          tenant_id: string
        }
        Update: {
          budget_detail_id?: string
          budget_request_id?: string
          created_at?: string
          delta_amount?: number
          direction?: Database["public"]["Enums"]["budget_request_line_direction"]
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_request_lines_budget_detail_id_fkey"
            columns: ["budget_detail_id"]
            isOneToOne: false
            referencedRelation: "budget_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_request_lines_budget_request_id_fkey"
            columns: ["budget_request_id"]
            isOneToOne: false
            referencedRelation: "budget_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_request_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_requests: {
        Row: {
          amount: number
          applied_at: string | null
          applied_by: string | null
          approved_at: string | null
          budget_id: string
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          currency: string
          director_approved_at: string | null
          director_approver_id: string | null
          finance_approved_at: string | null
          finance_approver_id: string | null
          id: string
          justification: string
          kind: Database["public"]["Enums"]["budget_request_kind"]
          pm_approved_at: string | null
          pm_approver_id: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          requester_employee_id: string
          status: Database["public"]["Enums"]["budget_request_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          applied_at?: string | null
          applied_by?: string | null
          approved_at?: string | null
          budget_id: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          currency?: string
          director_approved_at?: string | null
          director_approver_id?: string | null
          finance_approved_at?: string | null
          finance_approver_id?: string | null
          id?: string
          justification: string
          kind: Database["public"]["Enums"]["budget_request_kind"]
          pm_approved_at?: string | null
          pm_approver_id?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          requester_employee_id: string
          status?: Database["public"]["Enums"]["budget_request_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          applied_at?: string | null
          applied_by?: string | null
          approved_at?: string | null
          budget_id?: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          currency?: string
          director_approved_at?: string | null
          director_approver_id?: string | null
          finance_approved_at?: string | null
          finance_approver_id?: string | null
          id?: string
          justification?: string
          kind?: Database["public"]["Enums"]["budget_request_kind"]
          pm_approved_at?: string | null
          pm_approver_id?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          requester_employee_id?: string
          status?: Database["public"]["Enums"]["budget_request_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_requests_applied_by_fkey"
            columns: ["applied_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_requests_applied_by_fkey"
            columns: ["applied_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_requests_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_requests_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_requests_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_requests_director_approver_id_fkey"
            columns: ["director_approver_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_requests_director_approver_id_fkey"
            columns: ["director_approver_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_requests_finance_approver_id_fkey"
            columns: ["finance_approver_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_requests_finance_approver_id_fkey"
            columns: ["finance_approver_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_requests_pm_approver_id_fkey"
            columns: ["pm_approver_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_requests_pm_approver_id_fkey"
            columns: ["pm_approver_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_requests_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_requests_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_requests_requester_employee_id_fkey"
            columns: ["requester_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_requests_requester_employee_id_fkey"
            columns: ["requester_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          currency: string
          fiscal_year: number
          id: string
          notes: string | null
          project_id: string
          status: Database["public"]["Enums"]["budget_status"]
          tenant_id: string
          title: string
          total_planned_amount: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          fiscal_year: number
          id?: string
          notes?: string | null
          project_id: string
          status?: Database["public"]["Enums"]["budget_status"]
          tenant_id: string
          title: string
          total_planned_amount?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          fiscal_year?: number
          id?: string
          notes?: string | null
          project_id?: string
          status?: Database["public"]["Enums"]["budget_status"]
          tenant_id?: string
          title?: string
          total_planned_amount?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budgets_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_advance_approval_logs: {
        Row: {
          action: Database["public"]["Enums"]["approval_action"]
          actor_employee_id: string | null
          actor_role: Database["public"]["Enums"]["employee_role"] | null
          cash_advance_id: string
          comment: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["cash_advance_status"]
          id: number
          tenant_id: string
          to_status: Database["public"]["Enums"]["cash_advance_status"]
        }
        Insert: {
          action: Database["public"]["Enums"]["approval_action"]
          actor_employee_id?: string | null
          actor_role?: Database["public"]["Enums"]["employee_role"] | null
          cash_advance_id: string
          comment?: string | null
          created_at?: string
          from_status: Database["public"]["Enums"]["cash_advance_status"]
          id?: never
          tenant_id: string
          to_status: Database["public"]["Enums"]["cash_advance_status"]
        }
        Update: {
          action?: Database["public"]["Enums"]["approval_action"]
          actor_employee_id?: string | null
          actor_role?: Database["public"]["Enums"]["employee_role"] | null
          cash_advance_id?: string
          comment?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["cash_advance_status"]
          id?: never
          tenant_id?: string
          to_status?: Database["public"]["Enums"]["cash_advance_status"]
        }
        Relationships: [
          {
            foreignKeyName: "cash_advance_approval_logs_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advance_approval_logs_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advance_approval_logs_cash_advance_id_fkey"
            columns: ["cash_advance_id"]
            isOneToOne: false
            referencedRelation: "cash_advances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advance_approval_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_advance_settlements: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          cash_advance_id: string
          created_at: string
          id: string
          notes: string | null
          return_reason: string | null
          returned_at: string | null
          returned_by: string | null
          status: Database["public"]["Enums"]["cash_advance_settlement_status"]
          submitted_at: string | null
          submitted_by: string | null
          tenant_id: string
          total_spent: number
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          cash_advance_id: string
          created_at?: string
          id?: string
          notes?: string | null
          return_reason?: string | null
          returned_at?: string | null
          returned_by?: string | null
          status?: Database["public"]["Enums"]["cash_advance_settlement_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          tenant_id: string
          total_spent?: number
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          cash_advance_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          return_reason?: string | null
          returned_at?: string | null
          returned_by?: string | null
          status?: Database["public"]["Enums"]["cash_advance_settlement_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          tenant_id?: string
          total_spent?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_advance_settlements_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advance_settlements_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advance_settlements_cash_advance_id_fkey"
            columns: ["cash_advance_id"]
            isOneToOne: false
            referencedRelation: "cash_advances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advance_settlements_returned_by_fkey"
            columns: ["returned_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advance_settlements_returned_by_fkey"
            columns: ["returned_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advance_settlements_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advance_settlements_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advance_settlements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_advances: {
        Row: {
          amount: number
          ca_type: Database["public"]["Enums"]["cash_advance_type"]
          created_at: string
          currency: string
          director_approved_at: string | null
          director_approver_id: string | null
          disbursed_at: string | null
          disbursed_by: string | null
          disbursement_ref: string | null
          final_approved_at: string | null
          final_approver_id: string | null
          finance_approved_at: string | null
          finance_approver_id: string | null
          id: string
          needed_by: string | null
          net_settlement_amount: number | null
          om_approved_at: string | null
          om_approver_id: string | null
          pm_approved_at: string | null
          pm_approver_id: string | null
          project_id: string
          purpose: string
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          requester_employee_id: string
          settled_at: string | null
          status: Database["public"]["Enums"]["cash_advance_status"]
          supervisor_approved_at: string | null
          supervisor_approver_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          ca_type?: Database["public"]["Enums"]["cash_advance_type"]
          created_at?: string
          currency?: string
          director_approved_at?: string | null
          director_approver_id?: string | null
          disbursed_at?: string | null
          disbursed_by?: string | null
          disbursement_ref?: string | null
          final_approved_at?: string | null
          final_approver_id?: string | null
          finance_approved_at?: string | null
          finance_approver_id?: string | null
          id?: string
          needed_by?: string | null
          net_settlement_amount?: number | null
          om_approved_at?: string | null
          om_approver_id?: string | null
          pm_approved_at?: string | null
          pm_approver_id?: string | null
          project_id: string
          purpose: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          requester_employee_id: string
          settled_at?: string | null
          status?: Database["public"]["Enums"]["cash_advance_status"]
          supervisor_approved_at?: string | null
          supervisor_approver_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          ca_type?: Database["public"]["Enums"]["cash_advance_type"]
          created_at?: string
          currency?: string
          director_approved_at?: string | null
          director_approver_id?: string | null
          disbursed_at?: string | null
          disbursed_by?: string | null
          disbursement_ref?: string | null
          final_approved_at?: string | null
          final_approver_id?: string | null
          finance_approved_at?: string | null
          finance_approver_id?: string | null
          id?: string
          needed_by?: string | null
          net_settlement_amount?: number | null
          om_approved_at?: string | null
          om_approver_id?: string | null
          pm_approved_at?: string | null
          pm_approver_id?: string | null
          project_id?: string
          purpose?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          requester_employee_id?: string
          settled_at?: string | null
          status?: Database["public"]["Enums"]["cash_advance_status"]
          supervisor_approved_at?: string | null
          supervisor_approver_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_advances_director_approver_id_fkey"
            columns: ["director_approver_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advances_director_approver_id_fkey"
            columns: ["director_approver_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advances_disbursed_by_fkey"
            columns: ["disbursed_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advances_disbursed_by_fkey"
            columns: ["disbursed_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advances_final_approver_id_fkey"
            columns: ["final_approver_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advances_final_approver_id_fkey"
            columns: ["final_approver_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advances_finance_approver_id_fkey"
            columns: ["finance_approver_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advances_finance_approver_id_fkey"
            columns: ["finance_approver_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advances_om_approver_id_fkey"
            columns: ["om_approver_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advances_om_approver_id_fkey"
            columns: ["om_approver_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advances_pm_approver_id_fkey"
            columns: ["pm_approver_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advances_pm_approver_id_fkey"
            columns: ["pm_approver_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advances_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advances_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advances_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advances_requester_employee_id_fkey"
            columns: ["requester_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advances_requester_employee_id_fkey"
            columns: ["requester_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advances_supervisor_approver_id_fkey"
            columns: ["supervisor_approver_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advances_supervisor_approver_id_fkey"
            columns: ["supervisor_approver_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_user_sessions: {
        Row: {
          client_user_id: string
          expires_at: string
          id: string
          ip_address: unknown
          issued_at: string
          revoked_at: string | null
          tenant_id: string
          token_hash: string
          user_agent: string | null
        }
        Insert: {
          client_user_id: string
          expires_at: string
          id?: string
          ip_address?: unknown
          issued_at?: string
          revoked_at?: string | null
          tenant_id: string
          token_hash: string
          user_agent?: string | null
        }
        Update: {
          client_user_id?: string
          expires_at?: string
          id?: string
          ip_address?: unknown
          issued_at?: string
          revoked_at?: string | null
          tenant_id?: string
          token_hash?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_user_sessions_client_user_id_fkey"
            columns: ["client_user_id"]
            isOneToOne: false
            referencedRelation: "client_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_user_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_users: {
        Row: {
          activation_expires_at: string | null
          activation_token_hash: string | null
          client_id: string
          created_at: string
          created_by: string | null
          email: string
          failed_login_count: number
          full_name: string
          id: string
          last_login_at: string | null
          locked_until: string | null
          password_hash: string
          status: Database["public"]["Enums"]["client_user_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          activation_expires_at?: string | null
          activation_token_hash?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          email: string
          failed_login_count?: number
          full_name: string
          id?: string
          last_login_at?: string | null
          locked_until?: string | null
          password_hash: string
          status?: Database["public"]["Enums"]["client_user_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          activation_expires_at?: string | null
          activation_token_hash?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          email?: string
          failed_login_count?: number
          full_name?: string
          id?: string
          last_login_at?: string | null
          locked_until?: string | null
          password_hash?: string
          status?: Database["public"]["Enums"]["client_user_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_users_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_users_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_users_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          id: string
          industry: string | null
          name: string
          notes: string | null
          onboarded_at: string | null
          status: Database["public"]["Enums"]["client_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          industry?: string | null
          name: string
          notes?: string | null
          onboarded_at?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          industry?: string | null
          name?: string
          notes?: string | null
          onboarded_at?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_run_log: {
        Row: {
          details: Json | null
          dry_run: boolean
          error_message: string | null
          finished_at: string | null
          id: string
          job_name: string
          rows_processed: number
          started_at: string
          status: string
        }
        Insert: {
          details?: Json | null
          dry_run?: boolean
          error_message?: string | null
          finished_at?: string | null
          id?: string
          job_name: string
          rows_processed?: number
          started_at?: string
          status?: string
        }
        Update: {
          details?: Json | null
          dry_run?: boolean
          error_message?: string | null
          finished_at?: string | null
          id?: string
          job_name?: string
          rows_processed?: number
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      data_archives: {
        Row: {
          batch_end: string
          batch_start: string
          bytes_written: number
          checksum_sha256: string
          created_at: string
          error_message: string | null
          id: string
          purged_at: string | null
          purged_row_count: number | null
          restore_verified_at: string | null
          row_count: number
          source_table: Database["public"]["Enums"]["data_archive_source"]
          status: Database["public"]["Enums"]["data_archive_status"]
          storage_path: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          batch_end: string
          batch_start: string
          bytes_written: number
          checksum_sha256: string
          created_at?: string
          error_message?: string | null
          id?: string
          purged_at?: string | null
          purged_row_count?: number | null
          restore_verified_at?: string | null
          row_count: number
          source_table: Database["public"]["Enums"]["data_archive_source"]
          status?: Database["public"]["Enums"]["data_archive_status"]
          storage_path: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          batch_end?: string
          batch_start?: string
          bytes_written?: number
          checksum_sha256?: string
          created_at?: string
          error_message?: string | null
          id?: string
          purged_at?: string | null
          purged_row_count?: number | null
          restore_verified_at?: string | null
          row_count?: number
          source_table?: Database["public"]["Enums"]["data_archive_source"]
          status?: Database["public"]["Enums"]["data_archive_status"]
          storage_path?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_archives_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      email_outbox: {
        Row: {
          body_html: string | null
          body_text: string | null
          created_at: string
          error_message: string | null
          from_address: string
          id: string
          metadata: Json | null
          provider: string | null
          provider_message_id: string | null
          sent_at: string | null
          status: string
          subject: string
          tenant_id: string | null
          to_address: string
        }
        Insert: {
          body_html?: string | null
          body_text?: string | null
          created_at?: string
          error_message?: string | null
          from_address: string
          id?: string
          metadata?: Json | null
          provider?: string | null
          provider_message_id?: string | null
          sent_at?: string | null
          status?: string
          subject: string
          tenant_id?: string | null
          to_address: string
        }
        Update: {
          body_html?: string | null
          body_text?: string | null
          created_at?: string
          error_message?: string | null
          from_address?: string
          id?: string
          metadata?: Json | null
          provider?: string | null
          provider_message_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          tenant_id?: string | null
          to_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_outbox_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_rosters: {
        Row: {
          created_at: string
          created_by: string | null
          employee_id: string
          id: string
          notes: string | null
          project_id: string | null
          shift_id: string
          status: string
          tenant_id: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          employee_id: string
          id?: string
          notes?: string | null
          project_id?: string | null
          shift_id: string
          status?: string
          tenant_id: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          employee_id?: string
          id?: string
          notes?: string | null
          project_id?: string | null
          shift_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_rosters_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_rosters_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_rosters_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_rosters_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_rosters_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_rosters_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "work_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_rosters_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          bank_account_number: string | null
          created_at: string
          email: string
          full_name: string
          hourly_rate: number
          id: string
          is_active: boolean
          monthly_salary: number
          pii_anonymized_at: string | null
          preferred_locale: string | null
          reports_to_employee_id: string | null
          role: Database["public"]["Enums"]["employee_role"]
          tenant_id: string
          terminated_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bank_account_number?: string | null
          created_at?: string
          email: string
          full_name: string
          hourly_rate?: number
          id?: string
          is_active?: boolean
          monthly_salary?: number
          pii_anonymized_at?: string | null
          preferred_locale?: string | null
          reports_to_employee_id?: string | null
          role?: Database["public"]["Enums"]["employee_role"]
          tenant_id: string
          terminated_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          bank_account_number?: string | null
          created_at?: string
          email?: string
          full_name?: string
          hourly_rate?: number
          id?: string
          is_active?: boolean
          monthly_salary?: number
          pii_anonymized_at?: string | null
          preferred_locale?: string | null
          reports_to_employee_id?: string | null
          role?: Database["public"]["Enums"]["employee_role"]
          tenant_id?: string
          terminated_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employees_reports_to_employee_id_fkey"
            columns: ["reports_to_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_reports_to_employee_id_fkey"
            columns: ["reports_to_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_approval_logs: {
        Row: {
          action: Database["public"]["Enums"]["approval_action"]
          actor_employee_id: string | null
          actor_role: Database["public"]["Enums"]["employee_role"] | null
          comment: string | null
          created_at: string
          expense_id: string
          from_status: Database["public"]["Enums"]["expense_status"]
          id: number
          tenant_id: string
          to_status: Database["public"]["Enums"]["expense_status"]
        }
        Insert: {
          action: Database["public"]["Enums"]["approval_action"]
          actor_employee_id?: string | null
          actor_role?: Database["public"]["Enums"]["employee_role"] | null
          comment?: string | null
          created_at?: string
          expense_id: string
          from_status: Database["public"]["Enums"]["expense_status"]
          id?: never
          tenant_id: string
          to_status: Database["public"]["Enums"]["expense_status"]
        }
        Update: {
          action?: Database["public"]["Enums"]["approval_action"]
          actor_employee_id?: string | null
          actor_role?: Database["public"]["Enums"]["employee_role"] | null
          comment?: string | null
          created_at?: string
          expense_id?: string
          from_status?: Database["public"]["Enums"]["expense_status"]
          id?: never
          tenant_id?: string
          to_status?: Database["public"]["Enums"]["expense_status"]
        }
        Relationships: [
          {
            foreignKeyName: "expense_approval_logs_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_approval_logs_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_approval_logs_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "project_expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_approval_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_approval_logs: {
        Row: {
          action: Database["public"]["Enums"]["approval_action"]
          actor_employee_id: string | null
          actor_role: Database["public"]["Enums"]["employee_role"] | null
          comment: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["hr_request_status"]
          id: number
          request_id: string
          tenant_id: string
          to_status: Database["public"]["Enums"]["hr_request_status"]
        }
        Insert: {
          action: Database["public"]["Enums"]["approval_action"]
          actor_employee_id?: string | null
          actor_role?: Database["public"]["Enums"]["employee_role"] | null
          comment?: string | null
          created_at?: string
          from_status: Database["public"]["Enums"]["hr_request_status"]
          id?: never
          request_id: string
          tenant_id: string
          to_status: Database["public"]["Enums"]["hr_request_status"]
        }
        Update: {
          action?: Database["public"]["Enums"]["approval_action"]
          actor_employee_id?: string | null
          actor_role?: Database["public"]["Enums"]["employee_role"] | null
          comment?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["hr_request_status"]
          id?: never
          request_id?: string
          tenant_id?: string
          to_status?: Database["public"]["Enums"]["hr_request_status"]
        }
        Relationships: [
          {
            foreignKeyName: "hr_approval_logs_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_approval_logs_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_approval_logs_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "hr_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_approval_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_requests: {
        Row: {
          attachment_url: string | null
          created_at: string
          end_at: string
          final_approved_at: string | null
          final_approver_id: string | null
          hours_estimate: number | null
          id: string
          kind: Database["public"]["Enums"]["hr_request_kind"]
          leave_type: Database["public"]["Enums"]["hr_leave_type"] | null
          project_id: string | null
          reason: string
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          requester_employee_id: string
          start_at: string
          status: Database["public"]["Enums"]["hr_request_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attachment_url?: string | null
          created_at?: string
          end_at: string
          final_approved_at?: string | null
          final_approver_id?: string | null
          hours_estimate?: number | null
          id?: string
          kind: Database["public"]["Enums"]["hr_request_kind"]
          leave_type?: Database["public"]["Enums"]["hr_leave_type"] | null
          project_id?: string | null
          reason: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          requester_employee_id: string
          start_at: string
          status?: Database["public"]["Enums"]["hr_request_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attachment_url?: string | null
          created_at?: string
          end_at?: string
          final_approved_at?: string | null
          final_approver_id?: string | null
          hours_estimate?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["hr_request_kind"]
          leave_type?: Database["public"]["Enums"]["hr_leave_type"] | null
          project_id?: string | null
          reason?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          requester_employee_id?: string
          start_at?: string
          status?: Database["public"]["Enums"]["hr_request_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_requests_final_approver_id_fkey"
            columns: ["final_approver_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_requests_final_approver_id_fkey"
            columns: ["final_approver_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_requests_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_requests_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_requests_requester_employee_id_fkey"
            columns: ["requester_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_requests_requester_employee_id_fkey"
            columns: ["requester_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          action_url: string | null
          body: string | null
          created_at: string
          employee_id: string | null
          id: string
          kind: Database["public"]["Enums"]["notification_kind"]
          payload: Json | null
          read_at: string | null
          tenant_id: string
          title: string
          user_id: string
        }
        Insert: {
          action_url?: string | null
          body?: string | null
          created_at?: string
          employee_id?: string | null
          id?: string
          kind: Database["public"]["Enums"]["notification_kind"]
          payload?: Json | null
          read_at?: string | null
          tenant_id: string
          title: string
          user_id: string
        }
        Update: {
          action_url?: string | null
          body?: string | null
          created_at?: string
          employee_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          payload?: Json | null
          read_at?: string | null
          tenant_id?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_lines: {
        Row: {
          base_salary: number
          created_at: string
          deductions: number
          employee_id: string
          gross_pay: number
          hours_overtime: number
          hours_worked: number
          id: string
          net_pay: number
          overtime_pay: number
          period_id: string
          shift_allowance: number
          tenant_id: string
        }
        Insert: {
          base_salary?: number
          created_at?: string
          deductions?: number
          employee_id: string
          gross_pay?: number
          hours_overtime?: number
          hours_worked?: number
          id?: string
          net_pay?: number
          overtime_pay?: number
          period_id: string
          shift_allowance?: number
          tenant_id: string
        }
        Update: {
          base_salary?: number
          created_at?: string
          deductions?: number
          employee_id?: string
          gross_pay?: number
          hours_overtime?: number
          hours_worked?: number
          id?: string
          net_pay?: number
          overtime_pay?: number
          period_id?: string
          shift_allowance?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_lines_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_lines_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_lines_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_periods: {
        Row: {
          created_at: string
          finalized_at: string | null
          finalized_by: string | null
          generated_by: string | null
          id: string
          notes: string | null
          period_month: number
          period_year: number
          status: Database["public"]["Enums"]["payroll_period_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          finalized_at?: string | null
          finalized_by?: string | null
          generated_by?: string | null
          id?: string
          notes?: string | null
          period_month: number
          period_year: number
          status?: Database["public"]["Enums"]["payroll_period_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          finalized_at?: string | null
          finalized_by?: string | null
          generated_by?: string | null
          id?: string
          notes?: string | null
          period_month?: number
          period_year?: number
          status?: Database["public"]["Enums"]["payroll_period_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_periods_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_periods_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_periods_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_periods_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_periods_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      petty_cash_funds: {
        Row: {
          balance: number
          created_at: string
          custodian_employee_id: string
          id: string
          imprest_amount: number
          is_active: boolean
          location_name: string
          min_balance: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          balance?: number
          created_at?: string
          custodian_employee_id: string
          id?: string
          imprest_amount: number
          is_active?: boolean
          location_name: string
          min_balance?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          balance?: number
          created_at?: string
          custodian_employee_id?: string
          id?: string
          imprest_amount?: number
          is_active?: boolean
          location_name?: string
          min_balance?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_funds_custodian_employee_id_fkey"
            columns: ["custodian_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_funds_custodian_employee_id_fkey"
            columns: ["custodian_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_funds_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      petty_cash_replenishments: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          disbursed_at: string | null
          disbursed_by: string | null
          disbursement_ref: string | null
          fund_id: string
          id: string
          reason: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          requested_amount: number
          requested_by: string
          status: Database["public"]["Enums"]["petty_cash_replenishment_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          disbursed_at?: string | null
          disbursed_by?: string | null
          disbursement_ref?: string | null
          fund_id: string
          id?: string
          reason?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          requested_amount: number
          requested_by: string
          status?: Database["public"]["Enums"]["petty_cash_replenishment_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          disbursed_at?: string | null
          disbursed_by?: string | null
          disbursement_ref?: string | null
          fund_id?: string
          id?: string
          reason?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          requested_amount?: number
          requested_by?: string
          status?: Database["public"]["Enums"]["petty_cash_replenishment_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_replenishments_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_replenishments_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_replenishments_disbursed_by_fkey"
            columns: ["disbursed_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_replenishments_disbursed_by_fkey"
            columns: ["disbursed_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_replenishments_fund_id_fkey"
            columns: ["fund_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_funds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_replenishments_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_replenishments_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_replenishments_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_replenishments_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_replenishments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      petty_cash_vouchers: {
        Row: {
          amount: number
          category: string
          created_at: string
          created_by: string
          description: string
          fund_id: string
          id: string
          incurred_on: string
          receipt_url: string | null
          status: Database["public"]["Enums"]["petty_cash_voucher_status"]
          tenant_id: string
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          created_by: string
          description: string
          fund_id: string
          id?: string
          incurred_on: string
          receipt_url?: string | null
          status?: Database["public"]["Enums"]["petty_cash_voucher_status"]
          tenant_id: string
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          created_by?: string
          description?: string
          fund_id?: string
          id?: string
          incurred_on?: string
          receipt_url?: string | null
          status?: Database["public"]["Enums"]["petty_cash_voucher_status"]
          tenant_id?: string
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_vouchers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_vouchers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_vouchers_fund_id_fkey"
            columns: ["fund_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_funds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_vouchers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_vouchers_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_vouchers_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
        ]
      }
      pm_handover_audit_logs: {
        Row: {
          action: Database["public"]["Enums"]["approval_action"]
          actor_employee_id: string | null
          actor_role: Database["public"]["Enums"]["employee_role"] | null
          comment: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["pm_handover_status"]
          handover_id: string
          id: number
          tenant_id: string
          to_status: Database["public"]["Enums"]["pm_handover_status"]
        }
        Insert: {
          action: Database["public"]["Enums"]["approval_action"]
          actor_employee_id?: string | null
          actor_role?: Database["public"]["Enums"]["employee_role"] | null
          comment?: string | null
          created_at?: string
          from_status: Database["public"]["Enums"]["pm_handover_status"]
          handover_id: string
          id?: number
          tenant_id: string
          to_status: Database["public"]["Enums"]["pm_handover_status"]
        }
        Update: {
          action?: Database["public"]["Enums"]["approval_action"]
          actor_employee_id?: string | null
          actor_role?: Database["public"]["Enums"]["employee_role"] | null
          comment?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["pm_handover_status"]
          handover_id?: string
          id?: number
          tenant_id?: string
          to_status?: Database["public"]["Enums"]["pm_handover_status"]
        }
        Relationships: [
          {
            foreignKeyName: "pm_handover_audit_logs_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_handover_audit_logs_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_handover_audit_logs_handover_id_fkey"
            columns: ["handover_id"]
            isOneToOne: false
            referencedRelation: "pm_handovers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_handover_audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pm_handovers: {
        Row: {
          created_at: string
          effective_at: string
          executed_at: string | null
          executed_by: string | null
          from_pm_employee_id: string
          handover_notes: string | null
          hm_approved_at: string | null
          hm_approver_id: string | null
          id: string
          initiated_by: string
          om_approved_at: string | null
          om_approver_id: string | null
          project_id: string
          reason: string
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          status: Database["public"]["Enums"]["pm_handover_status"]
          tenant_id: string
          to_pm_employee_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          effective_at: string
          executed_at?: string | null
          executed_by?: string | null
          from_pm_employee_id: string
          handover_notes?: string | null
          hm_approved_at?: string | null
          hm_approver_id?: string | null
          id?: string
          initiated_by: string
          om_approved_at?: string | null
          om_approver_id?: string | null
          project_id: string
          reason: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["pm_handover_status"]
          tenant_id: string
          to_pm_employee_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          effective_at?: string
          executed_at?: string | null
          executed_by?: string | null
          from_pm_employee_id?: string
          handover_notes?: string | null
          hm_approved_at?: string | null
          hm_approver_id?: string | null
          id?: string
          initiated_by?: string
          om_approved_at?: string | null
          om_approver_id?: string | null
          project_id?: string
          reason?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["pm_handover_status"]
          tenant_id?: string
          to_pm_employee_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pm_handovers_executed_by_fkey"
            columns: ["executed_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_handovers_executed_by_fkey"
            columns: ["executed_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_handovers_from_pm_employee_id_fkey"
            columns: ["from_pm_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_handovers_from_pm_employee_id_fkey"
            columns: ["from_pm_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_handovers_hm_approver_id_fkey"
            columns: ["hm_approver_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_handovers_hm_approver_id_fkey"
            columns: ["hm_approver_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_handovers_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_handovers_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_handovers_om_approver_id_fkey"
            columns: ["om_approver_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_handovers_om_approver_id_fkey"
            columns: ["om_approver_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_handovers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_handovers_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_handovers_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_handovers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_handovers_to_pm_employee_id_fkey"
            columns: ["to_pm_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_handovers_to_pm_employee_id_fkey"
            columns: ["to_pm_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_login_events: {
        Row: {
          client_user_id: string | null
          created_at: string
          email_attempted: string | null
          event: string
          id: number
          ip_address: unknown
          tenant_id: string
          user_agent: string | null
        }
        Insert: {
          client_user_id?: string | null
          created_at?: string
          email_attempted?: string | null
          event: string
          id?: never
          ip_address?: unknown
          tenant_id: string
          user_agent?: string | null
        }
        Update: {
          client_user_id?: string | null
          created_at?: string
          email_attempted?: string | null
          event?: string
          id?: never
          ip_address?: unknown
          tenant_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_login_events_client_user_id_fkey"
            columns: ["client_user_id"]
            isOneToOne: false
            referencedRelation: "client_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_login_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_notifications: {
        Row: {
          action_url: string | null
          body: string | null
          client_id: string
          client_user_id: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["portal_notification_kind"]
          payload: Json | null
          read_at: string | null
          tenant_id: string
          title: string
        }
        Insert: {
          action_url?: string | null
          body?: string | null
          client_id: string
          client_user_id: string
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["portal_notification_kind"]
          payload?: Json | null
          read_at?: string | null
          tenant_id: string
          title: string
        }
        Update: {
          action_url?: string | null
          body?: string | null
          client_id?: string
          client_user_id?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["portal_notification_kind"]
          payload?: Json | null
          read_at?: string | null
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_notifications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_notifications_client_user_id_fkey"
            columns: ["client_user_id"]
            isOneToOne: false
            referencedRelation: "client_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      project_assignments: {
        Row: {
          allocation_percentage: number
          created_at: string
          created_by: string | null
          employee_id: string
          ended_at: string | null
          id: string
          is_primary: boolean
          notes: string | null
          project_id: string
          role: Database["public"]["Enums"]["project_assignment_role"]
          started_at: string
          status: Database["public"]["Enums"]["assignment_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          allocation_percentage?: number
          created_at?: string
          created_by?: string | null
          employee_id: string
          ended_at?: string | null
          id?: string
          is_primary?: boolean
          notes?: string | null
          project_id: string
          role: Database["public"]["Enums"]["project_assignment_role"]
          started_at?: string
          status?: Database["public"]["Enums"]["assignment_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          allocation_percentage?: number
          created_at?: string
          created_by?: string | null
          employee_id?: string
          ended_at?: string | null
          id?: string
          is_primary?: boolean
          notes?: string | null
          project_id?: string
          role?: Database["public"]["Enums"]["project_assignment_role"]
          started_at?: string
          status?: Database["public"]["Enums"]["assignment_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      project_budgets: {
        Row: {
          budget_amount: number
          currency: string
          id: string
          project_id: string
          spent_amount: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          budget_amount?: number
          currency?: string
          id?: string
          project_id: string
          spent_amount?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          budget_amount?: number
          currency?: string
          id?: string
          project_id?: string
          spent_amount?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_budgets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_budgets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      project_employee_assignments: {
        Row: {
          allocation_percentage: number
          created_at: string
          created_by: string | null
          employee_id: string
          ended_at: string | null
          id: string
          project_id: string
          started_at: string
          status: Database["public"]["Enums"]["assignment_status"]
          tenant_id: string
        }
        Insert: {
          allocation_percentage: number
          created_at?: string
          created_by?: string | null
          employee_id: string
          ended_at?: string | null
          id?: string
          project_id: string
          started_at?: string
          status?: Database["public"]["Enums"]["assignment_status"]
          tenant_id: string
        }
        Update: {
          allocation_percentage?: number
          created_at?: string
          created_by?: string | null
          employee_id?: string
          ended_at?: string | null
          id?: string
          project_id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["assignment_status"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_employee_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_employee_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_employee_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_employee_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_employee_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_employee_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      project_expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          currency: string
          description: string
          final_approved_at: string | null
          final_approver_id: string | null
          finance_approved_at: string | null
          finance_approver_id: string | null
          id: string
          incurred_on: string
          project_id: string
          receipt_url: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          status: Database["public"]["Enums"]["expense_status"]
          submitter_employee_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          currency?: string
          description: string
          final_approved_at?: string | null
          final_approver_id?: string | null
          finance_approved_at?: string | null
          finance_approver_id?: string | null
          id?: string
          incurred_on: string
          project_id: string
          receipt_url?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["expense_status"]
          submitter_employee_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          currency?: string
          description?: string
          final_approved_at?: string | null
          final_approver_id?: string | null
          finance_approved_at?: string | null
          finance_approver_id?: string | null
          id?: string
          incurred_on?: string
          project_id?: string
          receipt_url?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["expense_status"]
          submitter_employee_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_expenses_final_approver_id_fkey"
            columns: ["final_approver_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_expenses_final_approver_id_fkey"
            columns: ["final_approver_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_expenses_finance_approver_id_fkey"
            columns: ["finance_approver_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_expenses_finance_approver_id_fkey"
            columns: ["finance_approver_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_expenses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_expenses_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_expenses_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_expenses_submitter_employee_id_fkey"
            columns: ["submitter_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_expenses_submitter_employee_id_fkey"
            columns: ["submitter_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_expenses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      project_issue_events: {
        Row: {
          actor_employee_id: string | null
          comment: string | null
          created_at: string
          from_assignee: string | null
          from_status:
            | Database["public"]["Enums"]["project_issue_status"]
            | null
          id: number
          issue_id: string
          kind: Database["public"]["Enums"]["project_issue_event_kind"]
          metadata: Json | null
          tenant_id: string
          to_assignee: string | null
          to_status: Database["public"]["Enums"]["project_issue_status"] | null
        }
        Insert: {
          actor_employee_id?: string | null
          comment?: string | null
          created_at?: string
          from_assignee?: string | null
          from_status?:
            | Database["public"]["Enums"]["project_issue_status"]
            | null
          id?: never
          issue_id: string
          kind: Database["public"]["Enums"]["project_issue_event_kind"]
          metadata?: Json | null
          tenant_id: string
          to_assignee?: string | null
          to_status?: Database["public"]["Enums"]["project_issue_status"] | null
        }
        Update: {
          actor_employee_id?: string | null
          comment?: string | null
          created_at?: string
          from_assignee?: string | null
          from_status?:
            | Database["public"]["Enums"]["project_issue_status"]
            | null
          id?: never
          issue_id?: string
          kind?: Database["public"]["Enums"]["project_issue_event_kind"]
          metadata?: Json | null
          tenant_id?: string
          to_assignee?: string | null
          to_status?: Database["public"]["Enums"]["project_issue_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "project_issue_events_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_issue_events_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_issue_events_from_assignee_fkey"
            columns: ["from_assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_issue_events_from_assignee_fkey"
            columns: ["from_assignee"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_issue_events_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "project_issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_issue_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_issue_events_to_assignee_fkey"
            columns: ["to_assignee"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_issue_events_to_assignee_fkey"
            columns: ["to_assignee"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
        ]
      }
      project_issues: {
        Row: {
          assignee_employee_id: string | null
          closed_at: string | null
          closed_by: string | null
          created_at: string
          description: string
          escalation_level: number
          id: string
          last_escalated_at: string | null
          project_id: string
          reopened_at: string | null
          reopened_by: string | null
          reporter_employee_id: string
          resolved_at: string | null
          resolved_by: string | null
          severity: Database["public"]["Enums"]["project_issue_severity"]
          sla_due_at: string
          status: Database["public"]["Enums"]["project_issue_status"]
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_employee_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          description?: string
          escalation_level?: number
          id?: string
          last_escalated_at?: string | null
          project_id: string
          reopened_at?: string | null
          reopened_by?: string | null
          reporter_employee_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["project_issue_severity"]
          sla_due_at: string
          status?: Database["public"]["Enums"]["project_issue_status"]
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_employee_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          description?: string
          escalation_level?: number
          id?: string
          last_escalated_at?: string | null
          project_id?: string
          reopened_at?: string | null
          reopened_by?: string | null
          reporter_employee_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["project_issue_severity"]
          sla_due_at?: string
          status?: Database["public"]["Enums"]["project_issue_status"]
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_issues_assignee_employee_id_fkey"
            columns: ["assignee_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_issues_assignee_employee_id_fkey"
            columns: ["assignee_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_issues_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_issues_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_issues_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_issues_reopened_by_fkey"
            columns: ["reopened_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_issues_reopened_by_fkey"
            columns: ["reopened_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_issues_reporter_employee_id_fkey"
            columns: ["reporter_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_issues_reporter_employee_id_fkey"
            columns: ["reporter_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_issues_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_issues_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_issues_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      project_milestones: {
        Row: {
          actual_end_date: string | null
          actual_start_date: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          owner_employee_id: string | null
          planned_end_date: string | null
          planned_start_date: string | null
          project_id: string
          seq: number
          status: Database["public"]["Enums"]["milestone_status"]
          tenant_id: string
          updated_at: string
          weight_bps: number
        }
        Insert: {
          actual_end_date?: string | null
          actual_start_date?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          owner_employee_id?: string | null
          planned_end_date?: string | null
          planned_start_date?: string | null
          project_id: string
          seq: number
          status?: Database["public"]["Enums"]["milestone_status"]
          tenant_id: string
          updated_at?: string
          weight_bps: number
        }
        Update: {
          actual_end_date?: string | null
          actual_start_date?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          owner_employee_id?: string | null
          planned_end_date?: string | null
          planned_start_date?: string | null
          project_id?: string
          seq?: number
          status?: Database["public"]["Enums"]["milestone_status"]
          tenant_id?: string
          updated_at?: string
          weight_bps?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_milestones_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_milestones_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_milestones_owner_employee_id_fkey"
            columns: ["owner_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_milestones_owner_employee_id_fkey"
            columns: ["owner_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_milestones_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      project_pm_assignments: {
        Row: {
          assignment_role: Database["public"]["Enums"]["pm_assignment_role"]
          created_at: string
          created_by: string | null
          ended_at: string | null
          id: string
          pm_employee_id: string
          project_id: string
          started_at: string
          status: Database["public"]["Enums"]["assignment_status"]
          tenant_id: string
        }
        Insert: {
          assignment_role?: Database["public"]["Enums"]["pm_assignment_role"]
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          id?: string
          pm_employee_id: string
          project_id: string
          started_at?: string
          status?: Database["public"]["Enums"]["assignment_status"]
          tenant_id: string
        }
        Update: {
          assignment_role?: Database["public"]["Enums"]["pm_assignment_role"]
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          id?: string
          pm_employee_id?: string
          project_id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["assignment_status"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_pm_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_pm_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_pm_assignments_pm_employee_id_fkey"
            columns: ["pm_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_pm_assignments_pm_employee_id_fkey"
            columns: ["pm_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_pm_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_pm_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          client_id: string
          code: string
          contract_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          end_date: string | null
          id: string
          name: string
          progress: number
          project_number: string | null
          project_type: Database["public"]["Enums"]["project_type"]
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          client_id: string
          code: string
          contract_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          name: string
          progress?: number
          project_number?: string | null
          project_type?: Database["public"]["Enums"]["project_type"]
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          code?: string
          contract_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          name?: string
          progress?: number
          project_number?: string | null
          project_type?: Database["public"]["Enums"]["project_type"]
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "bpo_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      secret_rotations: {
        Row: {
          created_at: string
          last_rotated_at: string
          last_rotated_by: string | null
          name: string
          notes: string | null
          priority: Database["public"]["Enums"]["secret_priority"]
          purpose: string
          rotation_interval_days: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          last_rotated_at?: string
          last_rotated_by?: string | null
          name: string
          notes?: string | null
          priority: Database["public"]["Enums"]["secret_priority"]
          purpose: string
          rotation_interval_days?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          last_rotated_at?: string
          last_rotated_by?: string | null
          name?: string
          notes?: string | null
          priority?: Database["public"]["Enums"]["secret_priority"]
          purpose?: string
          rotation_interval_days?: number
          updated_at?: string
        }
        Relationships: []
      }
      security_audit_logs: {
        Row: {
          action_type: Database["public"]["Enums"]["audit_action_type"]
          actor_employee_id: string | null
          actor_role: Database["public"]["Enums"]["employee_role"] | null
          actor_user_id: string | null
          created_at: string
          id: number
          ip_address: unknown
          metadata: Json | null
          new_values: Json | null
          old_values: Json | null
          resource_id: string | null
          resource_name: string
          tenant_id: string
          user_agent: string | null
        }
        Insert: {
          action_type: Database["public"]["Enums"]["audit_action_type"]
          actor_employee_id?: string | null
          actor_role?: Database["public"]["Enums"]["employee_role"] | null
          actor_user_id?: string | null
          created_at?: string
          id?: never
          ip_address?: unknown
          metadata?: Json | null
          new_values?: Json | null
          old_values?: Json | null
          resource_id?: string | null
          resource_name: string
          tenant_id: string
          user_agent?: string | null
        }
        Update: {
          action_type?: Database["public"]["Enums"]["audit_action_type"]
          actor_employee_id?: string | null
          actor_role?: Database["public"]["Enums"]["employee_role"] | null
          actor_user_id?: string | null
          created_at?: string
          id?: never
          ip_address?: unknown
          metadata?: Json | null
          new_values?: Json | null
          old_values?: Json | null
          resource_id?: string | null
          resource_name?: string
          tenant_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "security_audit_logs_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "security_audit_logs_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "security_audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          timezone: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          timezone?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          timezone?: string
        }
        Relationships: []
      }
      timesheet_week_approval_logs: {
        Row: {
          action: Database["public"]["Enums"]["approval_action"]
          actor_employee_id: string | null
          actor_role: Database["public"]["Enums"]["employee_role"] | null
          comment: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["timesheet_status"]
          id: number
          tenant_id: string
          to_status: Database["public"]["Enums"]["timesheet_status"]
          week_id: string
        }
        Insert: {
          action: Database["public"]["Enums"]["approval_action"]
          actor_employee_id?: string | null
          actor_role?: Database["public"]["Enums"]["employee_role"] | null
          comment?: string | null
          created_at?: string
          from_status: Database["public"]["Enums"]["timesheet_status"]
          id?: never
          tenant_id: string
          to_status: Database["public"]["Enums"]["timesheet_status"]
          week_id: string
        }
        Update: {
          action?: Database["public"]["Enums"]["approval_action"]
          actor_employee_id?: string | null
          actor_role?: Database["public"]["Enums"]["employee_role"] | null
          comment?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["timesheet_status"]
          id?: never
          tenant_id?: string
          to_status?: Database["public"]["Enums"]["timesheet_status"]
          week_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_week_approval_logs_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_week_approval_logs_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_week_approval_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_week_approval_logs_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "timesheet_weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheet_weeks: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          employee_id: string
          id: string
          notes: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          status: Database["public"]["Enums"]["timesheet_status"]
          submitted_at: string | null
          tenant_id: string
          total_hours: number
          total_overtime: number
          updated_at: string
          week_start_date: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          employee_id: string
          id?: string
          notes?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["timesheet_status"]
          submitted_at?: string | null
          tenant_id: string
          total_hours?: number
          total_overtime?: number
          updated_at?: string
          week_start_date: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          employee_id?: string
          id?: string
          notes?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["timesheet_status"]
          submitted_at?: string | null
          tenant_id?: string
          total_hours?: number
          total_overtime?: number
          updated_at?: string
          week_start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_weeks_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_weeks_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_weeks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_weeks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_weeks_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_weeks_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_weeks_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_weeks_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_weeks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheets: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          clock_in: string | null
          clock_out: string | null
          created_at: string
          created_by: string | null
          employee_id: string
          hours_overtime: number
          hours_worked: number
          id: string
          notes: string | null
          project_id: string | null
          rejection_reason: string | null
          roster_id: string | null
          status: Database["public"]["Enums"]["timesheet_status"]
          submitted_at: string | null
          tenant_id: string
          updated_at: string
          week_id: string | null
          work_date: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          clock_in?: string | null
          clock_out?: string | null
          created_at?: string
          created_by?: string | null
          employee_id: string
          hours_overtime?: number
          hours_worked?: number
          id?: string
          notes?: string | null
          project_id?: string | null
          rejection_reason?: string | null
          roster_id?: string | null
          status?: Database["public"]["Enums"]["timesheet_status"]
          submitted_at?: string | null
          tenant_id: string
          updated_at?: string
          week_id?: string | null
          work_date: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          clock_in?: string | null
          clock_out?: string | null
          created_at?: string
          created_by?: string | null
          employee_id?: string
          hours_overtime?: number
          hours_worked?: number
          id?: string
          notes?: string | null
          project_id?: string | null
          rejection_reason?: string | null
          roster_id?: string | null
          status?: Database["public"]["Enums"]["timesheet_status"]
          submitted_at?: string | null
          tenant_id?: string
          updated_at?: string
          week_id?: string | null
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheets_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_roster_id_fkey"
            columns: ["roster_id"]
            isOneToOne: false
            referencedRelation: "employee_rosters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "timesheet_weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      work_shifts: {
        Row: {
          code: string
          created_at: string
          duration: string
          end_time: string
          id: string
          is_active: boolean
          is_night: boolean
          name: string
          shift_allowance: number
          start_time: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          duration: string
          end_time: string
          id?: string
          is_active?: boolean
          is_night?: boolean
          name: string
          shift_allowance?: number
          start_time: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          duration?: string
          end_time?: string
          id?: string
          is_active?: boolean
          is_night?: boolean
          name?: string
          shift_allowance?: number
          start_time?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_shifts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      employees_canonical: {
        Row: {
          canonical_role: string | null
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string | null
          is_active: boolean | null
          legacy_role: Database["public"]["Enums"]["employee_role"] | null
          reports_to_employee_id: string | null
          tenant_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          canonical_role?: never
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string | null
          is_active?: boolean | null
          legacy_role?: Database["public"]["Enums"]["employee_role"] | null
          reports_to_employee_id?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          canonical_role?: never
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string | null
          is_active?: boolean | null
          legacy_role?: Database["public"]["Enums"]["employee_role"] | null
          reports_to_employee_id?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_reports_to_employee_id_fkey"
            columns: ["reports_to_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_reports_to_employee_id_fkey"
            columns: ["reports_to_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      anonymize_terminated_employee: {
        Args: { p_employee_id: string }
        Returns: undefined
      }
      canonical_employee_role: { Args: never; Returns: string }
      compute_project_direct_labour: {
        Args: { p_from_date: string; p_project_id: string; p_to_date: string }
        Returns: number
      }
      current_employee_role: {
        Args: never
        Returns: Database["public"]["Enums"]["employee_role"]
      }
      current_tenant_id: { Args: never; Returns: string }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      enqueue_notification: {
        Args: {
          p_action_url?: string
          p_body?: string
          p_kind: Database["public"]["Enums"]["notification_kind"]
          p_payload?: Json
          p_recipient_user_id: string
          p_title: string
        }
        Returns: string
      }
      enqueue_portal_notification: {
        Args: {
          p_action_url?: string
          p_body?: string
          p_client_id: string
          p_kind: Database["public"]["Enums"]["portal_notification_kind"]
          p_payload?: Json
          p_tenant_id: string
          p_title: string
        }
        Returns: number
      }
      finalise_pm_handover: {
        Args: { p_handover_id: string }
        Returns: undefined
      }
      is_assigned_to_project: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      next_cash_advance_status: {
        Args: {
          p_amount: number
          p_current: Database["public"]["Enums"]["cash_advance_status"]
        }
        Returns: Database["public"]["Enums"]["cash_advance_status"]
      }
      next_expense_status: {
        Args: {
          p_amount: number
          p_current: Database["public"]["Enums"]["expense_status"]
        }
        Returns: Database["public"]["Enums"]["expense_status"]
      }
      next_hr_request_status: {
        Args: {
          p_current: Database["public"]["Enums"]["hr_request_status"]
          p_kind: Database["public"]["Enums"]["hr_request_kind"]
        }
        Returns: Database["public"]["Enums"]["hr_request_status"]
      }
      project_issue_naive_sla: {
        Args: {
          p_severity: Database["public"]["Enums"]["project_issue_severity"]
          p_started_at: string
        }
        Returns: string
      }
      purge_archived_audit_logs: {
        Args: {
          p_batch_end: string
          p_batch_start: string
          p_tenant_id: string
        }
        Returns: number
      }
      record_audit_log: {
        Args: {
          p_action_type: Database["public"]["Enums"]["audit_action_type"]
          p_ip_address?: unknown
          p_metadata?: Json
          p_new_values?: Json
          p_old_values?: Json
          p_resource_id?: string
          p_resource_name: string
          p_user_agent?: string
        }
        Returns: number
      }
      resolve_tenant_id_by_slug: { Args: { p_slug: string }; Returns: string }
      secret_rotation_status: {
        Args: never
        Returns: {
          days_since_rotation: number
          days_until_due: number
          last_rotated_at: string
          name: string
          priority: Database["public"]["Enums"]["secret_priority"]
          purpose: string
          rotation_interval_days: number
          severity: string
        }[]
      }
    }
    Enums: {
      ai_insight_kind:
        | "PREDICT_EXPENSE_IMPACT"
        | "ANALYZE_RESOURCE_UTILIZATION"
        | "ANALYZE_CLIENT_HEALTH"
        | "ANALYZE_SLA_BREACH"
      ai_insight_severity: "INFO" | "WARNING" | "CRITICAL"
      approval_action:
        | "SUBMIT"
        | "APPROVE"
        | "REJECT"
        | "CANCEL"
        | "FINANCE_APPROVE"
        | "FINANCE_REJECT"
      approval_kind:
        | "EXPENSE"
        | "BUDGET"
        | "CASH_ADVANCE_GENERAL"
        | "CASH_ADVANCE_FIELD_OPS"
        | "PETTY_CASH"
        | "BUDGET_REQUEST"
      assignment_status: "ACTIVE" | "ENDED"
      audit_action_type:
        | "CREATE"
        | "UPDATE"
        | "DELETE"
        | "APPROVE"
        | "REJECT"
        | "SUBMIT"
        | "CANCEL"
        | "DISBURSE"
        | "SETTLE"
        | "LOGIN"
        | "LOGOUT"
        | "IMPERSONATE"
        | "EXPORT"
        | "ROLE_CHANGE"
      budget_request_kind: "INCREASE" | "DECREASE" | "TRANSFER"
      budget_request_line_direction: "FROM" | "TO"
      budget_request_status:
        | "DRAFT"
        | "PENDING_PM"
        | "PENDING_FINANCE"
        | "PENDING_DIRECTOR"
        | "APPROVED"
        | "APPLIED"
        | "REJECTED"
        | "CANCELLED"
      budget_status:
        | "DRAFT"
        | "PENDING_FINANCE"
        | "PENDING_DIRECTOR"
        | "APPROVED"
        | "REVISED"
        | "CANCELLED"
      cash_advance_settlement_status:
        | "DRAFT"
        | "SUBMITTED"
        | "ACCEPTED"
        | "RETURNED"
      cash_advance_status:
        | "DRAFT"
        | "PENDING_L1_SUPERVISOR"
        | "PENDING_L2_PROJECT_MANAGER"
        | "PENDING_L2_5_FINANCE"
        | "PENDING_L3_OPERATIONS_MANAGER"
        | "PENDING_L4_HEAD_MANAGER"
        | "PENDING_L5_GENERAL_MANAGER"
        | "APPROVED"
        | "DISBURSED"
        | "SETTLED"
        | "REJECTED"
        | "CANCELLED"
        | "PENDING_SUPERVISOR"
        | "PENDING_PM"
        | "PENDING_OM"
        | "PENDING_FINANCE"
        | "PENDING_DIRECTOR"
      cash_advance_type: "GENERAL" | "FIELD_OPS"
      client_status: "PROSPECT" | "ACTIVE" | "ON_HOLD" | "CHURNED"
      client_user_status:
        | "PENDING_ACTIVATION"
        | "ACTIVE"
        | "DISABLED"
        | "LOCKED"
      contract_status: "DRAFT" | "ACTIVE" | "ENDED" | "RENEWED" | "TERMINATED"
      data_archive_source:
        | "security_audit_logs"
        | "cash_advance_settlements"
        | "petty_cash_vouchers"
        | "project_expenses"
        | "cash_advances"
      data_archive_status:
        | "PENDING"
        | "ARCHIVED"
        | "PURGED"
        | "RESTORED"
        | "FAILED"
      employee_role:
        | "EMPLOYEE"
        | "SUPERVISOR"
        | "PROJECT_MANAGER"
        | "OPERATIONS_MANAGER"
        | "HEAD_MANAGER"
        | "GENERAL_MANAGER"
        | "PETTY_CASH_CUSTODIAN"
        | "LEAD_FINANCE"
        | "HR_ADMIN"
        | "TENANT_ADMIN"
        | "ADMIN"
        | "DIRECTOR"
        | "FINANCE"
        | "PM"
        | "OM"
      expense_status:
        | "DRAFT"
        | "PENDING_L1_SUPERVISOR"
        | "PENDING_L2_PROJECT_MANAGER"
        | "PENDING_L2_5_FINANCE"
        | "PENDING_L3_OPERATIONS_MANAGER"
        | "PENDING_L4_HEAD_MANAGER"
        | "PENDING_L5_GENERAL_MANAGER"
        | "APPROVED"
        | "REJECTED"
        | "CANCELLED"
      hr_leave_type:
        | "ANNUAL"
        | "UNPAID"
        | "MATERNITY"
        | "PATERNITY"
        | "BEREAVEMENT"
        | "MARRIAGE"
        | "OTHER"
      hr_request_kind: "LEAVE" | "OVERTIME" | "SICK"
      hr_request_status:
        | "DRAFT"
        | "PENDING_L1_SUPERVISOR"
        | "PENDING_L2_PROJECT_MANAGER"
        | "PENDING_L3_OPERATIONS_MANAGER"
        | "PENDING_HR_ADMIN"
        | "APPROVED"
        | "REJECTED"
        | "CANCELLED"
      milestone_status:
        | "PLANNED"
        | "IN_PROGRESS"
        | "AT_RISK"
        | "DONE"
        | "CANCELLED"
      notification_kind:
        | "APPROVAL_REQUESTED"
        | "APPROVAL_APPROVED"
        | "APPROVAL_REJECTED"
        | "CASH_ADVANCE_DISBURSED"
        | "CASH_ADVANCE_SETTLED"
        | "PETTY_CASH_LOW_BALANCE"
        | "HR_REQUEST_UPDATE"
        | "PROJECT_HANDOVER"
        | "SLA_BREACH_WARNING"
        | "SYSTEM"
      payroll_period_status: "DRAFT" | "FINALIZED"
      petty_cash_replenishment_status:
        | "PENDING_FINANCE"
        | "APPROVED"
        | "DISBURSED"
        | "REJECTED"
      petty_cash_voucher_status: "RECORDED" | "VOIDED"
      pm_assignment_role: "PRIMARY_PM" | "CO_PM"
      pm_handover_status:
        | "DRAFT"
        | "PENDING_OM"
        | "PENDING_HM"
        | "APPROVED"
        | "EXECUTED"
        | "REJECTED"
        | "CANCELLED"
      portal_notification_kind:
        | "MILESTONE_UPDATE"
        | "PROJECT_UPDATE"
        | "ANNOUNCEMENT"
        | "SYSTEM"
      project_assignment_role:
        | "PM"
        | "OM"
        | "SITE_SUPERVISOR"
        | "TECH_LEAD"
        | "DEVELOPER"
        | "ENGINEER"
        | "QA"
        | "DESIGNER"
        | "DEVOPS"
        | "CONSULTANT"
        | "SUPPORT"
      project_issue_event_kind:
        | "CREATED"
        | "UPDATED"
        | "STATUS_CHANGED"
        | "ASSIGNED"
        | "COMMENTED"
        | "ESCALATED"
        | "SLA_BREACHED"
        | "REOPENED"
        | "CLOSED"
      project_issue_severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
      project_issue_status:
        | "OPEN"
        | "IN_PROGRESS"
        | "RESOLVED"
        | "CLOSED"
        | "REOPENED"
      project_status:
        | "PLANNING"
        | "ACTIVE"
        | "ON_HOLD"
        | "COMPLETED"
        | "ARCHIVED"
      project_type: "FIXED_PRICE" | "TIME_MATERIAL" | "RETAINER" | "INTERNAL"
      secret_priority: "P0" | "P1" | "P2"
      timesheet_status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      ai_insight_kind: [
        "PREDICT_EXPENSE_IMPACT",
        "ANALYZE_RESOURCE_UTILIZATION",
        "ANALYZE_CLIENT_HEALTH",
        "ANALYZE_SLA_BREACH",
      ],
      ai_insight_severity: ["INFO", "WARNING", "CRITICAL"],
      approval_action: [
        "SUBMIT",
        "APPROVE",
        "REJECT",
        "CANCEL",
        "FINANCE_APPROVE",
        "FINANCE_REJECT",
      ],
      approval_kind: [
        "EXPENSE",
        "BUDGET",
        "CASH_ADVANCE_GENERAL",
        "CASH_ADVANCE_FIELD_OPS",
        "PETTY_CASH",
        "BUDGET_REQUEST",
      ],
      assignment_status: ["ACTIVE", "ENDED"],
      audit_action_type: [
        "CREATE",
        "UPDATE",
        "DELETE",
        "APPROVE",
        "REJECT",
        "SUBMIT",
        "CANCEL",
        "DISBURSE",
        "SETTLE",
        "LOGIN",
        "LOGOUT",
        "IMPERSONATE",
        "EXPORT",
        "ROLE_CHANGE",
      ],
      budget_request_kind: ["INCREASE", "DECREASE", "TRANSFER"],
      budget_request_line_direction: ["FROM", "TO"],
      budget_request_status: [
        "DRAFT",
        "PENDING_PM",
        "PENDING_FINANCE",
        "PENDING_DIRECTOR",
        "APPROVED",
        "APPLIED",
        "REJECTED",
        "CANCELLED",
      ],
      budget_status: [
        "DRAFT",
        "PENDING_FINANCE",
        "PENDING_DIRECTOR",
        "APPROVED",
        "REVISED",
        "CANCELLED",
      ],
      cash_advance_settlement_status: [
        "DRAFT",
        "SUBMITTED",
        "ACCEPTED",
        "RETURNED",
      ],
      cash_advance_status: [
        "DRAFT",
        "PENDING_L1_SUPERVISOR",
        "PENDING_L2_PROJECT_MANAGER",
        "PENDING_L2_5_FINANCE",
        "PENDING_L3_OPERATIONS_MANAGER",
        "PENDING_L4_HEAD_MANAGER",
        "PENDING_L5_GENERAL_MANAGER",
        "APPROVED",
        "DISBURSED",
        "SETTLED",
        "REJECTED",
        "CANCELLED",
        "PENDING_SUPERVISOR",
        "PENDING_PM",
        "PENDING_OM",
        "PENDING_FINANCE",
        "PENDING_DIRECTOR",
      ],
      cash_advance_type: ["GENERAL", "FIELD_OPS"],
      client_status: ["PROSPECT", "ACTIVE", "ON_HOLD", "CHURNED"],
      client_user_status: [
        "PENDING_ACTIVATION",
        "ACTIVE",
        "DISABLED",
        "LOCKED",
      ],
      contract_status: ["DRAFT", "ACTIVE", "ENDED", "RENEWED", "TERMINATED"],
      data_archive_source: [
        "security_audit_logs",
        "cash_advance_settlements",
        "petty_cash_vouchers",
        "project_expenses",
        "cash_advances",
      ],
      data_archive_status: [
        "PENDING",
        "ARCHIVED",
        "PURGED",
        "RESTORED",
        "FAILED",
      ],
      employee_role: [
        "EMPLOYEE",
        "SUPERVISOR",
        "PROJECT_MANAGER",
        "OPERATIONS_MANAGER",
        "HEAD_MANAGER",
        "GENERAL_MANAGER",
        "PETTY_CASH_CUSTODIAN",
        "LEAD_FINANCE",
        "HR_ADMIN",
        "TENANT_ADMIN",
        "ADMIN",
        "DIRECTOR",
        "FINANCE",
        "PM",
        "OM",
      ],
      expense_status: [
        "DRAFT",
        "PENDING_L1_SUPERVISOR",
        "PENDING_L2_PROJECT_MANAGER",
        "PENDING_L2_5_FINANCE",
        "PENDING_L3_OPERATIONS_MANAGER",
        "PENDING_L4_HEAD_MANAGER",
        "PENDING_L5_GENERAL_MANAGER",
        "APPROVED",
        "REJECTED",
        "CANCELLED",
      ],
      hr_leave_type: [
        "ANNUAL",
        "UNPAID",
        "MATERNITY",
        "PATERNITY",
        "BEREAVEMENT",
        "MARRIAGE",
        "OTHER",
      ],
      hr_request_kind: ["LEAVE", "OVERTIME", "SICK"],
      hr_request_status: [
        "DRAFT",
        "PENDING_L1_SUPERVISOR",
        "PENDING_L2_PROJECT_MANAGER",
        "PENDING_L3_OPERATIONS_MANAGER",
        "PENDING_HR_ADMIN",
        "APPROVED",
        "REJECTED",
        "CANCELLED",
      ],
      milestone_status: [
        "PLANNED",
        "IN_PROGRESS",
        "AT_RISK",
        "DONE",
        "CANCELLED",
      ],
      notification_kind: [
        "APPROVAL_REQUESTED",
        "APPROVAL_APPROVED",
        "APPROVAL_REJECTED",
        "CASH_ADVANCE_DISBURSED",
        "CASH_ADVANCE_SETTLED",
        "PETTY_CASH_LOW_BALANCE",
        "HR_REQUEST_UPDATE",
        "PROJECT_HANDOVER",
        "SLA_BREACH_WARNING",
        "SYSTEM",
      ],
      payroll_period_status: ["DRAFT", "FINALIZED"],
      petty_cash_replenishment_status: [
        "PENDING_FINANCE",
        "APPROVED",
        "DISBURSED",
        "REJECTED",
      ],
      petty_cash_voucher_status: ["RECORDED", "VOIDED"],
      pm_assignment_role: ["PRIMARY_PM", "CO_PM"],
      pm_handover_status: [
        "DRAFT",
        "PENDING_OM",
        "PENDING_HM",
        "APPROVED",
        "EXECUTED",
        "REJECTED",
        "CANCELLED",
      ],
      portal_notification_kind: [
        "MILESTONE_UPDATE",
        "PROJECT_UPDATE",
        "ANNOUNCEMENT",
        "SYSTEM",
      ],
      project_assignment_role: [
        "PM",
        "OM",
        "SITE_SUPERVISOR",
        "TECH_LEAD",
        "DEVELOPER",
        "ENGINEER",
        "QA",
        "DESIGNER",
        "DEVOPS",
        "CONSULTANT",
        "SUPPORT",
      ],
      project_issue_event_kind: [
        "CREATED",
        "UPDATED",
        "STATUS_CHANGED",
        "ASSIGNED",
        "COMMENTED",
        "ESCALATED",
        "SLA_BREACHED",
        "REOPENED",
        "CLOSED",
      ],
      project_issue_severity: ["CRITICAL", "HIGH", "MEDIUM", "LOW"],
      project_issue_status: [
        "OPEN",
        "IN_PROGRESS",
        "RESOLVED",
        "CLOSED",
        "REOPENED",
      ],
      project_status: [
        "PLANNING",
        "ACTIVE",
        "ON_HOLD",
        "COMPLETED",
        "ARCHIVED",
      ],
      project_type: ["FIXED_PRICE", "TIME_MATERIAL", "RETAINER", "INTERNAL"],
      secret_priority: ["P0", "P1", "P2"],
      timesheet_status: ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"],
    },
  },
} as const

