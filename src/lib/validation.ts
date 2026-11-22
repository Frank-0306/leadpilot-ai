import { z } from "zod";
import { fromDateTimeLocal } from "./format";
import { LEAD_SOURCES, LEAD_STATUSES, PROPERTY_TYPES, TASK_PRIORITIES } from "./domain";

/**
 * Zod schemas shared by server actions (authoritative) and tests.
 * Every server action re-validates input; the browser is never trusted.
 */

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const phone = z
  .string()
  .trim()
  .max(40)
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || v.replace(/\D/g, "").length >= 7, "Enter a phone number with at least 7 digits.");

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid email address.");

const budget = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n) || n < 0 || n > 100_000_000) {
      ctx.addIssue({ code: "custom", message: "Enter a budget between $0 and $100,000,000." });
      return z.NEVER;
    }
    return Math.round(n);
  });

const uuid = z.uuid();
const optionalUuid = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || uuid.safeParse(v).success, "Invalid selection.");

const optionalDateTime = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const iso = fromDateTimeLocal(v);
    if (!iso) {
      ctx.addIssue({ code: "custom", message: "Enter a valid date." });
      return z.NEVER;
    }
    return iso;
  });

export const leadInputSchema = z
  .object({
    full_name: trimmed(120).min(2, "Enter the contact's full name."),
    email,
    phone,
    source: z.enum(LEAD_SOURCES, { message: "Choose a source." }),
    property_type: z
      .enum(PROPERTY_TYPES)
      .optional()
      .or(z.literal("").transform(() => undefined))
      .transform((v) => v ?? null),
    property_interest: optionalText(300),
    preferred_area: optionalText(120),
    budget,
    status: z.enum(LEAD_STATUSES).default("new_lead"),
    assigned_agent_id: optionalUuid,
    next_follow_up_at: optionalDateTime,
  })
  .refine((v) => v.email || v.phone, {
    message: "Add an email or a phone number so the team can follow up.",
    path: ["email"],
  });
export type LeadInput = z.infer<typeof leadInputSchema>;

export const moveLeadSchema = z.object({
  id: uuid,
  status: z.enum(LEAD_STATUSES),
  position: z.number().finite(),
  lost_reason: optionalText(300),
});

export const assignLeadSchema = z.object({
  id: uuid,
  assigned_agent_id: optionalUuid,
});

export const noteSchema = z.object({
  lead_id: uuid,
  body: trimmed(4000).min(1, "Write something before saving the note."),
});

export const taskInputSchema = z.object({
  title: trimmed(160).min(2, "Give the task a short title."),
  description: optionalText(2000),
  lead_id: optionalUuid,
  assigned_agent_id: optionalUuid,
  priority: z.enum(TASK_PRIORITIES).default("normal"),
  due_at: z
    .string()
    .trim()
    .min(1, "Pick a due date.")
    .transform((v, ctx) => {
      const iso = fromDateTimeLocal(v);
      if (!iso) {
        ctx.addIssue({ code: "custom", message: "Pick a valid due date." });
        return z.NEVER;
      }
      return iso;
    }),
});
export type TaskInput = z.infer<typeof taskInputSchema>;

/** Public Northstar inquiry form. Stricter than the CRM form: email is required. */
export const publicInquirySchema = z.object({
  full_name: trimmed(120).min(2, "Please enter your full name."),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email("Please enter a valid email address.")),
  phone,
  property_type: z
    .enum(PROPERTY_TYPES)
    .optional()
    .or(z.literal("").transform(() => undefined))
    .transform((v) => v ?? null),
  property_interest: optionalText(300),
  preferred_area: optionalText(120),
  budget,
  message: optionalText(2000),
  consent: z.literal("on", { message: "Please agree to be contacted about your inquiry." }),
});
export type PublicInquiry = z.infer<typeof publicInquirySchema>;

export const leadFiltersSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.enum(LEAD_STATUSES).optional().catch(undefined),
  source: z.enum(LEAD_SOURCES).optional().catch(undefined),
  agent: z.union([z.literal("unassigned"), z.uuid()]).optional().catch(undefined),
  sort: z.enum(["newest", "oldest", "follow_up", "budget"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(1000).optional().catch(undefined),
});
export type LeadFilters = z.infer<typeof leadFiltersSchema>;

/** FormData → plain object; empty strings become undefined so optional fields behave. */
export function formToObject(form: FormData): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value !== "string") continue;
    out[key] = value === "" ? undefined : value;
  }
  return out;
}

/** Flatten Zod issues into { field: [messages] } for inline form errors. */
export function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** Escape characters that have meaning inside PostgREST `ilike` / `or` filters. */
export function sanitizeSearch(q: string): string {
  return q.replace(/[%_,()\\*:"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}
