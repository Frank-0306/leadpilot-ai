import "server-only";
import { getSupabaseSecretClient } from "@/lib/supabase/secret";
import { dispatchPendingEvents, readDispatchConfig, type DispatchSummary, type OutboxEvent } from "./dispatcher";

/**
 * Runs the dispatcher with the secret-key client. Called:
 *   - right after a lead is created (via next/server `after`, so the visitor
 *     never waits for n8n),
 *   - by admins from Automations ("Process queue" / "Retry"),
 *   - by a scheduler hitting POST /api/events/dispatch (picks up retries).
 * Never throws: failures are recorded on the event and the automation run.
 */
export async function runDispatch(): Promise<DispatchSummary> {
  const supabase = getSupabaseSecretClient();
  const config = readDispatchConfig();
  if (!supabase) return { skipped: true, reason: "SUPABASE_SECRET_KEY is missing", claimed: 0, delivered: 0, failed: 0 };

  try {
    return await dispatchPendingEvents(
      {
        async claim(limit) {
          const { data, error } = await supabase.rpc("claim_automation_events", { p_limit: limit });
          if (error) throw new Error(`claim_automation_events: ${error.message}`);
          const events = (data ?? []) as OutboxEvent[];
          for (const e of events) {
            await supabase.rpc("record_automation_run", { p_event_id: e.id, p_status: "running" });
          }
          return events;
        },
        async complete(r) {
          const { error } = await supabase.rpc("complete_event_delivery", {
            p_event_id: r.eventId,
            p_success: r.success,
            p_response_status: r.status,
            p_error: r.error,
            p_duration_ms: r.durationMs,
          });
          if (error) console.error("complete_event_delivery failed", error.message);
          await supabase.rpc("record_automation_run", {
            p_event_id: r.eventId,
            p_status: r.success ? "succeeded" : "failed",
            p_error: r.error,
            p_execution_id: r.executionId,
            p_result: null,
          });
        },
      },
      config,
    );
  } catch (err) {
    console.error("Event dispatch failed", err);
    return { skipped: true, reason: err instanceof Error ? err.message : "Dispatch failed", claimed: 0, delivered: 0, failed: 0 };
  }
}
