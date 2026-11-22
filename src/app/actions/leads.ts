"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { runDispatch } from "@/lib/events/run-dispatch";
import { redirect } from "next/navigation";
import { requireViewer, type Viewer } from "@/lib/auth";
import { friendlyDbError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult, DuplicateMatch, Lead } from "@/lib/types";
import {
  assignLeadSchema,
  fieldErrors,
  formToObject,
  leadInputSchema,
  moveLeadSchema,
  noteSchema,
} from "@/lib/validation";
import { z } from "zod";

/**
 * Lead mutations. Second line of defence after the proxy: every action
 * re-validates input with Zod and checks the viewer's role. The third line
 * is Postgres RLS, which rejects anything these checks might miss.
 */

function revalidateCrm(leadId?: string) {
  revalidatePath("/dashboard");
  revalidatePath("/leads");
  revalidatePath("/pipeline");
  revalidatePath("/tasks");
  if (leadId) revalidatePath(`/leads/${leadId}`);
}

/** Agents can only own leads themselves; admins may assign anyone (or no one). */
function resolveOwner(viewer: Viewer, requested: string | null): { ok: true; id: string | null } | { ok: false; message: string } {
  if (viewer.isAdmin) return { ok: true, id: requested };
  if (!viewer.agent) {
    return { ok: false, message: "Your login isn't linked to an agent profile yet. Ask an admin to link it in Settings." };
  }
  return { ok: true, id: viewer.agent.id };
}

async function findDuplicates(email: string | null, phone: string | null, excludeId?: string): Promise<DuplicateMatch[]> {
  if (!email && !phone) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("find_duplicate_leads", {
    p_email: email,
    p_phone: phone,
    p_exclude: excludeId ?? null,
  });
  return (data ?? []) as DuplicateMatch[];
}

export async function checkDuplicatesAction(email: string, phone: string, excludeId?: string): Promise<DuplicateMatch[]> {
  await requireViewer();
  const parsed = z
    .object({ email: z.string().max(254), phone: z.string().max(40), excludeId: z.uuid().optional() })
    .safeParse({ email, phone, excludeId });
  if (!parsed.success) return [];
  return findDuplicates(parsed.data.email.trim() || null, parsed.data.phone.trim() || null, parsed.data.excludeId);
}

