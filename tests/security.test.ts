import assert from "node:assert/strict";
import { test } from "node:test";
import { hashIdentifier, isHoneypotFilled, issueFormToken, looksLikeSpam, verifyFormToken } from "../src/lib/security/form-guard";
import { signPayload, verifySignature } from "../src/lib/events/signing";

const SECRET = "test-secret-please-change";

test("form token: accepts a normal human submission", () => {
  const t0 = 1_800_000_000_000;
  const token = issueFormToken(SECRET, t0);
  assert.deepEqual(verifyFormToken(token, SECRET, t0 + 15_000), { ok: true });
});

test("form token: rejects bots, replays and tampering", () => {
  const t0 = 1_800_000_000_000;
  const token = issueFormToken(SECRET, t0);
  assert.deepEqual(verifyFormToken(token, SECRET, t0 + 500), { ok: false, reason: "too_fast" });
  assert.deepEqual(verifyFormToken(token, SECRET, t0 + 3 * 3_600_000), { ok: false, reason: "expired" });
  assert.deepEqual(verifyFormToken(token, "other-secret", t0 + 15_000), { ok: false, reason: "invalid" });
  assert.deepEqual(verifyFormToken(`${t0 - 60_000}.${token.split(".")[1]}`, SECRET, t0 + 15_000), { ok: false, reason: "invalid" });
  assert.deepEqual(verifyFormToken(undefined, SECRET), { ok: false, reason: "missing" });
});

test("honeypot and link-spam heuristics", () => {
  assert.equal(isHoneypotFilled(""), false);
  assert.equal(isHoneypotFilled("http://spam.example"), true);
  assert.equal(looksLikeSpam("Is the house still available?"), false);
  assert.equal(looksLikeSpam("http://a.example http://b.example www.c.example"), true);
});

test("identifiers are hashed, salted and case-insensitive", () => {
  const a = hashIdentifier("email", "Riley@Example.com", SECRET);
  assert.equal(a, hashIdentifier("email", "riley@example.com ", SECRET));
  assert.notEqual(a, hashIdentifier("email", "riley@example.com", "different-salt"));
  assert.notEqual(a, hashIdentifier("ip", "riley@example.com", SECRET));
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.ok(!a.includes("riley"));
});

test("webhook signatures verify and expire", () => {
  const body = JSON.stringify({ event: "lead.created", data: { lead_id: "x" } });
  const header = signPayload(body, SECRET, 1_800_000_000);
  assert.equal(verifySignature(body, header, SECRET, 1_800_000_010), true);
  assert.equal(verifySignature(body + " ", header, SECRET, 1_800_000_010), false, "body tampering");
  assert.equal(verifySignature(body, header, "wrong", 1_800_000_010), false, "wrong secret");
  assert.equal(verifySignature(body, header, SECRET, 1_800_001_000), false, "replay outside tolerance");
  assert.equal(verifySignature(body, null, SECRET), false);
});
