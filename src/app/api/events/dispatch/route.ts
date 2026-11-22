import { NextResponse } from "next/server";
import { runDispatch } from "@/lib/events/run-dispatch";
import { bearerMatches } from "@/lib/security/bearer";
import { getSupabaseSecretClient } from "@/lib/supabase/secret";

/**
 * POST /api/events/dispatch — for a scheduler (n8n Schedule Trigger, Vercel
 * Cron, …). Requires `Authorization: Bearer <CRON_SECRET>`. Records
 * task.overdue events, then delivers everything that is due (including
 * retries after backoff).
 */
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = getSupabaseSecretClient();
  if (supabase) await supabase.rpc("emit_overdue_task_events");
  return NextResponse.json(await runDispatch());
}

export const POST = handle;
// Vercel Cron sends GET requests with the same bearer header.
export const GET = handle;
