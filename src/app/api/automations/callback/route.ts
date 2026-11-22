import { NextResponse } from "next/server";
import { z } from "zod";
import { bearerMatches } from "@/lib/security/bearer";
import { getSupabaseSecretClient } from "@/lib/supabase/secret";

/**
 * POST /api/automations/callback — called BY n8n while it processes an event.
 *
 * Auth: `Authorization: Bearer <AUTOMATION_CALLBACK_SECRET>` (stored in n8n as
 * a Header Auth credential, never in the workflow JSON).
 * The body only names an action and the event; everything else (which lead,
 * due date, assignee) is decided here from the database, so n8n can't be used
 * to write arbitrary data.
 */
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  action: z.literal("create_follow_up_task"),
  event_id: z.uuid(),
  idempotency_key: z.string().min(5).max(200),
  execution_id: z.union([z.string(), z.number()]).optional().transform((v) => (v === undefined ? null : String(v).slice(0, 100))),
});

export async function POST(request: Request) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.AUTOMATION_CALLBACK_SECRET)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 10_000) return NextResponse.json({ ok: false, error: "Payload too large" }, { status: 413 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload", issues: parsed.error.issues.map((i) => i.path.join(".")) }, { status: 422 });
  }

  const supabase = getSupabaseSecretClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "Server not configured" }, { status: 500 });

  const { data, error } = await supabase.rpc("automation_create_follow_up_task", {
    p_event_id: parsed.data.event_id,
    p_idempotency_key: parsed.data.idempotency_key,
    p_execution_id: parsed.data.execution_id,
  });

  if (error) {
    const status = error.code === "P0002" ? 404 : error.code === "22023" ? 422 : 500;
    if (status === 500) console.error("automation callback failed", error.code, error.message);
    return NextResponse.json(
      { ok: false, error: status === 404 ? "Unknown event" : status === 422 ? error.message : "Could not create the task" },
      { status },
    );
  }

  const result = data as { outcome: string; task_id?: string; lead_id?: string; reason?: string };
  return NextResponse.json({ ok: true, ...result });
}
