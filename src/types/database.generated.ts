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
            foreignKeyName: "ai_insights_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "approval_thresholds_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
          {
            foreignKeyName: "approval_thresholds_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
          {
            foreignKeyName: "attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "bpo_contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
          coa_id: string | null
          code: string | null
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
          coa_id?: string | null
          code?: string | null
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
          coa_id?: string | null
          code?: string | null
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
            foreignKeyName: "budget_details_coa_id_fkey"
            columns: ["coa_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
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
            foreignKeyName: "budget_details_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
          {
            foreignKeyName: "budget_details_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "budget_request_approval_logs_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "budget_request_lines_budget_detail_id_fkey"
            columns: ["budget_detail_id"]
            isOneToOne: false
            referencedRelation: "v_project_budget_lines"
            referencedColumns: ["budget_detail_id"]
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
          chain_snapshot: Json | null
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
          chain_snapshot?: Json | null
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
          chain_snapshot?: Json | null
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
            foreignKeyName: "budget_requests_applied_by_fkey"
            columns: ["applied_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "budget_requests_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "budget_requests_director_approver_id_fkey"
            columns: ["director_approver_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "budget_requests_finance_approver_id_fkey"
            columns: ["finance_approver_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "budget_requests_pm_approver_id_fkey"
            columns: ["pm_approver_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "budget_requests_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "budget_requests_requester_employee_id_fkey"
            columns: ["requester_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
          chain_snapshot: Json | null
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
          unit_pengaju: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          chain_snapshot?: Json | null
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
          unit_pengaju?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          chain_snapshot?: Json | null
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
          unit_pengaju?: string | null
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
            foreignKeyName: "budgets_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "budgets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
          {
            foreignKeyName: "budgets_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "cash_advance_approval_logs_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
      cash_advance_field_ops_details: {
        Row: {
          area: string | null
          bank_account_no: string | null
          bank_name: string | null
          bank_owner_name: string | null
          cash_advance_id: string
          cid_company: string | null
          created_at: string
          created_by: string | null
          driver_phone: string | null
          gmap_duration: string | null
          id: string
          jarak_pp_km: number | null
          justification: string | null
          pic_name: string | null
          pic_phone: string | null
          pickup_key_bts: boolean
          tenant_id: string
          ticket_number: string
          transport_need: string | null
          tujuan: string | null
          unit_pengaju: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          area?: string | null
          bank_account_no?: string | null
          bank_name?: string | null
          bank_owner_name?: string | null
          cash_advance_id: string
          cid_company?: string | null
          created_at?: string
          created_by?: string | null
          driver_phone?: string | null
          gmap_duration?: string | null
          id?: string
          jarak_pp_km?: number | null
          justification?: string | null
          pic_name?: string | null
          pic_phone?: string | null
          pickup_key_bts?: boolean
          tenant_id: string
          ticket_number: string
          transport_need?: string | null
          tujuan?: string | null
          unit_pengaju?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          area?: string | null
          bank_account_no?: string | null
          bank_name?: string | null
          bank_owner_name?: string | null
          cash_advance_id?: string
          cid_company?: string | null
          created_at?: string
          created_by?: string | null
          driver_phone?: string | null
          gmap_duration?: string | null
          id?: string
          jarak_pp_km?: number | null
          justification?: string | null
          pic_name?: string | null
          pic_phone?: string | null
          pickup_key_bts?: boolean
          tenant_id?: string
          ticket_number?: string
          transport_need?: string | null
          tujuan?: string | null
          unit_pengaju?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_advance_field_ops_details_cash_advance_id_fkey"
            columns: ["cash_advance_id"]
            isOneToOne: true
            referencedRelation: "cash_advances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advance_field_ops_details_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advance_field_ops_details_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advance_field_ops_details_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "cash_advance_field_ops_details_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advance_field_ops_details_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advance_field_ops_details_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advance_field_ops_details_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      cash_advance_rab_lines: {
        Row: {
          amount: number
          cash_advance_id: string
          category: string
          coa_id: string | null
          created_at: string
          detail: string | null
          id: string
          seq: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          cash_advance_id: string
          category: string
          coa_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          seq?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          cash_advance_id?: string
          category?: string
          coa_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          seq?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_advance_rab_lines_cash_advance_id_fkey"
            columns: ["cash_advance_id"]
            isOneToOne: false
            referencedRelation: "cash_advances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advance_rab_lines_coa_id_fkey"
            columns: ["coa_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advance_rab_lines_tenant_id_fkey"
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
            foreignKeyName: "cash_advance_settlements_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "cash_advance_settlements_returned_by_fkey"
            columns: ["returned_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "cash_advance_settlements_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
          chain_snapshot: Json | null
          coa_id: string | null
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
          settlement_due_at: string | null
          status: Database["public"]["Enums"]["cash_advance_status"]
          supervisor_approved_at: string | null
          supervisor_approver_id: string | null
          tenant_id: string
          unit_pengaju: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          ca_type?: Database["public"]["Enums"]["cash_advance_type"]
          chain_snapshot?: Json | null
          coa_id?: string | null
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
          settlement_due_at?: string | null
          status?: Database["public"]["Enums"]["cash_advance_status"]
          supervisor_approved_at?: string | null
          supervisor_approver_id?: string | null
          tenant_id: string
          unit_pengaju?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          ca_type?: Database["public"]["Enums"]["cash_advance_type"]
          chain_snapshot?: Json | null
          coa_id?: string | null
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
          settlement_due_at?: string | null
          status?: Database["public"]["Enums"]["cash_advance_status"]
          supervisor_approved_at?: string | null
          supervisor_approver_id?: string | null
          tenant_id?: string
          unit_pengaju?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_advances_coa_id_fkey"
            columns: ["coa_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
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
            foreignKeyName: "cash_advances_director_approver_id_fkey"
            columns: ["director_approver_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "cash_advances_disbursed_by_fkey"
            columns: ["disbursed_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "cash_advances_final_approver_id_fkey"
            columns: ["final_approver_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "cash_advances_finance_approver_id_fkey"
            columns: ["finance_approver_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "cash_advances_om_approver_id_fkey"
            columns: ["om_approver_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "cash_advances_pm_approver_id_fkey"
            columns: ["pm_approver_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "cash_advances_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "cash_advances_requester_employee_id_fkey"
            columns: ["requester_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "cash_advances_supervisor_approver_id_fkey"
            columns: ["supervisor_approver_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
      chart_of_accounts: {
        Row: {
          account_type: Database["public"]["Enums"]["coa_account_type"]
          code: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          is_postable: boolean
          name: string
          normal_side: Database["public"]["Enums"]["coa_normal_side"]
          parent_id: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_type: Database["public"]["Enums"]["coa_account_type"]
          code: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_postable?: boolean
          name: string
          normal_side: Database["public"]["Enums"]["coa_normal_side"]
          parent_id?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_type?: Database["public"]["Enums"]["coa_account_type"]
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_postable?: boolean
          name?: string
          normal_side?: Database["public"]["Enums"]["coa_normal_side"]
          parent_id?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chart_of_accounts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chart_of_accounts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chart_of_accounts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "chart_of_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chart_of_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chart_of_accounts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chart_of_accounts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chart_of_accounts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "client_users_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
          contract_number: string | null
          created_at: string
          created_by: string | null
          id: string
          industry: string | null
          name: string
          notes: string | null
          onboarded_at: string | null
          project_code: string | null
          status: Database["public"]["Enums"]["client_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contract_number?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          industry?: string | null
          name: string
          notes?: string | null
          onboarded_at?: string | null
          project_code?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contract_number?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          industry?: string | null
          name?: string
          notes?: string | null
          onboarded_at?: string | null
          project_code?: string | null
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
            foreignKeyName: "clients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "employee_rosters_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "employee_rosters_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
          availability: Database["public"]["Enums"]["employee_availability"]
          bank_account_number_enc: string | null
          client_display_name: string | null
          contract_end_date: string | null
          created_at: string
          date_of_birth: string | null
          department: string | null
          division: string | null
          email: string
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          employment_type: Database["public"]["Enums"]["employment_type"]
          first_name: string | null
          full_name: string
          hourly_rate: number
          id: string
          is_active: boolean
          join_date: string
          last_name: string | null
          monthly_salary: number
          nik_enc: string | null
          nik_hash: string | null
          notes: string | null
          phone: string | null
          pii_anonymized_at: string | null
          position_title: string | null
          preferred_locale: string | null
          reports_to_employee_id: string | null
          role: Database["public"]["Enums"]["employee_role"]
          tenant_id: string
          terminated_at: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          availability?: Database["public"]["Enums"]["employee_availability"]
          bank_account_number_enc?: string | null
          client_display_name?: string | null
          contract_end_date?: string | null
          created_at?: string
          date_of_birth?: string | null
          department?: string | null
          division?: string | null
          email: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employment_type?: Database["public"]["Enums"]["employment_type"]
          first_name?: string | null
          full_name: string
          hourly_rate?: number
          id?: string
          is_active?: boolean
          join_date?: string
          last_name?: string | null
          monthly_salary?: number
          nik_enc?: string | null
          nik_hash?: string | null
          notes?: string | null
          phone?: string | null
          pii_anonymized_at?: string | null
          position_title?: string | null
          preferred_locale?: string | null
          reports_to_employee_id?: string | null
          role?: Database["public"]["Enums"]["employee_role"]
          tenant_id: string
          terminated_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          availability?: Database["public"]["Enums"]["employee_availability"]
          bank_account_number_enc?: string | null
          client_display_name?: string | null
          contract_end_date?: string | null
          created_at?: string
          date_of_birth?: string | null
          department?: string | null
          division?: string | null
          email?: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employment_type?: Database["public"]["Enums"]["employment_type"]
          first_name?: string | null
          full_name?: string
          hourly_rate?: number
          id?: string
          is_active?: boolean
          join_date?: string
          last_name?: string | null
          monthly_salary?: number
          nik_enc?: string | null
          nik_hash?: string | null
          notes?: string | null
          phone?: string | null
          pii_anonymized_at?: string | null
          position_title?: string | null
          preferred_locale?: string | null
          reports_to_employee_id?: string | null
          role?: Database["public"]["Enums"]["employee_role"]
          tenant_id?: string
          terminated_at?: string | null
          updated_at?: string
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
            foreignKeyName: "employees_reports_to_employee_id_fkey"
            columns: ["reports_to_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
      evaluation_answers: {
        Row: {
          created_at: string
          evaluation_id: string
          id: string
          item_id: string
          numeric_score: number | null
          tenant_id: string
          text_answer: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          evaluation_id: string
          id?: string
          item_id: string
          numeric_score?: number | null
          tenant_id: string
          text_answer?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          evaluation_id?: string
          id?: string
          item_id?: string
          numeric_score?: number | null
          tenant_id?: string
          text_answer?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "evaluation_answers_evaluation_id_fkey"
            columns: ["evaluation_id"]
            isOneToOne: false
            referencedRelation: "performance_evaluations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evaluation_answers_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "evaluation_template_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evaluation_answers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      evaluation_template_items: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_required: boolean
          name: string
          question_type: Database["public"]["Enums"]["evaluation_question_type"]
          seq: number
          template_id: string
          tenant_id: string
          weight_pct: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_required?: boolean
          name: string
          question_type?: Database["public"]["Enums"]["evaluation_question_type"]
          seq: number
          template_id: string
          tenant_id: string
          weight_pct?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_required?: boolean
          name?: string
          question_type?: Database["public"]["Enums"]["evaluation_question_type"]
          seq?: number
          template_id?: string
          tenant_id?: string
          weight_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "evaluation_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "evaluation_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evaluation_template_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      evaluation_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "evaluation_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evaluation_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evaluation_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "evaluation_templates_tenant_id_fkey"
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
            foreignKeyName: "expense_approval_logs_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
      google_calendar_credentials: {
        Row: {
          calendar_id: string
          client_email: string | null
          created_at: string
          encrypted_refresh_token: string
          is_active: boolean
          last_error: string | null
          last_refreshed_at: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          calendar_id?: string
          client_email?: string | null
          created_at?: string
          encrypted_refresh_token: string
          is_active?: boolean
          last_error?: string | null
          last_refreshed_at?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          calendar_id?: string
          client_email?: string | null
          created_at?: string
          encrypted_refresh_token?: string
          is_active?: boolean
          last_error?: string | null
          last_refreshed_at?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_calendar_credentials_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
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
            foreignKeyName: "hr_approval_logs_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "hr_requests_final_approver_id_fkey"
            columns: ["final_approver_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "hr_requests_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "hr_requests_requester_employee_id_fkey"
            columns: ["requester_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
      import_jobs: {
        Row: {
          committed_at: string | null
          created_at: string
          created_by: string | null
          errors: Json
          file_name: string
          file_size_bytes: number
          id: string
          inserted_count: number
          invalid_row_count: number
          resource: Database["public"]["Enums"]["import_job_resource"]
          row_count: number
          stats: Json
          status: Database["public"]["Enums"]["import_job_status"]
          tenant_id: string
          updated_count: number
          valid_row_count: number
        }
        Insert: {
          committed_at?: string | null
          created_at?: string
          created_by?: string | null
          errors?: Json
          file_name: string
          file_size_bytes: number
          id?: string
          inserted_count?: number
          invalid_row_count?: number
          resource: Database["public"]["Enums"]["import_job_resource"]
          row_count?: number
          stats?: Json
          status: Database["public"]["Enums"]["import_job_status"]
          tenant_id: string
          updated_count?: number
          valid_row_count?: number
        }
        Update: {
          committed_at?: string | null
          created_at?: string
          created_by?: string | null
          errors?: Json
          file_name?: string
          file_size_bytes?: number
          id?: string
          inserted_count?: number
          invalid_row_count?: number
          resource?: Database["public"]["Enums"]["import_job_resource"]
          row_count?: number
          stats?: Json
          status?: Database["public"]["Enums"]["import_job_status"]
          tenant_id?: string
          updated_count?: number
          valid_row_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_article_embeddings: {
        Row: {
          article_id: string
          chunk_index: number
          content: string
          created_at: string
          embedding: Json
          id: string
          model_id: string
          tenant_id: string
        }
        Insert: {
          article_id: string
          chunk_index: number
          content: string
          created_at?: string
          embedding: Json
          id?: string
          model_id: string
          tenant_id: string
        }
        Update: {
          article_id?: string
          chunk_index?: number
          content?: string
          created_at?: string
          embedding?: Json
          id?: string
          model_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_article_embeddings_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "knowledge_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_article_embeddings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_article_revisions: {
        Row: {
          article_id: string
          body_md: string
          category: string
          edit_note: string | null
          edited_at: string
          edited_by_employee_id: string
          id: string
          revision_no: number
          status: Database["public"]["Enums"]["knowledge_article_status"]
          summary: string | null
          tenant_id: string
          title: string
          visibility: Database["public"]["Enums"]["knowledge_article_visibility"]
          visibility_project_id: string | null
          visibility_roles: string[] | null
        }
        Insert: {
          article_id: string
          body_md: string
          category: string
          edit_note?: string | null
          edited_at?: string
          edited_by_employee_id: string
          id?: string
          revision_no: number
          status: Database["public"]["Enums"]["knowledge_article_status"]
          summary?: string | null
          tenant_id: string
          title: string
          visibility: Database["public"]["Enums"]["knowledge_article_visibility"]
          visibility_project_id?: string | null
          visibility_roles?: string[] | null
        }
        Update: {
          article_id?: string
          body_md?: string
          category?: string
          edit_note?: string | null
          edited_at?: string
          edited_by_employee_id?: string
          id?: string
          revision_no?: number
          status?: Database["public"]["Enums"]["knowledge_article_status"]
          summary?: string | null
          tenant_id?: string
          title?: string
          visibility?: Database["public"]["Enums"]["knowledge_article_visibility"]
          visibility_project_id?: string | null
          visibility_roles?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_article_revisions_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "knowledge_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_article_revisions_edited_by_employee_id_fkey"
            columns: ["edited_by_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_article_revisions_edited_by_employee_id_fkey"
            columns: ["edited_by_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_article_revisions_edited_by_employee_id_fkey"
            columns: ["edited_by_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "knowledge_article_revisions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_articles: {
        Row: {
          archived_at: string | null
          author_employee_id: string
          body_md: string
          category: string
          created_at: string
          id: string
          published_at: string | null
          slug: string
          status: Database["public"]["Enums"]["knowledge_article_status"]
          summary: string | null
          tenant_id: string
          title: string
          updated_at: string
          view_count: number
          visibility: Database["public"]["Enums"]["knowledge_article_visibility"]
          visibility_project_id: string | null
          visibility_roles: string[] | null
        }
        Insert: {
          archived_at?: string | null
          author_employee_id: string
          body_md: string
          category: string
          created_at?: string
          id?: string
          published_at?: string | null
          slug: string
          status?: Database["public"]["Enums"]["knowledge_article_status"]
          summary?: string | null
          tenant_id: string
          title: string
          updated_at?: string
          view_count?: number
          visibility?: Database["public"]["Enums"]["knowledge_article_visibility"]
          visibility_project_id?: string | null
          visibility_roles?: string[] | null
        }
        Update: {
          archived_at?: string | null
          author_employee_id?: string
          body_md?: string
          category?: string
          created_at?: string
          id?: string
          published_at?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["knowledge_article_status"]
          summary?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
          view_count?: number
          visibility?: Database["public"]["Enums"]["knowledge_article_visibility"]
          visibility_project_id?: string | null
          visibility_roles?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_articles_author_employee_id_fkey"
            columns: ["author_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_articles_author_employee_id_fkey"
            columns: ["author_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_articles_author_employee_id_fkey"
            columns: ["author_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "knowledge_articles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_articles_visibility_project_id_fkey"
            columns: ["visibility_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      lookup_options: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          description: string | null
          domain: string
          id: string
          is_active: boolean
          label: string
          sort_order: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          domain: string
          id?: string
          is_active?: boolean
          label: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          domain?: string
          id?: string
          is_active?: boolean
          label?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lookup_options_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lookup_options_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lookup_options_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "lookup_options_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lookup_options_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lookup_options_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lookup_options_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      monthly_report_attachments: {
        Row: {
          created_at: string
          file_name: string
          id: string
          mime_type: string | null
          report_id: string
          size_bytes: number | null
          storage_path: string
          tenant_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          mime_type?: string | null
          report_id: string
          size_bytes?: number | null
          storage_path: string
          tenant_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          mime_type?: string | null
          report_id?: string
          size_bytes?: number | null
          storage_path?: string
          tenant_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "monthly_report_attachments_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "monthly_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_report_attachments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_report_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_report_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_report_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      monthly_report_sections: {
        Row: {
          content: string | null
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["monthly_report_section_kind"]
          metrics: Json
          report_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["monthly_report_section_kind"]
          metrics?: Json
          report_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          content?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["monthly_report_section_kind"]
          metrics?: Json
          report_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_report_sections_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "monthly_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_report_sections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_reports: {
        Row: {
          ba_generated_at: string | null
          ba_generated_by: string | null
          ba_notes: string | null
          ba_number: string | null
          ba_period_end: string | null
          ba_period_start: string | null
          client_decided_at: string | null
          client_decision_notes: string | null
          client_reviewer_email: string | null
          client_reviewer_name: string | null
          client_signature_file_name: string | null
          client_signature_path: string | null
          created_at: string
          created_by: string | null
          id: string
          period_month: string
          pm_decided_at: string | null
          pm_notes: string | null
          pm_reviewer_id: string | null
          project_id: string
          sent_to_client_at: string | null
          sent_to_client_by: string | null
          spv_notes: string | null
          status: Database["public"]["Enums"]["monthly_report_status"]
          submitted_at: string | null
          submitter_employee_id: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ba_generated_at?: string | null
          ba_generated_by?: string | null
          ba_notes?: string | null
          ba_number?: string | null
          ba_period_end?: string | null
          ba_period_start?: string | null
          client_decided_at?: string | null
          client_decision_notes?: string | null
          client_reviewer_email?: string | null
          client_reviewer_name?: string | null
          client_signature_file_name?: string | null
          client_signature_path?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          period_month: string
          pm_decided_at?: string | null
          pm_notes?: string | null
          pm_reviewer_id?: string | null
          project_id: string
          sent_to_client_at?: string | null
          sent_to_client_by?: string | null
          spv_notes?: string | null
          status?: Database["public"]["Enums"]["monthly_report_status"]
          submitted_at?: string | null
          submitter_employee_id?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ba_generated_at?: string | null
          ba_generated_by?: string | null
          ba_notes?: string | null
          ba_number?: string | null
          ba_period_end?: string | null
          ba_period_start?: string | null
          client_decided_at?: string | null
          client_decision_notes?: string | null
          client_reviewer_email?: string | null
          client_reviewer_name?: string | null
          client_signature_file_name?: string | null
          client_signature_path?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          period_month?: string
          pm_decided_at?: string | null
          pm_notes?: string | null
          pm_reviewer_id?: string | null
          project_id?: string
          sent_to_client_at?: string | null
          sent_to_client_by?: string | null
          spv_notes?: string | null
          status?: Database["public"]["Enums"]["monthly_report_status"]
          submitted_at?: string | null
          submitter_employee_id?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "monthly_reports_ba_generated_by_fkey"
            columns: ["ba_generated_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_reports_ba_generated_by_fkey"
            columns: ["ba_generated_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_reports_ba_generated_by_fkey"
            columns: ["ba_generated_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "monthly_reports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_reports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_reports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "monthly_reports_pm_reviewer_id_fkey"
            columns: ["pm_reviewer_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_reports_pm_reviewer_id_fkey"
            columns: ["pm_reviewer_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_reports_pm_reviewer_id_fkey"
            columns: ["pm_reviewer_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "monthly_reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_reports_sent_to_client_by_fkey"
            columns: ["sent_to_client_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_reports_sent_to_client_by_fkey"
            columns: ["sent_to_client_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_reports_sent_to_client_by_fkey"
            columns: ["sent_to_client_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "monthly_reports_submitter_employee_id_fkey"
            columns: ["submitter_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_reports_submitter_employee_id_fkey"
            columns: ["submitter_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_reports_submitter_employee_id_fkey"
            columns: ["submitter_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "monthly_reports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_reports_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_reports_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_reports_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "notifications_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "payroll_lines_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "payroll_periods_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "payroll_periods_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
      performance_evaluations: {
        Row: {
          competency_meet_pct: number | null
          contract_end_date: string
          contract_extension_end_date: string | null
          contract_extension_months: number | null
          created_at: string
          dev_areas: string | null
          dev_proposal: string | null
          employee_id: string
          finalized_at: string | null
          goal_achievement_pct: number | null
          id: string
          is_final_period: boolean
          om_decided_at: string | null
          om_employee_id: string | null
          om_notes: string | null
          period_end_date: string | null
          period_start_date: string | null
          pm_employee_id: string | null
          pm_notes: string | null
          pm_reviewed_at: string | null
          project_id: string | null
          project_reviewed_at: string | null
          project_reviewer_employee_id: string | null
          project_reviewer_notes: string | null
          spv_employee_id: string
          spv_notes: string | null
          spv_recommendation:
            | Database["public"]["Enums"]["contract_recommendation"]
            | null
          status: Database["public"]["Enums"]["evaluation_status"]
          strengths: string | null
          submitted_at: string | null
          template_id: string
          tenant_id: string
          total_score: number | null
          updated_at: string
        }
        Insert: {
          competency_meet_pct?: number | null
          contract_end_date: string
          contract_extension_end_date?: string | null
          contract_extension_months?: number | null
          created_at?: string
          dev_areas?: string | null
          dev_proposal?: string | null
          employee_id: string
          finalized_at?: string | null
          goal_achievement_pct?: number | null
          id?: string
          is_final_period?: boolean
          om_decided_at?: string | null
          om_employee_id?: string | null
          om_notes?: string | null
          period_end_date?: string | null
          period_start_date?: string | null
          pm_employee_id?: string | null
          pm_notes?: string | null
          pm_reviewed_at?: string | null
          project_id?: string | null
          project_reviewed_at?: string | null
          project_reviewer_employee_id?: string | null
          project_reviewer_notes?: string | null
          spv_employee_id: string
          spv_notes?: string | null
          spv_recommendation?:
            | Database["public"]["Enums"]["contract_recommendation"]
            | null
          status?: Database["public"]["Enums"]["evaluation_status"]
          strengths?: string | null
          submitted_at?: string | null
          template_id: string
          tenant_id: string
          total_score?: number | null
          updated_at?: string
        }
        Update: {
          competency_meet_pct?: number | null
          contract_end_date?: string
          contract_extension_end_date?: string | null
          contract_extension_months?: number | null
          created_at?: string
          dev_areas?: string | null
          dev_proposal?: string | null
          employee_id?: string
          finalized_at?: string | null
          goal_achievement_pct?: number | null
          id?: string
          is_final_period?: boolean
          om_decided_at?: string | null
          om_employee_id?: string | null
          om_notes?: string | null
          period_end_date?: string | null
          period_start_date?: string | null
          pm_employee_id?: string | null
          pm_notes?: string | null
          pm_reviewed_at?: string | null
          project_id?: string | null
          project_reviewed_at?: string | null
          project_reviewer_employee_id?: string | null
          project_reviewer_notes?: string | null
          spv_employee_id?: string
          spv_notes?: string | null
          spv_recommendation?:
            | Database["public"]["Enums"]["contract_recommendation"]
            | null
          status?: Database["public"]["Enums"]["evaluation_status"]
          strengths?: string | null
          submitted_at?: string | null
          template_id?: string
          tenant_id?: string
          total_score?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "performance_evaluations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_evaluations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_evaluations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "performance_evaluations_om_employee_id_fkey"
            columns: ["om_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_evaluations_om_employee_id_fkey"
            columns: ["om_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_evaluations_om_employee_id_fkey"
            columns: ["om_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "performance_evaluations_pm_employee_id_fkey"
            columns: ["pm_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_evaluations_pm_employee_id_fkey"
            columns: ["pm_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_evaluations_pm_employee_id_fkey"
            columns: ["pm_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "performance_evaluations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_evaluations_project_reviewer_employee_id_fkey"
            columns: ["project_reviewer_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_evaluations_project_reviewer_employee_id_fkey"
            columns: ["project_reviewer_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_evaluations_project_reviewer_employee_id_fkey"
            columns: ["project_reviewer_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "performance_evaluations_spv_employee_id_fkey"
            columns: ["spv_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_evaluations_spv_employee_id_fkey"
            columns: ["spv_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_evaluations_spv_employee_id_fkey"
            columns: ["spv_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "performance_evaluations_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "evaluation_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_evaluations_tenant_id_fkey"
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
            foreignKeyName: "petty_cash_funds_custodian_employee_id_fkey"
            columns: ["custodian_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "petty_cash_replenishments_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "petty_cash_replenishments_disbursed_by_fkey"
            columns: ["disbursed_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "petty_cash_replenishments_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "petty_cash_replenishments_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
          coa_id: string | null
          created_at: string
          created_by: string
          description: string
          fund_id: string
          id: string
          incurred_on: string
          receipt_url: string | null
          status: Database["public"]["Enums"]["petty_cash_voucher_status"]
          tenant_id: string
          unit_pengaju: string | null
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          category: string
          coa_id?: string | null
          created_at?: string
          created_by: string
          description: string
          fund_id: string
          id?: string
          incurred_on: string
          receipt_url?: string | null
          status?: Database["public"]["Enums"]["petty_cash_voucher_status"]
          tenant_id: string
          unit_pengaju?: string | null
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          category?: string
          coa_id?: string | null
          created_at?: string
          created_by?: string
          description?: string
          fund_id?: string
          id?: string
          incurred_on?: string
          receipt_url?: string | null
          status?: Database["public"]["Enums"]["petty_cash_voucher_status"]
          tenant_id?: string
          unit_pengaju?: string | null
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_vouchers_coa_id_fkey"
            columns: ["coa_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
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
            foreignKeyName: "petty_cash_vouchers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
          {
            foreignKeyName: "petty_cash_vouchers_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      platform_admin_audit_logs: {
        Row: {
          action_type: Database["public"]["Enums"]["audit_action_type"]
          actor_email: string | null
          actor_user_id: string | null
          created_at: string
          id: number
          ip_address: unknown
          metadata: Json | null
          new_values: Json | null
          old_values: Json | null
          resource_id: string | null
          resource_name: string
          target_tenant_id: string | null
          user_agent: string | null
        }
        Insert: {
          action_type: Database["public"]["Enums"]["audit_action_type"]
          actor_email?: string | null
          actor_user_id?: string | null
          created_at?: string
          id?: never
          ip_address?: unknown
          metadata?: Json | null
          new_values?: Json | null
          old_values?: Json | null
          resource_id?: string | null
          resource_name: string
          target_tenant_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action_type?: Database["public"]["Enums"]["audit_action_type"]
          actor_email?: string | null
          actor_user_id?: string | null
          created_at?: string
          id?: never
          ip_address?: unknown
          metadata?: Json | null
          new_values?: Json | null
          old_values?: Json | null
          resource_id?: string | null
          resource_name?: string
          target_tenant_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_admin_audit_logs_target_tenant_id_fkey"
            columns: ["target_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          full_name: string
          is_active: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          full_name: string
          is_active?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          full_name?: string
          is_active?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
            foreignKeyName: "pm_handover_audit_logs_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "pm_handovers_executed_by_fkey"
            columns: ["executed_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "pm_handovers_from_pm_employee_id_fkey"
            columns: ["from_pm_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "pm_handovers_hm_approver_id_fkey"
            columns: ["hm_approver_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "pm_handovers_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "pm_handovers_om_approver_id_fkey"
            columns: ["om_approver_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "pm_handovers_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
          {
            foreignKeyName: "pm_handovers_to_pm_employee_id_fkey"
            columns: ["to_pm_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
      project_allowed_units: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          project_id: string
          tenant_id: string
          unit_label: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          project_id: string
          tenant_id: string
          unit_label: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          project_id?: string
          tenant_id?: string
          unit_label?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_allowed_units_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_allowed_units_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_allowed_units_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "project_allowed_units_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_allowed_units_tenant_id_fkey"
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
            foreignKeyName: "project_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "project_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
      project_calendar_events: {
        Row: {
          attempts: number
          created_at: string
          google_event_id: string | null
          id: string
          kind: Database["public"]["Enums"]["calendar_event_kind"]
          last_error: string | null
          milestone_id: string | null
          payload: Json
          project_id: string
          scheduled_at: string
          sent_at: string | null
          status: Database["public"]["Enums"]["calendar_event_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          google_event_id?: string | null
          id?: string
          kind: Database["public"]["Enums"]["calendar_event_kind"]
          last_error?: string | null
          milestone_id?: string | null
          payload?: Json
          project_id: string
          scheduled_at?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["calendar_event_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          google_event_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["calendar_event_kind"]
          last_error?: string | null
          milestone_id?: string | null
          payload?: Json
          project_id?: string
          scheduled_at?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["calendar_event_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_calendar_events_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "project_milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_calendar_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_calendar_events_tenant_id_fkey"
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
          notes: string | null
          project_id: string
          role: Database["public"]["Enums"]["project_member_role"]
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
          notes?: string | null
          project_id: string
          role?: Database["public"]["Enums"]["project_member_role"]
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
          notes?: string | null
          project_id?: string
          role?: Database["public"]["Enums"]["project_member_role"]
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
            foreignKeyName: "project_employee_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "project_employee_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
          budget_detail_id: string | null
          category: string
          chain_snapshot: Json | null
          coa_id: string | null
          created_at: string
          currency: string
          description: string
          final_approved_at: string | null
          final_approver_id: string | null
          finance_approved_at: string | null
          finance_approver_id: string | null
          id: string
          incurred_on: string
          late_submission_reason: string | null
          notes: string | null
          payment_method:
            | Database["public"]["Enums"]["expense_payment_method"]
            | null
          project_id: string
          receipt_url: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          status: Database["public"]["Enums"]["expense_status"]
          submitted_at: string | null
          submitter_employee_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          budget_detail_id?: string | null
          category: string
          chain_snapshot?: Json | null
          coa_id?: string | null
          created_at?: string
          currency?: string
          description: string
          final_approved_at?: string | null
          final_approver_id?: string | null
          finance_approved_at?: string | null
          finance_approver_id?: string | null
          id?: string
          incurred_on: string
          late_submission_reason?: string | null
          notes?: string | null
          payment_method?:
            | Database["public"]["Enums"]["expense_payment_method"]
            | null
          project_id: string
          receipt_url?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["expense_status"]
          submitted_at?: string | null
          submitter_employee_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          budget_detail_id?: string | null
          category?: string
          chain_snapshot?: Json | null
          coa_id?: string | null
          created_at?: string
          currency?: string
          description?: string
          final_approved_at?: string | null
          final_approver_id?: string | null
          finance_approved_at?: string | null
          finance_approver_id?: string | null
          id?: string
          incurred_on?: string
          late_submission_reason?: string | null
          notes?: string | null
          payment_method?:
            | Database["public"]["Enums"]["expense_payment_method"]
            | null
          project_id?: string
          receipt_url?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["expense_status"]
          submitted_at?: string | null
          submitter_employee_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_expenses_budget_detail_id_fkey"
            columns: ["budget_detail_id"]
            isOneToOne: false
            referencedRelation: "budget_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_expenses_budget_detail_id_fkey"
            columns: ["budget_detail_id"]
            isOneToOne: false
            referencedRelation: "v_project_budget_lines"
            referencedColumns: ["budget_detail_id"]
          },
          {
            foreignKeyName: "project_expenses_coa_id_fkey"
            columns: ["coa_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
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
            foreignKeyName: "project_expenses_final_approver_id_fkey"
            columns: ["final_approver_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "project_expenses_finance_approver_id_fkey"
            columns: ["finance_approver_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "project_expenses_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "project_expenses_submitter_employee_id_fkey"
            columns: ["submitter_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "project_issue_events_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "project_issue_events_from_assignee_fkey"
            columns: ["from_assignee"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
          {
            foreignKeyName: "project_issue_events_to_assignee_fkey"
            columns: ["to_assignee"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      project_issues: {
        Row: {
          assignee_employee_id: string | null
          category: Database["public"]["Enums"]["project_issue_category"]
          closed_at: string | null
          closed_by: string | null
          created_at: string
          description: string
          due_date: string | null
          escalation_level: number
          id: string
          last_escalated_at: string | null
          milestone_id: string | null
          notes: string | null
          project_id: string
          reopened_at: string | null
          reopened_by: string | null
          reporter_employee_id: string
          resolved_at: string | null
          resolved_by: string | null
          severity: Database["public"]["Enums"]["project_issue_severity"]
          sla_due_at: string
          status: Database["public"]["Enums"]["project_issue_status"]
          tags: string[]
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_employee_id?: string | null
          category?: Database["public"]["Enums"]["project_issue_category"]
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          description?: string
          due_date?: string | null
          escalation_level?: number
          id?: string
          last_escalated_at?: string | null
          milestone_id?: string | null
          notes?: string | null
          project_id: string
          reopened_at?: string | null
          reopened_by?: string | null
          reporter_employee_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["project_issue_severity"]
          sla_due_at: string
          status?: Database["public"]["Enums"]["project_issue_status"]
          tags?: string[]
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_employee_id?: string | null
          category?: Database["public"]["Enums"]["project_issue_category"]
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          description?: string
          due_date?: string | null
          escalation_level?: number
          id?: string
          last_escalated_at?: string | null
          milestone_id?: string | null
          notes?: string | null
          project_id?: string
          reopened_at?: string | null
          reopened_by?: string | null
          reporter_employee_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["project_issue_severity"]
          sla_due_at?: string
          status?: Database["public"]["Enums"]["project_issue_status"]
          tags?: string[]
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
            foreignKeyName: "project_issues_assignee_employee_id_fkey"
            columns: ["assignee_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "project_issues_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "project_issues_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "project_milestones"
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
            foreignKeyName: "project_issues_reopened_by_fkey"
            columns: ["reopened_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "project_issues_reporter_employee_id_fkey"
            columns: ["reporter_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "project_issues_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "project_milestones_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "project_milestones_owner_employee_id_fkey"
            columns: ["owner_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
      project_numbering_sequence: {
        Row: {
          last_seq: number
          tenant_id: string
          year: number
        }
        Insert: {
          last_seq?: number
          tenant_id: string
          year: number
        }
        Update: {
          last_seq?: number
          tenant_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_numbering_sequence_tenant_id_fkey"
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
          notes: string | null
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
          notes?: string | null
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
          notes?: string | null
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
            foreignKeyName: "project_pm_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "project_pm_assignments_pm_employee_id_fkey"
            columns: ["pm_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
      project_tasks: {
        Row: {
          actual_end_date: string | null
          actual_start_date: string | null
          budget_amount: number | null
          created_at: string
          created_by: string | null
          depends_on_task_id: string | null
          description: string | null
          id: string
          milestone_id: string | null
          name: string
          owner_employee_id: string | null
          parent_task_id: string | null
          planned_end_date: string | null
          planned_start_date: string | null
          progress_pct: number
          project_id: string
          sort_order: number
          status: Database["public"]["Enums"]["task_status"]
          tenant_id: string
          updated_at: string
          weight_pct: number
        }
        Insert: {
          actual_end_date?: string | null
          actual_start_date?: string | null
          budget_amount?: number | null
          created_at?: string
          created_by?: string | null
          depends_on_task_id?: string | null
          description?: string | null
          id?: string
          milestone_id?: string | null
          name: string
          owner_employee_id?: string | null
          parent_task_id?: string | null
          planned_end_date?: string | null
          planned_start_date?: string | null
          progress_pct?: number
          project_id: string
          sort_order?: number
          status?: Database["public"]["Enums"]["task_status"]
          tenant_id: string
          updated_at?: string
          weight_pct?: number
        }
        Update: {
          actual_end_date?: string | null
          actual_start_date?: string | null
          budget_amount?: number | null
          created_at?: string
          created_by?: string | null
          depends_on_task_id?: string | null
          description?: string | null
          id?: string
          milestone_id?: string | null
          name?: string
          owner_employee_id?: string | null
          parent_task_id?: string | null
          planned_end_date?: string | null
          planned_start_date?: string | null
          progress_pct?: number
          project_id?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["task_status"]
          tenant_id?: string
          updated_at?: string
          weight_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "project_tasks_depends_on_task_id_fkey"
            columns: ["depends_on_task_id"]
            isOneToOne: false
            referencedRelation: "project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "project_milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_owner_employee_id_fkey"
            columns: ["owner_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_owner_employee_id_fkey"
            columns: ["owner_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_owner_employee_id_fkey"
            columns: ["owner_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "project_tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          bc_approved_at: string | null
          bc_approved_by: string | null
          bc_executive_summary: string | null
          bc_sponsor_id: string | null
          bc_target_gm_pct: number | null
          client_id: string
          code: string
          contract_id: string | null
          contract_value: number | null
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          end_date: string | null
          id: string
          location: string | null
          name: string
          notes: string | null
          priority: Database["public"]["Enums"]["project_priority"]
          progress: number
          project_number: string | null
          project_type: Database["public"]["Enums"]["project_type"]
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"]
          sync_calendar: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          bc_approved_at?: string | null
          bc_approved_by?: string | null
          bc_executive_summary?: string | null
          bc_sponsor_id?: string | null
          bc_target_gm_pct?: number | null
          client_id: string
          code: string
          contract_id?: string | null
          contract_value?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          end_date?: string | null
          id?: string
          location?: string | null
          name: string
          notes?: string | null
          priority?: Database["public"]["Enums"]["project_priority"]
          progress?: number
          project_number?: string | null
          project_type?: Database["public"]["Enums"]["project_type"]
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          sync_calendar?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          bc_approved_at?: string | null
          bc_approved_by?: string | null
          bc_executive_summary?: string | null
          bc_sponsor_id?: string | null
          bc_target_gm_pct?: number | null
          client_id?: string
          code?: string
          contract_id?: string | null
          contract_value?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          end_date?: string | null
          id?: string
          location?: string | null
          name?: string
          notes?: string | null
          priority?: Database["public"]["Enums"]["project_priority"]
          progress?: number
          project_number?: string | null
          project_type?: Database["public"]["Enums"]["project_type"]
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          sync_calendar?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_bc_approved_by_fkey"
            columns: ["bc_approved_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_bc_approved_by_fkey"
            columns: ["bc_approved_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_bc_approved_by_fkey"
            columns: ["bc_approved_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "projects_bc_sponsor_id_fkey"
            columns: ["bc_sponsor_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_bc_sponsor_id_fkey"
            columns: ["bc_sponsor_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_bc_sponsor_id_fkey"
            columns: ["bc_sponsor_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
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
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
      push_subscriptions: {
        Row: {
          created_at: string
          disabled_at: string | null
          disabled_reason: string | null
          endpoint: string
          id: string
          keys_auth: string
          keys_p256dh: string
          last_used_at: string | null
          tenant_id: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          disabled_at?: string | null
          disabled_reason?: string | null
          endpoint: string
          id?: string
          keys_auth: string
          keys_p256dh: string
          last_used_at?: string | null
          tenant_id: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          disabled_at?: string | null
          disabled_reason?: string | null
          endpoint?: string
          id?: string
          keys_auth?: string
          keys_p256dh?: string
          last_used_at?: string | null
          tenant_id?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_tenant_id_fkey"
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
            foreignKeyName: "security_audit_logs_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
      settlement_sla_reminders: {
        Row: {
          business_days_offset: number
          id: string
          metadata: Json | null
          reminder_kind: string
          resource_id: string
          resource_type: string
          sent_at: string
          sent_to_employee_id: string | null
          tenant_id: string
        }
        Insert: {
          business_days_offset: number
          id?: string
          metadata?: Json | null
          reminder_kind: string
          resource_id: string
          resource_type: string
          sent_at?: string
          sent_to_employee_id?: string | null
          tenant_id: string
        }
        Update: {
          business_days_offset?: number
          id?: string
          metadata?: Json | null
          reminder_kind?: string
          resource_id?: string
          resource_type?: string
          sent_at?: string
          sent_to_employee_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlement_sla_reminders_sent_to_employee_id_fkey"
            columns: ["sent_to_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_sla_reminders_sent_to_employee_id_fkey"
            columns: ["sent_to_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_sla_reminders_sent_to_employee_id_fkey"
            columns: ["sent_to_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "settlement_sla_reminders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_ai_configs: {
        Row: {
          base_url: string | null
          created_at: string
          daily_token_cap: number | null
          encrypted_api_key: string | null
          insight_freshness_min: number
          is_active: boolean
          last_error: string | null
          model_id: string
          pii_redaction_enabled: boolean
          provider: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          base_url?: string | null
          created_at?: string
          daily_token_cap?: number | null
          encrypted_api_key?: string | null
          insight_freshness_min?: number
          is_active?: boolean
          last_error?: string | null
          model_id: string
          pii_redaction_enabled?: boolean
          provider: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          base_url?: string | null
          created_at?: string
          daily_token_cap?: number | null
          encrypted_api_key?: string | null
          insight_freshness_min?: number
          is_active?: boolean
          last_error?: string | null
          model_id?: string
          pii_redaction_enabled?: boolean
          provider?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_ai_configs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_ba_counters: {
        Row: {
          last_seq: number
          tenant_id: string
          updated_at: string
          year: number
        }
        Insert: {
          last_seq?: number
          tenant_id: string
          updated_at?: string
          year: number
        }
        Update: {
          last_seq?: number
          tenant_id?: string
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "tenant_ba_counters_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_capability_overrides: {
        Row: {
          capability_id: string
          granted: boolean
          id: string
          role: Database["public"]["Enums"]["employee_role"]
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          capability_id: string
          granted: boolean
          id?: string
          role: Database["public"]["Enums"]["employee_role"]
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          capability_id?: string
          granted?: boolean
          id?: string
          role?: Database["public"]["Enums"]["employee_role"]
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_capability_overrides_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_capability_overrides_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_capability_overrides_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_capability_overrides_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      tenant_chat_conversations: {
        Row: {
          created_at: string
          employee_id: string
          id: string
          tenant_id: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          id?: string
          tenant_id: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          id?: string
          tenant_id?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_chat_conversations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_chat_conversations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_chat_conversations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "tenant_chat_conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_chat_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          retrieval: Json | null
          role: string
          tenant_id: string
          tool_calls: Json | null
          user_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          retrieval?: Json | null
          role: string
          tenant_id: string
          tool_calls?: Json | null
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          retrieval?: Json | null
          role?: string
          tenant_id?: string
          tool_calls?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "tenant_chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_chat_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_feature_flags: {
        Row: {
          enabled: boolean
          feature_key: string
          id: string
          notes: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          feature_key: string
          id?: string
          notes?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          feature_key?: string
          id?: string
          notes?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_feature_flags_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_signup_requests: {
        Row: {
          admin_email: string
          admin_name: string
          created_at: string
          expires_at: string
          id: string
          ip_address: unknown
          name: string
          slug: string
          token_hash: string
          user_agent: string | null
          verified_at: string | null
          verified_tenant_id: string | null
        }
        Insert: {
          admin_email: string
          admin_name: string
          created_at?: string
          expires_at: string
          id?: string
          ip_address?: unknown
          name: string
          slug: string
          token_hash: string
          user_agent?: string | null
          verified_at?: string | null
          verified_tenant_id?: string | null
        }
        Update: {
          admin_email?: string
          admin_name?: string
          created_at?: string
          expires_at?: string
          id?: string
          ip_address?: unknown
          name?: string
          slug?: string
          token_hash?: string
          user_agent?: string | null
          verified_at?: string | null
          verified_tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_signup_requests_verified_tenant_id_fkey"
            columns: ["verified_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_smtp_configs: {
        Row: {
          created_at: string
          encrypted_password: string | null
          encrypted_username: string | null
          from_address: string
          from_name: string | null
          host: string
          is_active: boolean
          last_error: string | null
          port: number
          provider: string
          reply_to: string | null
          secure: boolean | null
          tenant_id: string
          updated_at: string
          webhook_secret: string | null
        }
        Insert: {
          created_at?: string
          encrypted_password?: string | null
          encrypted_username?: string | null
          from_address: string
          from_name?: string | null
          host: string
          is_active?: boolean
          last_error?: string | null
          port?: number
          provider?: string
          reply_to?: string | null
          secure?: boolean | null
          tenant_id: string
          updated_at?: string
          webhook_secret?: string | null
        }
        Update: {
          created_at?: string
          encrypted_password?: string | null
          encrypted_username?: string | null
          from_address?: string
          from_name?: string | null
          host?: string
          is_active?: boolean
          last_error?: string | null
          port?: number
          provider?: string
          reply_to?: string | null
          secure?: boolean | null
          tenant_id?: string
          updated_at?: string
          webhook_secret?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_smtp_configs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_telegram_bots: {
        Row: {
          bot_username: string
          created_at: string
          encrypted_bot_token: string
          is_active: boolean
          last_error: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          bot_username: string
          created_at?: string
          encrypted_bot_token: string
          is_active?: boolean
          last_error?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          bot_username?: string
          created_at?: string
          encrypted_bot_token?: string
          is_active?: boolean
          last_error?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_telegram_bots_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_whatsapp_configs: {
        Row: {
          created_at: string
          encrypted_account_sid: string | null
          encrypted_api_token: string
          is_active: boolean
          last_error: string | null
          phone_number_id: string
          provider: string
          tenant_id: string
          updated_at: string
          webhook_verify_token: string | null
        }
        Insert: {
          created_at?: string
          encrypted_account_sid?: string | null
          encrypted_api_token: string
          is_active?: boolean
          last_error?: string | null
          phone_number_id: string
          provider: string
          tenant_id: string
          updated_at?: string
          webhook_verify_token?: string | null
        }
        Update: {
          created_at?: string
          encrypted_account_sid?: string | null
          encrypted_api_token?: string
          is_active?: boolean
          last_error?: string | null
          phone_number_id?: string
          provider?: string
          tenant_id?: string
          updated_at?: string
          webhook_verify_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_whatsapp_configs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          absolute_session_minutes: number
          created_at: string
          id: string
          idle_timeout_minutes: number
          idle_warning_minutes: number
          name: string
          plan: string
          provisioned_via: string
          retirement_age: number
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
          timezone: string
          trial_ends_at: string | null
        }
        Insert: {
          absolute_session_minutes?: number
          created_at?: string
          id?: string
          idle_timeout_minutes?: number
          idle_warning_minutes?: number
          name: string
          plan?: string
          provisioned_via?: string
          retirement_age?: number
          slug: string
          status?: Database["public"]["Enums"]["tenant_status"]
          timezone?: string
          trial_ends_at?: string | null
        }
        Update: {
          absolute_session_minutes?: number
          created_at?: string
          id?: string
          idle_timeout_minutes?: number
          idle_warning_minutes?: number
          name?: string
          plan?: string
          provisioned_via?: string
          retirement_age?: number
          slug?: string
          status?: Database["public"]["Enums"]["tenant_status"]
          timezone?: string
          trial_ends_at?: string | null
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
            foreignKeyName: "timesheet_week_approval_logs_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "timesheet_weeks_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "timesheet_weeks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "timesheet_weeks_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "timesheet_weeks_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "timesheets_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "timesheets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
            foreignKeyName: "timesheets_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
      upk_notes: {
        Row: {
          base_salary: number
          computed_upk: number
          contract_end_date: string
          created_at: string
          director_approved_at: string | null
          director_approved_by: string | null
          drafted_by: string | null
          employee_id: string
          evaluation_id: string | null
          finance_approved_at: string | null
          finance_approved_by: string | null
          id: string
          justification: string | null
          multiplier: number
          paid_at: string | null
          paid_by: string | null
          paid_reference: string | null
          service_months: number
          status: Database["public"]["Enums"]["upk_status"]
          submitted_at: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          base_salary?: number
          computed_upk?: number
          contract_end_date: string
          created_at?: string
          director_approved_at?: string | null
          director_approved_by?: string | null
          drafted_by?: string | null
          employee_id: string
          evaluation_id?: string | null
          finance_approved_at?: string | null
          finance_approved_by?: string | null
          id?: string
          justification?: string | null
          multiplier?: number
          paid_at?: string | null
          paid_by?: string | null
          paid_reference?: string | null
          service_months?: number
          status?: Database["public"]["Enums"]["upk_status"]
          submitted_at?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          base_salary?: number
          computed_upk?: number
          contract_end_date?: string
          created_at?: string
          director_approved_at?: string | null
          director_approved_by?: string | null
          drafted_by?: string | null
          employee_id?: string
          evaluation_id?: string | null
          finance_approved_at?: string | null
          finance_approved_by?: string | null
          id?: string
          justification?: string | null
          multiplier?: number
          paid_at?: string | null
          paid_by?: string | null
          paid_reference?: string | null
          service_months?: number
          status?: Database["public"]["Enums"]["upk_status"]
          submitted_at?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "upk_notes_director_approved_by_fkey"
            columns: ["director_approved_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upk_notes_director_approved_by_fkey"
            columns: ["director_approved_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upk_notes_director_approved_by_fkey"
            columns: ["director_approved_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "upk_notes_drafted_by_fkey"
            columns: ["drafted_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upk_notes_drafted_by_fkey"
            columns: ["drafted_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upk_notes_drafted_by_fkey"
            columns: ["drafted_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "upk_notes_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upk_notes_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upk_notes_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "upk_notes_evaluation_id_fkey"
            columns: ["evaluation_id"]
            isOneToOne: false
            referencedRelation: "performance_evaluations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upk_notes_finance_approved_by_fkey"
            columns: ["finance_approved_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upk_notes_finance_approved_by_fkey"
            columns: ["finance_approved_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upk_notes_finance_approved_by_fkey"
            columns: ["finance_approved_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "upk_notes_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upk_notes_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "employees_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upk_notes_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "upk_notes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_notification_preferences: {
        Row: {
          category: Database["public"]["Enums"]["notification_category"]
          channel: Database["public"]["Enums"]["notification_channel"]
          enabled: boolean
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category: Database["public"]["Enums"]["notification_category"]
          channel: Database["public"]["Enums"]["notification_channel"]
          enabled?: boolean
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: Database["public"]["Enums"]["notification_category"]
          channel?: Database["public"]["Enums"]["notification_channel"]
          enabled?: boolean
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_notification_preferences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_telegram_links: {
        Row: {
          display_name: string | null
          encrypted_chat_id: string
          last_error: string | null
          last_used_at: string | null
          linked_at: string
          telegram_username: string | null
          tenant_id: string
          user_id: string
        }
        Insert: {
          display_name?: string | null
          encrypted_chat_id: string
          last_error?: string | null
          last_used_at?: string | null
          linked_at?: string
          telegram_username?: string | null
          tenant_id: string
          user_id: string
        }
        Update: {
          display_name?: string | null
          encrypted_chat_id?: string
          last_error?: string | null
          last_used_at?: string | null
          linked_at?: string
          telegram_username?: string | null
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_telegram_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_whatsapp_links: {
        Row: {
          display_name: string | null
          encrypted_wa_id: string
          last_error: string | null
          last_inbound_at: string | null
          last_used_at: string | null
          linked_at: string
          opted_in_at: string
          profile_name: string | null
          tenant_id: string
          user_id: string
        }
        Insert: {
          display_name?: string | null
          encrypted_wa_id: string
          last_error?: string | null
          last_inbound_at?: string | null
          last_used_at?: string | null
          linked_at?: string
          opted_in_at?: string
          profile_name?: string | null
          tenant_id: string
          user_id: string
        }
        Update: {
          display_name?: string | null
          encrypted_wa_id?: string
          last_error?: string | null
          last_inbound_at?: string | null
          last_used_at?: string | null
          linked_at?: string
          opted_in_at?: string
          profile_name?: string | null
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_whatsapp_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
          project_id: string | null
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
          project_id?: string | null
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
          project_id?: string | null
          shift_allowance?: number
          start_time?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_shifts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
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
            foreignKeyName: "employees_reports_to_employee_id_fkey"
            columns: ["reports_to_employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_workload"
            referencedColumns: ["employee_id"]
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
      v_employee_workload: {
        Row: {
          active_assignments: number | null
          employee_id: string | null
          employee_role: Database["public"]["Enums"]["employee_role"] | null
          full_name: string | null
          remaining_pct: number | null
          tenant_id: string | null
          total_alloc_pct: number | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_project_budget_lines: {
        Row: {
          budget_detail_id: string | null
          budget_id: string | null
          budget_status: Database["public"]["Enums"]["budget_status"] | null
          category: string | null
          code: string | null
          created_at: string | null
          description: string | null
          fiscal_year: number | null
          outstanding_amount: number | null
          planned_amount: number | null
          project_id: string | null
          realized_amount: number | null
          remaining_amount: number | null
          seq: number | null
          tenant_id: string | null
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
            foreignKeyName: "budget_details_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      add_business_days: {
        Args: { p_n: number; p_start: string; p_tz?: string }
        Returns: string
      }
      admin_list_users: {
        Args: never
        Returns: {
          auth_created_at: string
          banned_until: string
          email: string
          email_confirmed_at: string
          employee_id: string
          employee_is_active: boolean
          employee_name: string
          employee_role: Database["public"]["Enums"]["employee_role"]
          last_sign_in_at: string
          tenant_id: string
          user_id: string
        }[]
      }
      anonymize_terminated_employee: {
        Args: { p_employee_id: string }
        Returns: undefined
      }
      can_admin_target_user: { Args: { p_target: string }; Returns: boolean }
      canonical_employee_role: { Args: never; Returns: string }
      complete_tenant_signup: {
        Args: { p_admin_user_id: string; p_raw_token: string }
        Returns: {
          admin_email: string
          admin_name: string
          employee_id: string
          name: string
          slug: string
          tenant_id: string
        }[]
      }
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
      has_active_field_tech_assignment: {
        Args: { p_emp_id: string }
        Returns: boolean
      }
      is_assigned_to_project: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      is_current_user_platform_admin: { Args: never; Returns: boolean }
      is_hr_or_management: { Args: never; Returns: boolean }
      is_payroll_operator: { Args: never; Returns: boolean }
      next_ba_number: {
        Args: { v_tenant_id: string; v_year: number }
        Returns: string
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
      provision_tenant: {
        Args: {
          p_admin_email: string
          p_admin_name: string
          p_admin_user_id: string
          p_name: string
          p_slug: string
          p_source?: string
        }
        Returns: {
          employee_id: string
          tenant_id: string
        }[]
      }
      purge_archived_audit_logs: {
        Args: {
          p_batch_end: string
          p_batch_start: string
          p_tenant_id: string
        }
        Returns: number
      }
      purge_expired_signup_requests: { Args: never; Returns: number }
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
      record_platform_admin_audit: {
        Args: {
          p_action_type: Database["public"]["Enums"]["audit_action_type"]
          p_ip_address?: unknown
          p_metadata?: Json
          p_new_values?: Json
          p_old_values?: Json
          p_resource_id?: string
          p_resource_name: string
          p_target_tenant?: string
          p_user_agent?: string
        }
        Returns: number
      }
      resolve_field_ops_l2_approver: {
        Args: { p_project_id: string }
        Returns: string
      }
      resolve_tenant_id_by_slug: { Args: { p_slug: string }; Returns: string }
      resolve_tenant_plan_by_slug: {
        Args: { p_slug: string }
        Returns: {
          plan: string
          status: string
          trial_ends_at: string
        }[]
      }
      resolve_tenant_status_by_slug: {
        Args: { p_slug: string }
        Returns: string
      }
      revoke_user_sessions: { Args: { p_user_id: string }; Returns: number }
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
      seed_default_coa: { Args: { p_tenant: string }; Returns: undefined }
      seed_default_eval_templates: {
        Args: { p_tenant: string }
        Returns: undefined
      }
      seed_default_master_data: {
        Args: { p_tenant: string }
        Returns: undefined
      }
      set_user_ban: {
        Args: { p_banned_until: string; p_user_id: string }
        Returns: undefined
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
        | "BULK_IMPORT"
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
      calendar_event_kind:
        | "PROJECT_CREATED"
        | "PROJECT_UPDATED"
        | "PROJECT_DELETED"
        | "MILESTONE_CREATED"
        | "MILESTONE_UPDATED"
        | "MILESTONE_DELETED"
      calendar_event_status: "PENDING" | "SENT" | "FAILED" | "SKIPPED"
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
      coa_account_type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE"
      coa_normal_side: "DEBIT" | "CREDIT"
      contract_recommendation:
        | "EXTEND"
        | "NOT_EXTEND"
        | "EXTEND_WITH_COACHING"
        | "EXTEND_PERMANENT"
        | "EXTEND_PKWT_3M"
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
      employee_availability: "AVAILABLE" | "ASSIGNED" | "ON_LEAVE" | "INACTIVE"
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
      employment_type:
        | "PERMANENT"
        | "CONTRACT"
        | "PROBATION"
        | "INTERN"
        | "OUTSOURCE"
        | "OUTTASK"
      evaluation_question_type: "SCORE_1_5" | "TEXT"
      evaluation_status:
        | "DRAFT"
        | "SUBMITTED_BY_SPV"
        | "REVIEWED_BY_PM"
        | "RETURNED_TO_SPV"
        | "APPROVED_BY_OM"
        | "REJECTED_BY_OM"
        | "FINALIZED"
      expense_payment_method:
        | "BANK_TRANSFER"
        | "CASH"
        | "REIMBURSEMENT"
        | "CORPORATE_CARD"
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
      import_job_resource:
        | "EMPLOYEE"
        | "CLIENT"
        | "PROJECT"
        | "BUDGET_LINE"
        | "EXPENSE"
        | "PETTY_CASH"
      import_job_status: "DRY_RUN" | "COMMITTED" | "FAILED"
      knowledge_article_status: "DRAFT" | "PUBLISHED" | "ARCHIVED"
      knowledge_article_visibility:
        | "TENANT_WIDE"
        | "ROLE_GATED"
        | "PROJECT_SCOPED"
      milestone_status:
        | "PLANNED"
        | "IN_PROGRESS"
        | "AT_RISK"
        | "DONE"
        | "CANCELLED"
      monthly_report_section_kind:
        | "EXECUTIVE_SUMMARY"
        | "MILESTONE_PROGRESS"
        | "HOURS_LOGGED"
        | "COSTS_INCURRED"
        | "BLOCKERS"
        | "NEXT_MONTH_PLAN"
      monthly_report_status:
        | "DRAFT_BY_SPV"
        | "SUBMITTED_TO_PM"
        | "APPROVED_BY_PM"
        | "RETURNED_TO_SPV"
        | "REJECTED_BY_PM"
        | "SENT_TO_CLIENT"
        | "APPROVED_BY_CLIENT"
        | "BA_GENERATED"
        | "HANDED_OFF_TO_COLLECTION"
        | "CANCELLED"
      notification_category:
        | "APPROVALS"
        | "BUDGETS"
        | "MILESTONES"
        | "ASSIGNMENTS"
        | "TIMESHEETS"
        | "EMPLOYEES"
        | "SYSTEM"
      notification_channel:
        | "IN_APP"
        | "EMAIL"
        | "TELEGRAM"
        | "WHATSAPP"
        | "PUSH"
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
        | "EMPLOYEE_CONTRACT_EXPIRING"
        | "PROJECT_CONTRACT_EXPIRING"
        | "SETTLEMENT_DUE_SOON"
        | "SETTLEMENT_OVERDUE"
        | "EXPENSE_DRAFT_STALE"
        | "EXPENSE_INCURRED_STALE"
        | "EVALUATION_DUE"
        | "EVALUATION_SUBMITTED"
        | "EVALUATION_REVIEWED"
        | "EVALUATION_RETURNED"
        | "EVALUATION_APPROVED"
        | "EVALUATION_REJECTED"
        | "EVALUATION_FINALIZED"
        | "UPK_DRAFT_CREATED"
        | "UPK_SUBMITTED"
        | "UPK_APPROVED"
        | "UPK_REJECTED"
        | "UPK_PAID"
        | "PAYROLL_STOP_REQUEST"
        | "MONTHLY_REPORT_SUBMITTED"
        | "MONTHLY_REPORT_APPROVED"
        | "MONTHLY_REPORT_RETURNED"
        | "MONTHLY_REPORT_REJECTED"
        | "MONTHLY_REPORT_SENT_TO_CLIENT"
        | "MONTHLY_REPORT_APPROVED_BY_CLIENT"
        | "MONTHLY_REPORT_REJECTED_BY_CLIENT"
        | "MONTHLY_REPORT_BA_GENERATED"
        | "TIMESHEET_SUBMITTED"
        | "TIMESHEET_APPROVED"
        | "TIMESHEET_REJECTED"
        | "BULK_IMPORT_COMPLETED"
        | "APPROVAL_IDLE_24H"
        | "EVALUATION_PROJECT_REVIEW_REQUESTED"
        | "EVALUATION_PROJECT_REVIEWED"
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
      project_issue_category:
        | "BUG"
        | "FEATURE"
        | "TASK"
        | "INCIDENT"
        | "RISK"
        | "IMPROVEMENT"
        | "QUESTION"
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
      project_member_role:
        | "MEMBER"
        | "TECH_LEAD"
        | "DEVELOPER"
        | "ENGINEER"
        | "QA"
        | "DESIGNER"
        | "DEVOPS"
        | "CONSULTANT"
        | "SUPPORT"
        | "SITE_SUPERVISOR"
        | "FIELD_TECHNICIAN"
      project_priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
      project_status:
        | "DRAFT"
        | "PLANNING"
        | "ACTIVE"
        | "ON_HOLD"
        | "COMPLETED"
        | "ARCHIVED"
      project_type: "FIXED_PRICE" | "TIME_MATERIAL" | "RETAINER" | "INTERNAL"
      secret_priority: "P0" | "P1" | "P2"
      task_status:
        | "TODO"
        | "IN_PROGRESS"
        | "BLOCKED"
        | "REVIEW"
        | "DONE"
        | "CANCELLED"
      tenant_status: "active" | "suspended" | "terminated"
      timesheet_status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED"
      upk_status:
        | "DRAFT"
        | "PENDING_FINANCE"
        | "PENDING_DIRECTOR"
        | "APPROVED"
        | "REJECTED_BY_FINANCE"
        | "REJECTED_BY_DIRECTOR"
        | "PAID"
        | "CANCELLED"
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
        "BULK_IMPORT",
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
      calendar_event_kind: [
        "PROJECT_CREATED",
        "PROJECT_UPDATED",
        "PROJECT_DELETED",
        "MILESTONE_CREATED",
        "MILESTONE_UPDATED",
        "MILESTONE_DELETED",
      ],
      calendar_event_status: ["PENDING", "SENT", "FAILED", "SKIPPED"],
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
      coa_account_type: ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"],
      coa_normal_side: ["DEBIT", "CREDIT"],
      contract_recommendation: [
        "EXTEND",
        "NOT_EXTEND",
        "EXTEND_WITH_COACHING",
        "EXTEND_PERMANENT",
        "EXTEND_PKWT_3M",
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
      employee_availability: ["AVAILABLE", "ASSIGNED", "ON_LEAVE", "INACTIVE"],
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
      employment_type: [
        "PERMANENT",
        "CONTRACT",
        "PROBATION",
        "INTERN",
        "OUTSOURCE",
        "OUTTASK",
      ],
      evaluation_question_type: ["SCORE_1_5", "TEXT"],
      evaluation_status: [
        "DRAFT",
        "SUBMITTED_BY_SPV",
        "REVIEWED_BY_PM",
        "RETURNED_TO_SPV",
        "APPROVED_BY_OM",
        "REJECTED_BY_OM",
        "FINALIZED",
      ],
      expense_payment_method: [
        "BANK_TRANSFER",
        "CASH",
        "REIMBURSEMENT",
        "CORPORATE_CARD",
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
      import_job_resource: [
        "EMPLOYEE",
        "CLIENT",
        "PROJECT",
        "BUDGET_LINE",
        "EXPENSE",
        "PETTY_CASH",
      ],
      import_job_status: ["DRY_RUN", "COMMITTED", "FAILED"],
      knowledge_article_status: ["DRAFT", "PUBLISHED", "ARCHIVED"],
      knowledge_article_visibility: [
        "TENANT_WIDE",
        "ROLE_GATED",
        "PROJECT_SCOPED",
      ],
      milestone_status: [
        "PLANNED",
        "IN_PROGRESS",
        "AT_RISK",
        "DONE",
        "CANCELLED",
      ],
      monthly_report_section_kind: [
        "EXECUTIVE_SUMMARY",
        "MILESTONE_PROGRESS",
        "HOURS_LOGGED",
        "COSTS_INCURRED",
        "BLOCKERS",
        "NEXT_MONTH_PLAN",
      ],
      monthly_report_status: [
        "DRAFT_BY_SPV",
        "SUBMITTED_TO_PM",
        "APPROVED_BY_PM",
        "RETURNED_TO_SPV",
        "REJECTED_BY_PM",
        "SENT_TO_CLIENT",
        "APPROVED_BY_CLIENT",
        "BA_GENERATED",
        "HANDED_OFF_TO_COLLECTION",
        "CANCELLED",
      ],
      notification_category: [
        "APPROVALS",
        "BUDGETS",
        "MILESTONES",
        "ASSIGNMENTS",
        "TIMESHEETS",
        "EMPLOYEES",
        "SYSTEM",
      ],
      notification_channel: ["IN_APP", "EMAIL", "TELEGRAM", "WHATSAPP", "PUSH"],
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
        "EMPLOYEE_CONTRACT_EXPIRING",
        "PROJECT_CONTRACT_EXPIRING",
        "SETTLEMENT_DUE_SOON",
        "SETTLEMENT_OVERDUE",
        "EXPENSE_DRAFT_STALE",
        "EXPENSE_INCURRED_STALE",
        "EVALUATION_DUE",
        "EVALUATION_SUBMITTED",
        "EVALUATION_REVIEWED",
        "EVALUATION_RETURNED",
        "EVALUATION_APPROVED",
        "EVALUATION_REJECTED",
        "EVALUATION_FINALIZED",
        "UPK_DRAFT_CREATED",
        "UPK_SUBMITTED",
        "UPK_APPROVED",
        "UPK_REJECTED",
        "UPK_PAID",
        "PAYROLL_STOP_REQUEST",
        "MONTHLY_REPORT_SUBMITTED",
        "MONTHLY_REPORT_APPROVED",
        "MONTHLY_REPORT_RETURNED",
        "MONTHLY_REPORT_REJECTED",
        "MONTHLY_REPORT_SENT_TO_CLIENT",
        "MONTHLY_REPORT_APPROVED_BY_CLIENT",
        "MONTHLY_REPORT_REJECTED_BY_CLIENT",
        "MONTHLY_REPORT_BA_GENERATED",
        "TIMESHEET_SUBMITTED",
        "TIMESHEET_APPROVED",
        "TIMESHEET_REJECTED",
        "BULK_IMPORT_COMPLETED",
        "APPROVAL_IDLE_24H",
        "EVALUATION_PROJECT_REVIEW_REQUESTED",
        "EVALUATION_PROJECT_REVIEWED",
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
      project_issue_category: [
        "BUG",
        "FEATURE",
        "TASK",
        "INCIDENT",
        "RISK",
        "IMPROVEMENT",
        "QUESTION",
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
      project_member_role: [
        "MEMBER",
        "TECH_LEAD",
        "DEVELOPER",
        "ENGINEER",
        "QA",
        "DESIGNER",
        "DEVOPS",
        "CONSULTANT",
        "SUPPORT",
        "SITE_SUPERVISOR",
        "FIELD_TECHNICIAN",
      ],
      project_priority: ["CRITICAL", "HIGH", "MEDIUM", "LOW"],
      project_status: [
        "DRAFT",
        "PLANNING",
        "ACTIVE",
        "ON_HOLD",
        "COMPLETED",
        "ARCHIVED",
      ],
      project_type: ["FIXED_PRICE", "TIME_MATERIAL", "RETAINER", "INTERNAL"],
      secret_priority: ["P0", "P1", "P2"],
      task_status: [
        "TODO",
        "IN_PROGRESS",
        "BLOCKED",
        "REVIEW",
        "DONE",
        "CANCELLED",
      ],
      tenant_status: ["active", "suspended", "terminated"],
      timesheet_status: ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"],
      upk_status: [
        "DRAFT",
        "PENDING_FINANCE",
        "PENDING_DIRECTOR",
        "APPROVED",
        "REJECTED_BY_FINANCE",
        "REJECTED_BY_DIRECTOR",
        "PAID",
        "CANCELLED",
      ],
    },
  },
} as const
