import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Webhook signing for outbound events (Phase 2 → n8n).
 *
 * Header format (similar to Stripe's):
 *   X-LeadPilot-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">
 *   X-LeadPilot-Event: lead.created
 *   Idempotency-Key: lead.created:<uuid>
 *
 * The receiver recomputes the HMAC with the shared secret, rejects requests
 * older than the tolerance (replay protection) and ignores any
 * Idempotency-Key it has already processed.
 */

export const SIGNATURE_HEADER = "X-LeadPilot-Signature";
export const DEFAULT_TOLERANCE_SECONDS = 300;

export function signPayload(body: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

export function verifySignature(
  body: string,
  header: string | null | undefined,
  secret: string,
  now = Math.floor(Date.now() / 1000),
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1) return false;
  if (Math.abs(now - t) > toleranceSeconds) return false;

  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${body}`).digest("hex"));
  const given = Buffer.from(parts.v1);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
