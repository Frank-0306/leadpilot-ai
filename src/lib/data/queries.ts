import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { APP_TIME_ZONE, fromDateTimeLocal, toDateTimeLocal } from "@/lib/format";
import { sanitizeSearch, type LeadFilters } from "@/lib/validation";
import type { Activity, Agent, AiAnalysisRow, Automation, AutomationRun, AutomationStats, DashboardMetrics, EventRow, Lead, LeadNote, Task } from "@/lib/types";

/**
 * Read-side queries. All of them run with the signed-in user's session, so
 * Postgres RLS decides which rows come back — an agent simply never receives
 * another agent's leads, whatever the UI asks for.
 */

export const LEADS_PAGE_SIZE = 25;

export async function listAgents(): Promise<Agent[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("agents").select("*").order("full_name");
  if (error) throw new Error(`Could not load agents: ${error.message}`);
  return (data ?? []) as Agent[];
}

export async function listLeads(filters: LeadFilters): Promise<{ rows: Lead[]; count: number; page: number }> {
  const supabase = await createSupabaseServerClient();
  const page = filters.page ?? 1;
  const from = (page - 1) * LEADS_PAGE_SIZE;

  let query = supabase.from("leads").select("*", { count: "exact" });

  if (filters.q) {
    const q = sanitizeSearch(filters.q);
    if (q) {
      const digits = q.replace(/\D/g, "");
      const ors = [`full_name.ilike.*${q}*`, `email.ilike.*${q}*`, `property_interest.ilike.*${q}*`, `preferred_area.ilike.*${q}*`];
      if (digits.length >= 3) ors.push(`phone_digits.like.*${digits}*`);
      query = query.or(ors.join(","));
    }
  }
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.source) query = query.eq("source", filters.source);
  if (filters.agent === "unassigned") query = query.is("assigned_agent_id", null);
  else if (filters.agent) query = query.eq("assigned_agent_id", filters.agent);

  switch (filters.sort) {
    case "oldest":
      query = query.order("created_at", { ascending: true });
      break;
    case "follow_up":
      query = query.order("next_follow_up_at", { ascending: true, nullsFirst: false });
      break;
    case "budget":
      query = query.order("budget", { ascending: false, nullsFirst: false });
      break;
    default:
      query = query.order("created_at", { ascending: false });
  }

  const { data, error, count } = await query.range(from, from + LEADS_PAGE_SIZE - 1);
  if (error) throw new Error(`Could not load leads: ${error.message}`);
  return { rows: (data ?? []) as Lead[], count: count ?? 0, page };
}

export async function getLeadDetail(id: string): Promise<{
  lead: Lead;
  notes: LeadNote[];
  activities: Activity[];
  tasks: Task[];
} | null> {
  const supabase = await createSupabaseServerClient();
  const { data: lead, error } = await supabase.from("leads").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load lead: ${error.message}`);
  if (!lead) return null;

  const [notes, activities, tasks] = await Promise.all([
    supabase.from("lead_notes").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
    supabase.from("activities").select("*").eq("lead_id", id).order("created_at", { ascending: false }).limit(100),
    supabase.from("tasks").select("*").eq("lead_id", id).order("completed_at", { ascending: true, nullsFirst: true }).order("due_at"),
  ]);

  return {
    lead: lead as Lead,
    notes: (notes.data ?? []) as LeadNote[],
    activities: (activities.data ?? []) as Activity[],
    tasks: (tasks.data ?? []) as Task[],
  };
}

export async function listPipelineLeads(agent?: string): Promise<Lead[]> {
  const supabase = await createSupabaseServerClient();
  // Closed deals older than 90 days drop off the board to keep it focused.
  const closedCutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
  let query = supabase
    .from("leads")
    .select("*")
    .or(`status.not.in.(won,lost),status_changed_at.gte.${closedCutoff}`)
    .order("position", { ascending: true })
    .limit(500);
  if (agent === "unassigned") query = query.is("assigned_agent_id", null);
  else if (agent) query = query.eq("assigned_agent_id", agent);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load the pipeline: ${error.message}`);
  return (data ?? []) as Lead[];
}

