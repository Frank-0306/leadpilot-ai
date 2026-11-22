import { fromDateTimeLocal, toDateTimeLocal } from "./format";

export const RANGE_PRESETS = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
] as const;

export interface ResolvedRange {
  key: string;
  from: string; // ISO, inclusive
  to: string; // ISO, exclusive
  fromDate: string; // YYYY-MM-DD in business time zone
  toDate: string; // YYYY-MM-DD inclusive, business time zone
  label: string;
}

function dayStart(date: string): string {
  return fromDateTimeLocal(`${date}T00:00`)!;
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Turn ?range=30d or ?from=YYYY-MM-DD&to=YYYY-MM-DD into an absolute window.
 * Whole days in the brokerage's time zone, ending today (inclusive).
 */
export function resolveRange(params: { range?: string; from?: string; to?: string }, now = new Date()): ResolvedRange {
  const today = toDateTimeLocal(now.toISOString()).slice(0, 10);
  const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

  if (isDate(params.from) && isDate(params.to) && params.from! <= params.to!) {
    let from = params.from!;
    const to = params.to! > today ? today : params.to!;
    // Keep within the 400-day limit enforced by dashboard_metrics().
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 365) from = addDays(to, -365);
    return { key: "custom", from: dayStart(from), to: dayStart(addDays(to, 1)), fromDate: from, toDate: to, label: `${from} – ${to}` };
  }

  const preset = RANGE_PRESETS.find((p) => p.key === params.range) ?? RANGE_PRESETS[1];
  const from = addDays(today, -(preset.days - 1));
  return {
    key: preset.key,
    from: dayStart(from),
    to: dayStart(addDays(today, 1)),
    fromDate: from,
    toDate: today,
    label: `Last ${preset.label}`,
  };
}
