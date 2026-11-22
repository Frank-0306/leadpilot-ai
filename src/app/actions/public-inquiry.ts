"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { runDispatch } from "@/lib/events/run-dispatch";
import { getSupabaseSecretClient } from "@/lib/supabase/secret";
import {
  clientIpFrom,
  hashIdentifier,
  HONEYPOT_FIELD,
  isHoneypotFilled,
  looksLikeSpam,
  verifyFormToken,
} from "@/lib/security/form-guard";
import type { ActionResult } from "@/lib/types";
import { fieldErrors, formToObject, publicInquirySchema } from "@/lib/validation";

const SUCCESS = "Thanks — your request is in. A Northstar agent will reach out within one business day.";

/**
 * Public Northstar Realty inquiry form.
 *   1. Honeypot + signed timing token (cheap bot filters)
 *   2. Zod validation on the server
 *   3. submit_public_lead(): persistent per-IP / per-email rate limits,
 *      repeat-inquiry merge, insert as source=Website, status=New Lead,
 *      lead.created event in the outbox — all in one transaction.
 *   4. After responding, the outbox is dispatched to n8n (New Lead Automation).
 *
 * Bots get the same success message as people so they learn nothing.
 */
export async function submitInquiryAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const secret = process.env.FORM_SECRET;
  const supabase = getSupabaseSecretClient();
  if (!secret || !supabase) {
    return { ok: false, message: "The inquiry form isn't configured yet. Please call the office instead." };
  }

  const raw = formToObject(form);
  if (isHoneypotFilled(raw[HONEYPOT_FIELD])) return { ok: true, message: SUCCESS };

  const token = verifyFormToken(raw.form_token, secret);
  if (!token.ok) {
    if (token.reason === "too_fast") return { ok: true, message: SUCCESS };
    return { ok: false, message: "This form expired. Refresh the page and send it again." };
  }

  const parsed = publicInquirySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  }
  if (looksLikeSpam(parsed.data.message)) return { ok: true, message: SUCCESS };

  const ip = clientIpFrom(await headers());
  const { data, error } = await supabase.rpc("submit_public_lead", {
    p_full_name: parsed.data.full_name,
    p_email: parsed.data.email,
    p_phone: parsed.data.phone,
    p_property_type: parsed.data.property_type,
    p_property_interest: parsed.data.property_interest,
    p_preferred_area: parsed.data.preferred_area,
    p_budget: parsed.data.budget,
    p_message: parsed.data.message,
    p_ip_hash: hashIdentifier("ip", ip, secret),
    p_email_hash: hashIdentifier("email", parsed.data.email, secret),
  });

  if (error) {
    console.error("submit_public_lead failed", error.code, error.message);
    return { ok: false, message: "We couldn't send your request. Please try again in a minute." };
  }

  const outcome = (data as { outcome?: string } | null)?.outcome;
  if (outcome === "rate_limited") {
    return { ok: false, message: "We've received several requests from you already. An agent will be in touch soon." };
  }
  if (outcome === "created") {
    // Hand lead.created to n8n after the response is sent. If n8n is down the
    // lead is already saved; the event stays in the outbox and is retried.
    after(() => runDispatch());
  }
  return { ok: true, message: SUCCESS };
}