export type TaskView = "open" | "overdue" | "today" | "upcoming" | "completed";

export async function listTasks(view: TaskView, agent?: string): Promise<Task[]> {
  const supabase = await createSupabaseServerClient();
  const now = new Date();
  // "Today" ends at midnight in the brokerage's time zone, not UTC.
  const endOfToday = new Date(fromDateTimeLocal(`${toDateTimeLocal(now.toISOString()).slice(0, 10)}T23:59`)!);

  let query = supabase.from("tasks").select("*, lead:leads(id, full_name)");

  switch (view) {
    case "overdue":
      query = query.is("completed_at", null).lt("due_at", now.toISOString()).order("due_at");
      break;
    case "today":
      query = query.is("completed_at", null).gte("due_at", now.toISOString()).lte("due_at", endOfToday.toISOString()).order("due_at");
      break;
    case "upcoming":
      query = query.is("completed_at", null).gt("due_at", endOfToday.toISOString()).order("due_at");
      break;
    case "completed":
      query = query.not("completed_at", "is", null).order("completed_at", { ascending: false }).limit(100);
      break;
    default:
      query = query.is("completed_at", null).order("due_at");
  }
  if (agent === "unassigned") query = query.is("assigned_agent_id", null);
  else if (agent) query = query.eq("assigned_agent_id", agent);

  const { data, error } = await query.limit(300);
  if (error) throw new Error(`Could not load tasks: ${error.message}`);
  return (data ?? []) as Task[];
}

export async function taskCounts(agent?: string): Promise<{ open: number; overdue: number }> {
  const supabase = await createSupabaseServerClient();
  const now = new Date().toISOString();
  let open = supabase.from("tasks").select("id", { count: "exact", head: true }).is("completed_at", null);
  let overdue = supabase.from("tasks").select("id", { count: "exact", head: true }).is("completed_at", null).lt("due_at", now);
  if (agent && agent !== "unassigned") {
    open = open.eq("assigned_agent_id", agent);
    overdue = overdue.eq("assigned_agent_id", agent);
  }
  const [o, d] = await Promise.all([open, overdue]);
  return { open: o.count ?? 0, overdue: d.count ?? 0 };
}

export async function getDashboardMetrics(fromIso: string, toIso: string, agent?: string): Promise<DashboardMetrics> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("dashboard_metrics", {
    p_from: fromIso,
    p_to: toIso,
    p_agent: agent ?? null,
    p_time_zone: APP_TIME_ZONE,
  });
  if (error) throw new Error(`Could not compute metrics: ${error.message}`);
  return data as DashboardMetrics;
}

export async function listRecentActivity(limit = 8): Promise<(Activity & { lead: { id: string; full_name: string } | null })[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("activities")
    .select("*, lead:leads(id, full_name)")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as (Activity & { lead: { id: string; full_name: string } | null })[];
}

export async function listAutomationStats(): Promise<AutomationStats[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("automations").select("*").order("sort_order");
  if (error) throw new Error(`Could not load automations: ${error.message}`);
  const automations = (data ?? []) as Automation[];

  return Promise.all(
    automations.map(async (automation) => {
      const count = (status: string[]) =>
        supabase
          .from("automation_runs")
          .select("id", { count: "exact", head: true })
          .eq("automation_key", automation.key)
          .in("status", status);
      // Failed = every failed delivery attempt, so a failure stays visible in
      // the totals even after a retry succeeds.
      const failedAttempts = supabase
        .from("event_deliveries")
        .select("id, events!inner(type)", { count: "exact", head: true })
        .eq("success", false)
        .eq("events.type", automation.trigger_event);
      const isManual = automation.trigger_event.startsWith("manual.");
      const [ok, failed, pending, last] = await Promise.all([
        count(["succeeded"]),
        isManual ? count(["failed"]) : failedAttempts,
        count(["queued", "running"]),
        supabase.from("automation_runs").select("*").eq("automation_key", automation.key).order("updated_at", { ascending: false }).limit(1),
      ]);
      return {
        automation,
        succeeded: ok.count ?? 0,
        failed: failed.count ?? 0,
        pending: pending.count ?? 0,
        lastRun: ((last.data ?? [])[0] as AutomationRun | undefined) ?? null,
      };
    }),
  );
}

