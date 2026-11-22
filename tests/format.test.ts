import assert from "node:assert/strict";
import { test } from "node:test";
import { fromDateTimeLocal, percentChange, positionBetween, toDateTimeLocal } from "../src/lib/format";
import { resolveRange } from "../src/lib/date-range";

test("datetime-local round trip in America/Chicago, across DST", () => {
  assert.equal(fromDateTimeLocal("2026-01-15T08:30", "America/Chicago"), "2026-01-15T14:30:00.000Z"); // CST
  assert.equal(fromDateTimeLocal("2026-07-15T08:30", "America/Chicago"), "2026-07-15T13:30:00.000Z"); // CDT
  assert.equal(toDateTimeLocal("2026-07-15T13:30:00.000Z", "America/Chicago"), "2026-07-15T08:30");
  assert.equal(fromDateTimeLocal("2026-07-15T13:30:00Z"), "2026-07-15T13:30:00.000Z");
  assert.equal(fromDateTimeLocal("garbage"), null);
});

test("kanban positions land between neighbours", () => {
  assert.equal(positionBetween(null, null), 0);
  assert.equal(positionBetween(null, 5), 4);
  assert.equal(positionBetween(5, null), 6);
  assert.equal(positionBetween(1, 2), 1.5);
});

test("percent change handles empty baselines", () => {
  assert.equal(percentChange(12, 10), 20);
  assert.equal(percentChange(0, 0), 0);
  assert.equal(percentChange(3, 0), null);
});

test("date ranges: presets and custom windows are whole days", () => {
  const now = new Date("2026-11-20T18:00:00Z"); // noon in Chicago
  const r = resolveRange({ range: "7d" }, now);
  assert.equal(r.fromDate, "2026-11-14");
  assert.equal(r.toDate, "2026-11-20");
  assert.equal(r.from, "2026-11-14T06:00:00.000Z");
  assert.equal(r.to, "2026-11-21T06:00:00.000Z");

  const c = resolveRange({ from: "2026-10-01", to: "2026-10-31" }, now);
  assert.equal(c.key, "custom");
  assert.equal(c.from, "2026-10-01T05:00:00.000Z");

  const fallback = resolveRange({ from: "2026-10-31", to: "2026-10-01" }, now);
  assert.equal(fallback.key, "30d");
});
