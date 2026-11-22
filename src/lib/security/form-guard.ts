import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Anti-spam helpers for the public inquiry form. Pure functions (the secret
 * is passed in) so they can be unit-tested; only server code calls them.
 *
 * Layers, cheapest first:
 *   1. Honeypot field that humans never see or fill.
 *   2. Signed timing token: rejects posts made < MIN_FILL_MS after the page
 *      rendered (bots) or with a token older than MAX_TOKEN_AGE_MS (replays).
 *   3. Persistent rate limits per hashed IP and per hashed email, enforced
 *      atomically in Postgres (submit_public_lead).
 *   4. Repeat inquiries for an open lead are merged instead of duplicated.
 */

export { HONEYPOT_FIELD } from "./form-guard-fields";
export const MIN_FILL_MS = 2_500;
export const MAX_TOKEN_AGE_MS = 2 * 60 * 60 * 1000;

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function issueFormToken(secret: string, now = Date.now()): string {
  const issuedAt = String(now);
  return `${issuedAt}.${sign(`form:${issuedAt}`, secret)}`;
}

export type TokenCheck = { ok: true } | { ok: false; reason: "missing" | "invalid" | "too_fast" | "expired" };

export function verifyFormToken(token: string | undefined | null, secret: string, now = Date.now()): TokenCheck {
  if (!token) return { ok: false, reason: "missing" };
  const [issuedAt, signature] = token.split(".");
  if (!issuedAt || !signature || !/^\d{10,16}$/.test(issuedAt)) return { ok: false, reason: "invalid" };

  const expected = Buffer.from(sign(`form:${issuedAt}`, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "invalid" };

  const age = now - Number(issuedAt);
  if (age < MIN_FILL_MS) return { ok: false, reason: "too_fast" };
  if (age > MAX_TOKEN_AGE_MS) return { ok: false, reason: "expired" };
  return { ok: true };
}

export function isHoneypotFilled(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** One-way, salted hash so raw IPs and emails are never stored in the abuse log. */
export function hashIdentifier(kind: "ip" | "email", value: string, secret: string): string {
  return createHash("sha256").update(`${kind}:${secret}:${value.trim().toLowerCase()}`).digest("hex");
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIpFrom(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "unknown";
}

/** Very rough content heuristic: lots of links in a message is almost always spam. */
export function looksLikeSpam(message: string | null | undefined): boolean {
  if (!message) return false;
  const links = message.match(/https?:\/\/|www\./gi)?.length ?? 0;
  return links >= 3;
}
