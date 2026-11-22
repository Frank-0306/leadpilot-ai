import { NextResponse } from "next/server";
import { z } from "zod";
import { bearerMatches } from "@/lib/security/bearer";
import { getSupabaseSecretClient } from "@/lib/supabase/secret";

/**
 * POST /api/automations/ai/context — called BY n8n (Workflow B).
 * Returns the minimum commercial context for one open AI request.
 * Only works for a request_id that LeadPilot issued in the last 3 minutes.
 */
export const dynamic = "force-dynamic";

const bodySchema = z.object({ request_id: z.uuid() });

export async function POST(request: Request) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.AUTOMATION_CALLBACK_SECRET)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "request_id must be a UUID" }, { status: 422 });

  const supabase = getSupabaseSecretClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "Server not configured" }, { status: 500 });

  const { data, error } = await supabase.rpc("ai_analysis_context", { p_request_id: parsed.data.request_id });
  if (error) {
    const unknown = error.code === "P0002";
    if (!unknown) console.error("ai_analysis_context failed", error.code, error.message);
    return NextResponse.json({ ok: false, error: unknown ? "Unknown or expired request" : "Could not load context" }, { status: unknown ? 404 : 500 });
  }
  return NextResponse.json({ ok: true, ...(data as Record<string, unknown>) });
}
