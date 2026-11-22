import { timingSafeEqual } from "node:crypto";

/** Constant-time check of an `Authorization: Bearer <secret>` header. Missing secret → always false. */
export function bearerMatches(header: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !header || !header.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7).trim());
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
