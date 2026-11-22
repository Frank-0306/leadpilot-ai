import { NextResponse } from "next/server";
import { z } from "zod";
import { validateAiOutput } from "@/lib/ai/analysis-schema";
import { bearerMatches } from "@/lib/security/bearer";
import { getSupabaseSecretClient } from "@/lib/supabase/secret";

/**
 * POST /api/automations/ai/result — called BY n8n with the model's answer
 * (or an error). LeadPilot validates the answer itself before storing it;
 * whatever n8n claims, invalid output is stored as "invalid_output".
 */
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  request_id: z.uuid(),
  execution_id: z.union([z.string(), z.number()]).optional().transform((v) => (v === undefined ? null : String(v).slice(0, 100))),
  model: z.string().max(100).optional(),
  output: z.unknown().optional(),
  error: z.string().max(2000).optional(),
});

export async function POST(request: Request) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.AUTOMATION_CALLBACK_SECRET)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > 50_000) {
    return NextResponse.json({ ok: false, error: "Payload too large" }, { status: 413 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 422 });

  const supabase = getSupabaseSecretClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "Server not configured" }, { status: 500 });

  const { request_id, execution_id, model, output, error } = parsed.data;
  let status: "succeeded" | "failed" | "invalid_output";
  let result: unknown = null;
  let message: string | null = null;

  if (error || output === undefined || output === null) {
    status = "failed";
    message = error ? `AI workflow error: ${error}` : "The AI workflow returned no output.";
  } else {
    const v = validateAiOutput(output);
    if (v.status === "succeeded") {
      status = "succeeded";
      result = v.analysis;
    } else {
      status = "invalid_output";
      message = v.error;
    }
  }

  const { data, error: dbError } = await supabase.rpc("complete_ai_analysis", {
    p_request_id: request_id,
    p_status: status,
    p_result: result,
    p_model: model ?? null,
    p_error: message,
    p_execution_id: execution_id,
  });
  if (dbError) {
    const unknown = dbError.code === "P0002";
    if (!unknown) console.error("complete_ai_analysis failed", dbError.code, dbError.message);
    return NextResponse.json({ ok: false, error: unknown ? "Unknown request" : "Could not store the result" }, { status: unknown ? 404 : 500 });
  }

  const stored = data as { outcome: string; status: string; analysis_id: string };
  return NextResponse.json({ ok: true, outcome: stored.outcome, status: stored.status, analysis_id: stored.analysis_id });
}
