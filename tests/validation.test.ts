import assert from "node:assert/strict";
import { test } from "node:test";
import { leadFiltersSchema, leadInputSchema, publicInquirySchema, sanitizeSearch, taskInputSchema } from "../src/lib/validation";

test("lead input: requires a name and at least one contact method", () => {
  const noContact = leadInputSchema.safeParse({ full_name: "Jordan Lee", source: "referral" });
  assert.equal(noContact.success, false);
  const ok = leadInputSchema.safeParse({ full_name: "Jordan Lee", source: "referral", phone: "(555) 010-2222" });
  assert.equal(ok.success, true);
});

test("lead input: normalizes email, parses budgets and empty optionals", () => {
  const r = leadInputSchema.parse({
    full_name: "  Jordan Lee ",
    email: " Jordan.Lee@Example.COM ",
    source: "website",
    budget: "$450,000",
    property_type: "",
    assigned_agent_id: "",
  });
  assert.equal(r.full_name, "Jordan Lee");
  assert.equal(r.email, "jordan.lee@example.com");
  assert.equal(r.budget, 450000);
  assert.equal(r.property_type, null);
  assert.equal(r.assigned_agent_id, null);
  assert.equal(r.status, "new_lead");
});

test("lead input: rejects bad email, phone, budget, enum values and agent ids", () => {
  const base = { full_name: "Jordan Lee", source: "website", phone: "5550102222" };
  assert.equal(leadInputSchema.safeParse({ ...base, email: "not-an-email" }).success, false);
  assert.equal(leadInputSchema.safeParse({ ...base, phone: "12" }).success, false);
  assert.equal(leadInputSchema.safeParse({ ...base, budget: "-5" }).success, false);
  assert.equal(leadInputSchema.safeParse({ ...base, source: "tiktok" }).success, false);
  assert.equal(leadInputSchema.safeParse({ ...base, status: "closed" }).success, false);
  assert.equal(leadInputSchema.safeParse({ ...base, assigned_agent_id: "1; drop table leads" }).success, false);
});

test("public inquiry: email and consent are required", () => {
  const base = { full_name: "Riley Park", email: "riley@example.com", consent: "on" };
  assert.equal(publicInquirySchema.safeParse(base).success, true);
  assert.equal(publicInquirySchema.safeParse({ ...base, consent: undefined }).success, false);
  assert.equal(publicInquirySchema.safeParse({ ...base, email: "" }).success, false);
  assert.equal(publicInquirySchema.safeParse({ ...base, full_name: "R" }).success, false);
});

test("task input: due date is interpreted in the brokerage time zone", () => {
  const r = taskInputSchema.parse({ title: "Call back", due_at: "2026-07-01T09:00" });
  // 9:00 in America/Chicago during daylight saving time = 14:00 UTC
  assert.equal(r.due_at, "2026-07-01T14:00:00.000Z");
});

test("filters: unknown values are dropped instead of erroring", () => {
  const f = leadFiltersSchema.parse({ status: "bogus", agent: "unassigned", page: "2", sort: "x" });
  assert.equal(f.status, undefined);
  assert.equal(f.agent, "unassigned");
  assert.equal(f.page, 2);
  assert.equal(f.sort, undefined);
});

test("search terms are stripped of PostgREST filter syntax", () => {
  assert.equal(sanitizeSearch("smith,status.eq.won)"), "smith status.eq.won");
  assert.equal(sanitizeSearch("100% *match*"), "100 match");
});