export async function createLeadAction(_prev: ActionResult<{ id: string }> | null, form: FormData): Promise<ActionResult<{ id: string }>> {
  const viewer = await requireViewer();
  const parsed = leadInputSchema.safeParse(formToObject(form));
  if (!parsed.success) {
    return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  }

  const owner = resolveOwner(viewer, parsed.data.assigned_agent_id);
  if (!owner.ok) return { ok: false, message: owner.message };

  if (form.get("confirm_duplicate") !== "1") {
    const duplicates = await findDuplicates(parsed.data.email, parsed.data.phone);
    if (duplicates.length > 0) {
      return {
        ok: false,
        message: "This contact may already be in the CRM. Review the matches or save anyway.",
        duplicates,
      };
    }
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("leads")
    .insert({ ...parsed.data, assigned_agent_id: owner.id })
    .select("id")
    .single();

  if (error || !data) return { ok: false, message: friendlyDbError(error, "The lead couldn't be saved. Try again.") };

  revalidateCrm();
  after(() => runDispatch()); // lead.created → n8n, without delaying the redirect
  redirect(`/leads/${data.id}?flash=created`);
}

export async function updateLeadAction(
  leadId: string,
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireViewer();
  if (!z.uuid().safeParse(leadId).success) return { ok: false, message: "Invalid lead." };

  const parsed = leadInputSchema.safeParse(formToObject(form));
  if (!parsed.success) {
    return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  }

  const { assigned_agent_id, ...rest } = parsed.data;
  const update: Partial<Lead> = { ...rest };
  // Only admins can (re)assign; for agents the field is ignored entirely.
  if (viewer.isAdmin) update.assigned_agent_id = assigned_agent_id;
  if (update.status !== "lost") update.lost_reason = null;

  if (form.get("confirm_duplicate") !== "1") {
    const duplicates = await findDuplicates(parsed.data.email, parsed.data.phone, leadId);
    if (duplicates.length > 0) {
      return { ok: false, message: "Another lead uses this email or phone. Review the matches or save anyway.", duplicates };
    }
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("leads").update(update).eq("id", leadId).select("id");
  if (error) return { ok: false, message: friendlyDbError(error, "The changes couldn't be saved.") };
  if (!data?.length) return { ok: false, message: "You can't edit this lead, or it no longer exists." };

  revalidateCrm(leadId);
  redirect(`/leads/${leadId}?flash=updated`);
}

export async function deleteLeadAction(leadId: string): Promise<ActionResult> {
  const viewer = await requireViewer();
  if (!viewer.isAdmin) return { ok: false, message: "Only admins can delete leads." };
  if (!z.uuid().safeParse(leadId).success) return { ok: false, message: "Invalid lead." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("leads").delete().eq("id", leadId).select("id");
  if (error) return { ok: false, message: friendlyDbError(error, "The lead couldn't be deleted.") };
  if (!data?.length) return { ok: false, message: "That lead was already deleted." };

  revalidateCrm();
  return { ok: true, message: "Lead deleted." };
}

/** Kanban move: status and/or position. Returns the saved row so the board can reconcile. */
export async function moveLeadAction(input: {
  id: string;
  status: string;
  position: number;
  lost_reason?: string;
}): Promise<ActionResult<Lead>> {
  await requireViewer();
  const parsed = moveLeadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That move isn't valid." };

  const supabase = await createSupabaseServerClient();
  const patch: Partial<Lead> = { status: parsed.data.status, position: parsed.data.position };
  if (parsed.data.status === "lost") patch.lost_reason = parsed.data.lost_reason;

  const { data, error } = await supabase.from("leads").update(patch).eq("id", parsed.data.id).select("*");
  if (error) return { ok: false, message: friendlyDbError(error, "The move couldn't be saved. The card was put back.") };
  if (!data?.length) return { ok: false, message: "You can't move this lead, or it no longer exists." };

  revalidateCrm(parsed.data.id);
  return { ok: true, data: data[0] as Lead };
}

export async function assignLeadAction(input: { id: string; assigned_agent_id: string | null }): Promise<ActionResult> {
  const viewer = await requireViewer();
  if (!viewer.isAdmin) return { ok: false, message: "Only admins can reassign leads." };
  const parsed = assignLeadSchema.safeParse({ ...input, assigned_agent_id: input.assigned_agent_id ?? undefined });
  if (!parsed.success) return { ok: false, message: "Choose a valid agent." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("leads")
    .update({ assigned_agent_id: parsed.data.assigned_agent_id })
    .eq("id", parsed.data.id)
    .select("id");
  if (error) return { ok: false, message: friendlyDbError(error, "The lead couldn't be reassigned.") };
  if (!data?.length) return { ok: false, message: "That lead no longer exists." };

  revalidateCrm(parsed.data.id);
  return { ok: true, message: parsed.data.assigned_agent_id ? "Lead assigned." : "Lead unassigned." };
}

export async function scheduleFollowUpAction(leadId: string, iso: string | null): Promise<ActionResult> {
  await requireViewer();
  const parsed = z.object({ id: z.uuid(), at: z.iso.datetime().nullable() }).safeParse({ id: leadId, at: iso });
  if (!parsed.success) return { ok: false, message: "Pick a valid date." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("leads")
    .update({ next_follow_up_at: parsed.data.at })
    .eq("id", parsed.data.id)
    .select("id");
  if (error || !data?.length) return { ok: false, message: friendlyDbError(error, "The follow-up couldn't be saved.") };

  revalidateCrm(leadId);
  return { ok: true, message: parsed.data.at ? "Follow-up scheduled." : "Follow-up cleared." };
}

export async function addNoteAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const viewer = await requireViewer();
  const parsed = noteSchema.safeParse(formToObject(form));
  if (!parsed.success) return { ok: false, message: "Write something before saving the note.", fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("lead_notes").insert({
    lead_id: parsed.data.lead_id,
    body: parsed.data.body,
    author_id: viewer.userId,
    author_label: viewer.fullName,
  });
  if (error) return { ok: false, message: friendlyDbError(error, "The note couldn't be saved.") };

  revalidatePath(`/leads/${parsed.data.lead_id}`);
  return { ok: true, message: "Note saved." };
}

export async function deleteNoteAction(noteId: string, leadId: string): Promise<ActionResult> {
  await requireViewer();
  if (!z.uuid().safeParse(noteId).success) return { ok: false, message: "Invalid note." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("lead_notes").delete().eq("id", noteId).select("id");
  if (error) return { ok: false, message: friendlyDbError(error, "The note couldn't be deleted.") };
  if (!data?.length) return { ok: false, message: "You can only delete your own notes." };
  revalidatePath(`/leads/${leadId}`);
  return { ok: true, message: "Note deleted." };
}
