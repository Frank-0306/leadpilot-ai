import assert from "node:assert/strict";
import { test } from "node:test";
import { extractJson, validateAiOutput } from "../src/lib/ai/analysis-schema";

const good = {
  interest_level: "High",
  summary: "Pre-approved buyer looking for an end-unit townhouse in Westbrook around $480k.",
  reasons: ["States mortgage pre-approval", "Wants to buy within 60 days", "Specific property type and area"],
  next_action: "Call today and offer two Westbrook townhouse viewings this week.",
  email_subject: "Westbrook townhouses for you, Ivy",
  email_body: "Hi Ivy,\n\nThanks for reaching out to Northstar Realty.\n\nBest,\nMaya\nNorthstar Realty",
};

test("accepts a well-formed analysis (object, JSON text or fenced JSON)", () => {
  assert.equal(validateAiOutput(good).status, "succeeded");
  assert.equal(validateAiOutput(JSON.stringify(good)).status, "succeeded");
  assert.equal(validateAiOutput("```json\n" + JSON.stringify(good) + "\n```").status, "succeeded");
  assert.equal(validateAiOutput("Here you go: " + JSON.stringify(good)).status, "succeeded");
});

test("normalizes interest level casing and strips HTML and extra fields", () => {
  const r = validateAiOutput({ ...good, interest_level: "medium", summary: "<b>Solid</b> buyer", extra: "ignored" });
  assert.equal(r.status, "succeeded");
  if (r.status === "succeeded") {
    assert.equal(r.analysis.interest_level, "Medium");
    assert.equal(r.analysis.summary, "Solid buyer");
    assert.equal("extra" in r.analysis, false);
  }
});

test("rejects malformed or incomplete output", () => {
  assert.equal(validateAiOutput("not json at all").status, "invalid_output");
  assert.equal(validateAiOutput({ ...good, interest_level: "Very High" }).status, "invalid_output");
  assert.equal(validateAiOutput({ ...good, reasons: [] }).status, "invalid_output");
  assert.equal(validateAiOutput({ ...good, reasons: ["a", "b", "c", "d", "e"] }).status, "invalid_output");
  assert.equal(validateAiOutput({ ...good, email_body: "x".repeat(2001) }).status, "invalid_output");
  const { next_action: _n, ...missing } = good;
  assert.equal(validateAiOutput(missing).status, "invalid_output");
  assert.equal(validateAiOutput(null).status, "invalid_output");
});

test("rejects reasoning based on protected characteristics (US Fair Housing)", () => {
  for (const reason of [
    "Young professional, likely to move quickly",
    "Mentions her children, family will need space",
    "Religious community nearby is a fit",
    "Is pregnant and needs to move soon",
    "Surname suggests foreign buyer",
  ]) {
    const r = validateAiOutput({ ...good, reasons: [reason] });
    assert.equal(r.status, "invalid_output", reason);
  }
  // commercial language passes
  assert.equal(validateAiOutput({ ...good, reasons: ["Budget fits Westbrook townhouse prices", "Pre-approved"] }).status, "succeeded");
});

test("rejects drafts with links or unfilled placeholders", () => {
  assert.equal(validateAiOutput({ ...good, email_body: "See https://evil.example now" }).status, "invalid_output");
  assert.equal(validateAiOutput({ ...good, email_body: "Hi [First Name], …" }).status, "invalid_output");
  assert.equal(validateAiOutput({ ...good, email_subject: "Hi {{name}}" }).status, "invalid_output");
});

test("extractJson handles objects and junk", () => {
  assert.deepEqual(extractJson({ a: 1 }), { a: 1 });
  assert.equal(extractJson("{broken"), null);
  assert.equal(extractJson(42), null);
});
