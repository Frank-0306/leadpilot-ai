"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { friendlyDbError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { fieldErrors, formToObject, taskInputSchema } from "@/lib/validation";

function revalidateTasks(leadId?: string | null) {
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  if (leadId) revalidatePath(`/leads/${leadId}`);
}

export async function createTaskAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const viewer = await requireViewer();
  const parsed = taskInputSchema.safeParse(formToObject(form));
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  let assignee = parsed.data.assigned_agent_id;
  if (!viewer.isAdmin) {
    if (!viewer.agent) return { ok: false, message: "Your login isn't linked to an agent yet. Ask an admin." };
    assignee = viewer.agent.id; // agents create tasks for themselves
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("tasks").insert({ ...parsed.data, assigned_agent_id: assignee });
  if (error) return { ok: false, message: friendlyDbError(error, "The task couldn't be created.") };

  revalidateTasks(parsed.data.lead_id);
  return { ok: true, message: "Task created." };
}

export async function setTaskCompletedAction(taskId: string, completed: boolean): Promise<ActionResult> {
  await requireViewer();
  if (!z.uuid().safeParse(taskId).success) return { ok: false, message: "Invalid task." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({ completed_at: completed ? new Date().toISOString() : null })
    .eq("id", taskId)
    .select("lead_id");
  if (error) return { ok: false, message: friendlyDbError(error, "The task couldn't be updated.") };
  if (!data?.length) return { ok: false, message: "You can't update this task." };

  revalidateTasks(data[0]?.lead_id as string | null);
  return { ok: true, message: completed ? "Task completed." : "Task reopened." };
}

export async function deleteTaskAction(taskId: string): Promise<ActionResult> {
  await requireViewer();
  if (!z.uuid().safeParse(taskId).success) return { ok: false, message: "Invalid task." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("tasks").delete().eq("id", taskId).select("lead_id");
  if (error) return { ok: false, message: friendlyDbError(error, "The task couldn't be deleted.") };
  if (!data?.length) return { ok: false, message: "Only admins or the agent who created a task can delete it." };

  revalidateTasks(data[0]?.lead_id as string | null);
  return { ok: true, message: "Task deleted." };
}
