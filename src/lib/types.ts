import type { LeadSource, LeadStatus, PropertyType, TaskPriority } from "./domain";

export type Role = "admin" | "agent";

export interface Agent {
  id: string;
  user_id: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  title: string;
  color: string;
  is_active: boolean;
  is_demo: boolean;
}

export interface Lead {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  source: LeadSource;
  property_type: PropertyType | null;
  property_interest: string | null;
  preferred_area: string | null;
  budget: number | null;
  status: LeadStatus;
  lost_reason: string | null;
  assigned_agent_id: string | null;
  next_follow_up_at: string | null;
  position: number;
  revision: number;
  status_changed_at: string;
  won_at: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export interface LeadNote {
  id: string;
  lead_id: string;
  author_id: string | null;
  author_label: string | null;
  body: string;
  created_at: string;
}

export interface Activity {
  id: string;
  lead_id: string;
  actor_label: string | null;
  type: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface Task {
  id: string;
  lead_id: string | null;
  title: string;
  description: string | null;
  assigned_agent_id: string | null;
  priority: TaskPriority;
  due_at: string;
  completed_at: string | null;
  is_demo: boolean;
  created_at: string;
  source?: "manual" | "automation";
  automation_key?: string | null;
  lead?: { id: string; full_name: string } | null;
}

export interface DuplicateMatch {
  id: string;
  full_name: string;
  status: LeadStatus;
  owner_name: string | null;
  match_on: "email" | "phone" | "email+phone";
  can_open: boolean;
}

export interface DashboardMetrics {
  total_leads: number;
  new_leads: number;
  new_leads_previous: number;
  awaiting_first_contact: number;
  active_opportunities: number;
  active_pipeline_value: number;
  won: number;
  won_value: number;
  lost: number;
  won_previous: number;
  pending_tasks: number;
  overdue_tasks: number;
  follow_ups_due: number;
  pipeline: { status: LeadStatus; count: number; value: number }[];
  series: { date: string; created: number; won: number }[];
  by_source: { source: LeadSource; count: number }[];
  agents: { agent_id: string; full_name: string; color: string; open: number; won: number; closed: number }[];
}

export interface EventRow {
  id: string;
  type: string;
  aggregate_type: string;
  aggregate_id: string;
  idempotency_key: string;
  status: "pending" | "processing" | "delivered" | "failed" | "dead" | "skipped";
  attempts: number;
  last_error: string | null;
  is_demo: boolean;
  created_at: string;
  delivered_at: string | null;
  payload: Record<string, unknown>;
}

/** Shape returned by every server action so forms can show inline errors. */
export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T }
  | {
      ok: false;
      message: string;
      fieldErrors?: Record<string, string[] | undefined>;
      duplicates?: DuplicateMatch[];
    };

export interface Automation {
  key: string;
  name: string;
  description: string;
  trigger_event: string;
  webhook_path: string;
  enabled: boolean;
  settings: { follow_up_hours?: number } & Record<string, unknown>;
}

export interface AutomationRun {
  id: string;
  automation_key: string;
  event_id: string | null;
  lead_id: string | null;
  status: "queued" | "running" | "succeeded" | "failed" | "skipped";
  attempts: number;
  external_execution_id: string | null;
  result: Record<string, unknown>;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  updated_at: string;
}

export interface AutomationStats {
  automation: Automation;
  succeeded: number;
  failed: number;
  pending: number;
  lastRun: AutomationRun | null;
}

export interface AiAnalysisRow {
  id: string;
  lead_id: string;
  status: "requested" | "succeeded" | "failed" | "invalid_output";
  interest_level: "High" | "Medium" | "Low" | null;
  summary: string | null;
  reasons: string[] | null;
  next_action: string | null;
  email_subject: string | null;
  email_body: string | null;
  model: string | null;
  external_execution_id: string | null;
  error: string | null;
  approved_at: string | null;
  approved_subject: string | null;
  approved_body: string | null;
  created_at: string;
  completed_at: string | null;
}
