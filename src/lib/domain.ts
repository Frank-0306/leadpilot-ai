/**
 * Domain vocabulary shared by the UI, validation and tests.
 * Values mirror the Postgres enums in supabase/migrations.
 */

export const LEAD_STATUSES = [
  "new_lead",
  "contacted",
  "qualified",
  "viewing_scheduled",
  "negotiation",
  "won",
  "lost",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const STATUS_META: Record<LeadStatus, { label: string; short: string; tone: string }> = {
  new_lead: { label: "New Lead", short: "New", tone: "var(--stage-new)" },
  contacted: { label: "Contacted", short: "Contacted", tone: "var(--stage-contacted)" },
  qualified: { label: "Qualified", short: "Qualified", tone: "var(--stage-qualified)" },
  viewing_scheduled: { label: "Viewing Scheduled", short: "Viewing", tone: "var(--stage-viewing)" },
  negotiation: { label: "Negotiation", short: "Negotiation", tone: "var(--stage-negotiation)" },
  won: { label: "Won", short: "Won", tone: "var(--stage-won)" },
  lost: { label: "Lost", short: "Lost", tone: "var(--stage-lost)" },
};

/** Stages that form the forward path of a deal (Won/Lost are outcomes). */
export const OPEN_STATUSES: LeadStatus[] = ["new_lead", "contacted", "qualified", "viewing_scheduled", "negotiation"];
export const ACTIVE_OPPORTUNITY_STATUSES: LeadStatus[] = ["qualified", "viewing_scheduled", "negotiation"];

export const LEAD_SOURCES = [
  "website",
  "referral",
  "zillow",
  "realtor_com",
  "open_house",
  "social_media",
  "walk_in",
  "phone",
  "other",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const SOURCE_LABELS: Record<LeadSource, string> = {
  website: "Website",
  referral: "Referral",
  zillow: "Zillow",
  realtor_com: "Realtor.com",
  open_house: "Open house",
  social_media: "Social media",
  walk_in: "Walk-in",
  phone: "Phone call",
  other: "Other",
};

export const PROPERTY_TYPES = [
  "single_family",
  "condo",
  "townhouse",
  "multi_family",
  "land",
  "luxury",
  "rental",
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const PROPERTY_LABELS: Record<PropertyType, string> = {
  single_family: "Single-family home",
  condo: "Condo",
  townhouse: "Townhouse",
  multi_family: "Multi-family",
  land: "Land / lot",
  luxury: "Luxury home",
  rental: "Rental",
};

export const TASK_PRIORITIES = ["low", "normal", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const ACTIVITY_LABELS: Record<string, string> = {
  lead_created: "Lead created",
  lead_updated: "Details updated",
  status_changed: "Stage changed",
  assigned: "Assigned",
  unassigned: "Unassigned",
  note_added: "Note added",
  task_created: "Task created",
  task_completed: "Task completed",
  task_reopened: "Task reopened",
  follow_up_scheduled: "Follow-up scheduled",
  repeat_inquiry: "Repeat inquiry",
  ai_analysis_generated: "AI analysis generated",
  ai_draft_approved: "AI email draft approved",
};

/** Internal events (see supabase/migrations/…_events_and_triggers.sql). */
export const EVENT_TYPES = [
  "lead.created",
  "lead.assigned",
  "lead.status_changed",
  "task.created",
  "task.overdue",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && (LEAD_STATUSES as readonly string[]).includes(value);
}
