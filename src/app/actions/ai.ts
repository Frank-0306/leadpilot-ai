"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { friendlyDbError } from "@/lib/errors";
import { dispatchStatus, readDispatchConfig, webhookUrl } from "@/lib/events/dispatcher";
import { getSupabaseSecretClient } from "@/lib/supabase/secret";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

const OUTCOME_MESSAGES: Record<string, string> = {
  not_configured: "AI not configured. An admin needs to connect the AI workflow in Automations.",
  in_progress: "An analysis for this lead is already running.",
  too_soon: "Please wait a few seconds before generating another analysis for this lead.",
  rate_limited: "You've reached the limit of 20 AI analyses per hour. Try again later.",
  daily_limit: "The workspace reached its daily AI limit (200 analyses). Try again tomorrow.",
};

/**
 * Generate (or regenerate) the AI analysis for a lead.
 * LeadPilot sends n8n only the request and lead IDs; n8n fetches the minimal
 * context, calls Gemini and posts the result back, where it is validated.
 */
export async function generateAiAnalysisAction(leadId: string): Promise<ActionResult<{ status: string }>> {
  await requireViewer();
  if (!z.uuid().safeParse(leadId).success) return { ok: false, message: "Invalid lead." };

  const config = readDispatchConfig();
  if (dispatchStatus(config) !== "ready") return { ok: false, message: OUTCOME_MESSAGES.not_configured };

  const supabase = await createSupabaseServerClient();
  const { data: automation } = await supabase.from("automations").select("webhook_path, enabled").eq("key", "ai_lead_analysis").maybeSingle();
  if (!automation?.enabled) return { ok: false, message: OUTCOME_MESSAGES.not_configured };

  const { data, error } = await supabase.rpc("request_ai_analysis", { p_lead_id: leadId });
  if (error) return { ok: false, message: friendlyDbError(error, "The analysis couldn't be started.") };
  const outcome = data as { outcome: string; request_id?: string };
  if (outcome.outcome !== "requested" || !outcome.request_id) {
    return { ok: false, message: OUTCOME_MESSAGES[outcome.outcome] ?? "The analysis couldn't be started." };
  }

  const secret = getSupabaseSecretClient();
  const fail = async (message: string) => {
    await secret?.rpc("complete_ai_analysis", { p_request_id: outcome.request_id, p_status: "failed", p_error: message });
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/automations");
    return { ok: false as const, message };
  };

  try {
    const res = await fetch(webhookUrl(config, automation.webhook_path as string), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.secret}` },
      body: JSON.stringify({ request_id: outcome.request_id, lead_id: leadId }),
      signal: AbortSignal.timeout(150_000),
    });
    if (res.status === 404) return await fail("The AI workflow isn't published in n8n (404).");
    if (res.status === 401 || res.status === 403) return await fail("n8n rejected LeadPilot's webhook token.");
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return await fail(name === "TimeoutError" ? "The AI workflow did not answer in time." : "Could not reach n8n. Is it running?");
  }

  // n8n has answered; the result (or error) is already stored by the callback.
  const { data: row } = await supabase
    .from("ai_analyses")
    .select("status, error")
    .eq("request_id", outcome.request_id)
    .maybeSingle();

  if (!row || row.status === "requested") return await fail("The AI workflow finished without returning a result.");

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/automations");
  if (row.status === "succeeded") return { ok: true, message: "AI analysis ready. Review it before using it.", data: { status: "succeeded" } };
  return { ok: false, message: (row.error as string | null) ?? "The AI analysis failed." };
}

export async function approveAiDraftAction(input: { analysisId: string; subject: string; body: string }): Promise<ActionResult> {
  await requireViewer();
  const parsed = z
    .object({ analysisId: z.uuid(), subject: z.string().trim().min(1).max(150), body: z.string().trim().min(1).max(3000) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, message: "Subject and message are required (max 150 / 3,000 characters)." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("approve_ai_draft", {
    p_analysis_id: parsed.data.analysisId,
    p_subject: parsed.data.subject,
    p_body: parsed.data.body,
  });
  if (error) return { ok: false, message: friendlyDbError(error, "The draft couldn't be approved.") };

  const { data } = await supabase.from("ai_analyses").select("lead_id").eq("id", parsed.data.analysisId).maybeSingle();
  if (data?.lead_id) revalidatePath(`/leads/${data.lead_id}`);
  return { ok: true, message: "Draft approved. Copy it into your email to send it yourself." };
}