/** Latest successful analysis plus the most recent attempt (which may have failed). */
export async function getAiInsights(leadId: string): Promise<{ latest: AiAnalysisRow | null; lastAttempt: AiAnalysisRow | null; enabled: boolean }> {
  const supabase = await createSupabaseServerClient();
  const [ok, last, automation] = await Promise.all([
    supabase.from("ai_analyses").select("*").eq("lead_id", leadId).eq("status", "succeeded").order("created_at", { ascending: false }).limit(1),
    supabase.from("ai_analyses").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(1),
    supabase.from("automations").select("enabled").eq("key", "ai_lead_analysis").maybeSingle(),
  ]);
  return {
    latest: ((ok.data ?? [])[0] as AiAnalysisRow | undefined) ?? null,
    lastAttempt: ((last.data ?? [])[0] as AiAnalysisRow | undefined) ?? null,
    enabled: !!automation.data?.enabled,
  };
}

export async function lastDeliveryAttempt(): Promise<{ success: boolean; error: string | null; created_at: string } | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("event_deliveries")
    .select("success, error, created_at")
    .order("created_at", { ascending: false })
    .limit(1);
  return ((data ?? [])[0] as { success: boolean; error: string | null; created_at: string } | undefined) ?? null;
}

export async function listLeadAutomationRuns(leadId: string): Promise<AutomationRun[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("automation_runs")
    .select("*")
    .eq("lead_id", leadId)
    .order("started_at", { ascending: false })
    .limit(10);
  return (data ?? []) as AutomationRun[];
}

export async function listRunsByEvent(eventIds: string[]): Promise<Map<string, AutomationRun>> {
  if (eventIds.length === 0) return new Map();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("automation_runs").select("*").in("event_id", eventIds);
  return new Map(((data ?? []) as AutomationRun[]).map((r) => [r.event_id!, r]));
}

export async function listEventDeliveries(eventIds: string[]): Promise<Map<string, { attempt: number; success: boolean; response_status: number | null; error: string | null; duration_ms: number | null; created_at: string }[]>> {
  if (eventIds.length === 0) return new Map();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("event_deliveries")
    .select("event_id, attempt, success, response_status, error, duration_ms, created_at")
    .in("event_id", eventIds)
    .order("created_at", { ascending: false });
  const map = new Map<string, { attempt: number; success: boolean; response_status: number | null; error: string | null; duration_ms: number | null; created_at: string }[]>();
  for (const d of (data ?? []) as ({ event_id: string } & { attempt: number; success: boolean; response_status: number | null; error: string | null; duration_ms: number | null; created_at: string })[]) {
    const list = map.get(d.event_id) ?? [];
    list.push(d);
    map.set(d.event_id, list);
  }
  return map;
}

export async function listEvents(status?: string): Promise<{ rows: EventRow[]; counts: Record<string, number> }> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("events").select("*").order("created_at", { ascending: false }).limit(100);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load events: ${error.message}`);

  const statuses = ["pending", "processing", "delivered", "failed", "dead", "skipped"] as const;
  const counts: Record<string, number> = {};
  await Promise.all(
    statuses.map(async (s) => {
      const { count } = await supabase.from("events").select("id", { count: "exact", head: true }).eq("status", s);
      counts[s] = count ?? 0;
    }),
  );
  return { rows: (data ?? []) as EventRow[], counts };
}
