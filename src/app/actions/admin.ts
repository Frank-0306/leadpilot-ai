"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { friendlyDbError } from "@/lib/errors";
import { runDispatch } from "@/lib/events/run-dispatch";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

async function requireAdminAction(): Promise<ActionResult | null> {
  const viewer = await requireViewer();
  return viewer.isAdmin ? null : { ok: false, message: "Only admins can do that." };
}

export async function resetDemoDataAction(): Promise<ActionResult<{ deleted_leads: number; seeded_leads: number }>> {
  const denied = await requireAdminAction();
  if (denied) return denied as ActionResult<never>;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("reset_demo_data");
  if (error) return { ok: false, message: friendlyDbError(error, "Demo data couldn't be reset.") };

  revalidatePath("/", "layout");
  const result = data as { deleted_leads: number; seeded_leads: number };
  return { ok: true, message: `Demo data reset: ${result.seeded_leads} demo leads restored.`, data: result };
}

export async function linkAgentAction(agentId: string, userId: string | null): Promise<ActionResult> {
  const denied = await requireAdminAction();
  if (denied) return denied;
  const parsed = z.object({ agentId: z.uuid(), userId: z.uuid().nullable() }).safeParse({ agentId, userId });
  if (!parsed.success) return { ok: false, message: "Choose a valid user." };

  const supabase = await createSupabaseServerClient();
  if (parsed.data.userId) {
    // A login can represent only one agent.
    await supabase.from("agents").update({ user_id: null }).eq("user_id", parsed.data.userId);
  }
  const { error } = await supabase.from("agents").update({ user_id: parsed.data.userId }).eq("id", parsed.data.agentId);
  if (error) return { ok: false, message: friendlyDbError(error, "The login couldn't be linked.") };

  revalidatePath("/settings");
  return { ok: true, message: parsed.data.userId ? "Login linked to agent." : "Login unlinked." };
}

export async function setRoleAction(userId: string, role: "admin" | "agent"): Promise<ActionResult> {
  const viewer = await requireViewer();
  if (!viewer.isAdmin) return { ok: false, message: "Only admins can change roles." };
  const parsed = z.object({ userId: z.uuid(), role: z.enum(["admin", "agent"]) }).safeParse({ userId, role });
  if (!parsed.success) return { ok: false, message: "Invalid role." };
  if (parsed.data.userId === viewer.userId && parsed.data.role !== "admin") {
    return { ok: false, message: "You can't remove your own admin role. Ask another admin." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("profiles").update({ role: parsed.data.role }).eq("id", parsed.data.userId);
  if (error) return { ok: false, message: friendlyDbError(error, "The role couldn't be changed.") };

  revalidatePath("/settings");
  return { ok: true, message: "Role updated." };
}

/** Records task.overdue events for overdue tasks (idempotent). Phase 2 will run this on a schedule. */
export async function scanOverdueTasksAction(): Promise<ActionResult> {
  const denied = await requireAdminAction();
  if (denied) return denied;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("emit_overdue_task_events");
  if (error) return { ok: false, message: friendlyDbError(error, "The overdue scan failed.") };
  revalidatePath("/automations");
  const n = Number(data ?? 0);
  return { ok: true, message: n === 0 ? "No new overdue tasks." : `${n} task.overdue event${n === 1 ? "" : "s"} recorded.` };
}

/** Admin: re-queue a failed, dead or skipped event and try to deliver it now. */
export async function retryEventAction(eventId: string): Promise<ActionResult> {
  const denied = await requireAdminAction();
  if (denied) return denied;
  if (!z.uuid().safeParse(eventId).success) return { ok: false, message: "Invalid event." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("retry_event", { p_event_id: eventId });
  if (error) return { ok: false, message: error.code === "22023" ? error.message : friendlyDbError(error, "The event couldn't be retried.") };

  const summary = await runDispatch();
  revalidatePath("/automations");
  if (summary.skipped) return { ok: true, message: `Event re-queued. Not sent yet: ${summary.reason}.` };
  return summary.failed > 0
    ? { ok: false, message: "Event re-queued, but delivery failed again. See the error in the history." }
    : { ok: true, message: "Event delivered to n8n." };
}

/** Admin: deliver everything that is due right now. */
export async function processQueueAction(): Promise<ActionResult> {
  const denied = await requireAdminAction();
  if (denied) return denied;
  const summary = await runDispatch();
  revalidatePath("/automations");
  if (summary.skipped) return { ok: false, message: `Nothing sent: ${summary.reason}.` };
  if (summary.claimed === 0) return { ok: true, message: "The queue is empty." };
  return {
    ok: summary.failed === 0,
    message: `${summary.delivered} delivered, ${summary.failed} failed.`,
  };
}

const automationSettingsSchema = z.discriminatedUnion("key", [
  z.object({ key: z.literal("new_lead_follow_up"), enabled: z.boolean(), follow_up_hours: z.number().int().min(1).max(720) }),
  z.object({ key: z.literal("ai_lead_analysis"), enabled: z.boolean() }),
]);

export async function updateAutomationAction(input: { key: string; enabled: boolean; follow_up_hours?: number }): Promise<ActionResult> {
  const denied = await requireAdminAction();
  if (denied) return denied;
  const parsed = automationSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Follow-up delay must be between 1 and 720 hours." };

  const supabase = await createSupabaseServerClient();
  const patch =
    parsed.data.key === "new_lead_follow_up"
      ? { enabled: parsed.data.enabled, settings: { follow_up_hours: parsed.data.follow_up_hours } }
      : { enabled: parsed.data.enabled };
  const { data, error } = await supabase
    .from("automations")
    .update(patch)
    .eq("key", parsed.data.key)
    .select("key");
  if (error || !data?.length) return { ok: false, message: friendlyDbError(error, "The automation couldn't be saved.") };

  revalidatePath("/automations");
  return { ok: true, message: parsed.data.enabled ? "Automation saved." : "Automation paused." };
}
