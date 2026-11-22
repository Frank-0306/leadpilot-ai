import { signPayload, SIGNATURE_HEADER } from "./signing";

/**
 * Outbox dispatcher: LeadPilot → n8n.
 *
 * Per run:
 *   1. store.claim(n)   Postgres marks events "processing" (FOR UPDATE SKIP
 *                       LOCKED) and returns them with the n8n webhook path of
 *                       the automation that handles them. Events nobody
 *                       subscribes to are marked "skipped" in the same step.
 *   2. POST the event to `${baseUrl}/webhook/${path}` with
 *        Authorization: Bearer <N8N_WEBHOOK_SECRET>   (checked by n8n's Webhook node)
 *        X-LeadPilot-Signature: t=…,v1=…              (HMAC, for receivers that verify it)
 *        Idempotency-Key: lead.created:<uuid>          (stable across retries)
 *   3. The workflow must answer 2xx with JSON `{ "ok": true, … }` AFTER it has
 *      called back into LeadPilot. Anything else — timeout, non-2xx, or a 2xx
 *      without ok:true — counts as a failure and is retried with backoff.
 *
 * Delivery is at-least-once. Duplicates are harmless because the callback
 * action is idempotent per event (see automation_create_follow_up_task).
 */

export interface OutboxEvent {
  id: string;
  type: string;
  idempotency_key: string;
  attempts: number;
  payload: unknown;
  automation_key: string;
  webhook_path: string;
}

export interface DeliveryResult {
  eventId: string;
  success: boolean;
  status: number | null;
  error: string | null;
  durationMs: number;
  executionId: string | null;
  response: Record<string, unknown> | null;
}

export interface OutboxStore {
  claim(limit: number): Promise<OutboxEvent[]>;
  complete(result: DeliveryResult): Promise<void>;
}

export interface DispatchConfig {
  enabled: boolean;
  baseUrl: string | null;
  secret: string | null;
  /** "test" posts to /webhook-test/ (n8n editor "Listen for test event"). */
  mode?: "production" | "test";
  batchSize?: number;
  timeoutMs?: number;
}

export interface DispatchSummary {
  skipped: boolean;
  reason?: string;
  claimed: number;
  delivered: number;
  failed: number;
}

export type DispatchStatus = "disabled" | "not_configured" | "invalid_url" | "ready";

export function readDispatchConfig(env: Record<string, string | undefined> = process.env): DispatchConfig {
  return {
    enabled: env.EVENTS_DISPATCH_ENABLED === "true",
    baseUrl: (env.N8N_BASE_URL || "").replace(/\/+$/, "") || null,
    secret: env.N8N_WEBHOOK_SECRET || null,
    mode: env.N8N_WEBHOOK_MODE === "test" ? "test" : "production",
  };
}

/** https anywhere; plain http only for a local n8n (localhost / 127.0.0.1). */
export function isAllowedBaseUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

export function dispatchStatus(config: DispatchConfig): DispatchStatus {
  if (!config.baseUrl || !config.secret) return "not_configured";
  if (!isAllowedBaseUrl(config.baseUrl)) return "invalid_url";
  if (!config.enabled) return "disabled";
  return "ready";
}

export function webhookUrl(config: DispatchConfig, path: string): string {
  return `${config.baseUrl}/${config.mode === "test" ? "webhook-test" : "webhook"}/${encodeURIComponent(path)}`;
}

const STATUS_REASON: Record<Exclude<DispatchStatus, "ready">, string> = {
  disabled: "EVENTS_DISPATCH_ENABLED is not true",
  not_configured: "N8N_BASE_URL or N8N_WEBHOOK_SECRET is missing",
  invalid_url: "N8N_BASE_URL must use https (http is only allowed for localhost)",
};

export async function dispatchPendingEvents(
  store: OutboxStore,
  config: DispatchConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<DispatchSummary> {
  const status = dispatchStatus(config);
  if (status !== "ready") return { skipped: true, reason: STATUS_REASON[status], claimed: 0, delivered: 0, failed: 0 };

  const events = await store.claim(config.batchSize ?? 25);
  let delivered = 0;
  let failed = 0;

  for (const event of events) {
    const envelope =
      event.payload && typeof event.payload === "object" ? (event.payload as Record<string, unknown>) : { data: event.payload };
    const body = JSON.stringify({
      ...envelope,
      event_id: event.id,
      event: event.type,
      idempotency_key: event.idempotency_key,
      automation: event.automation_key,
      attempt: event.attempts,
    });
    const started = Date.now();
    let status: number | null = null;
    let error: string | null = null;
    let response: Record<string, unknown> | null = null;

    try {
      const res = await fetchImpl(webhookUrl(config, event.webhook_path), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.secret}`,
          [SIGNATURE_HEADER]: signPayload(body, config.secret!),
          "X-LeadPilot-Event": event.type,
          "Idempotency-Key": event.idempotency_key,
        },
        body,
        signal: AbortSignal.timeout(config.timeoutMs ?? 15_000),
      });
      status = res.status;
      const text = await res.text();
      try {
        const parsed: unknown = text ? JSON.parse(text) : null;
        response = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
      } catch {
        response = null;
      }
      if (!res.ok) {
        error = `n8n responded ${res.status}${typeof response?.error === "string" ? `: ${response.error}` : ""}`;
      } else if (response?.ok !== true) {
        error = "n8n answered without confirming the automation ran (expected JSON { ok: true })";
      }
    } catch (err) {
      error = describeFetchError(err);
    }

    const success = error === null;
    const executionId =
      typeof response?.execution_id === "string" || typeof response?.execution_id === "number"
        ? String(response.execution_id).slice(0, 100)
        : null;
    await store.complete({ eventId: event.id, success, status, error, durationMs: Date.now() - started, executionId, response });
    if (success) delivered += 1;
    else failed += 1;
  }

  return { skipped: false, claimed: events.length, delivered, failed };
}

function describeFetchError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return "n8n did not answer in time (timeout)";
    const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause;
    if (cause?.code) return `Could not reach n8n (${cause.code})`;
    return err.message || "Network error";
  }
  return "Unknown network error";
}
