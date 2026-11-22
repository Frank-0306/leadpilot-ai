"use client";

import { useMemo, useState } from "react";

interface Point {
  date: string;
  created: number;
  won: number;
}

const W = 720;
const H = 220;
const PAD = { top: 14, right: 8, bottom: 26, left: 30 };

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const step = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / step) * step;
}

function label(date: string, withYear = false) {
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: withYear ? "numeric" : undefined, timeZone: "UTC" });
}

/**
 * New leads per day (bars) with closed-won deals (marks above the bar).
 * Plain SVG: no chart library, crisp in both themes, and a keyboard/
 * pointer-accessible tooltip.
 */
export function LeadsChart({ series }: { series: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const { max, bars, ticks } = useMemo(() => {
    const max = niceMax(Math.max(1, ...series.map((p) => p.created)));
    const innerW = W - PAD.left - PAD.right;
    const slot = innerW / Math.max(series.length, 1);
    const barW = Math.max(2, Math.min(18, slot * 0.62));
    const bars = series.map((p, i) => {
      const x = PAD.left + i * slot + (slot - barW) / 2;
      const h = ((H - PAD.top - PAD.bottom) * p.created) / max;
      return { ...p, x, w: barW, slot, y: H - PAD.bottom - h, h, cx: PAD.left + i * slot + slot / 2 };
    });
    const ticks = [0, max / 2, max];
    return { max, bars, ticks };
  }, [series]);

  const totalCreated = series.reduce((s, p) => s + p.created, 0);
  const totalWon = series.reduce((s, p) => s + p.won, 0);
  const labelEvery = Math.ceil(series.length / 6);
  const active = hover !== null ? bars[hover] : null;

  if (series.length === 0) return null;

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[13px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-accent" aria-hidden="true" />
          New leads <strong className="tabular font-semibold text-ink">{totalCreated}</strong>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: "var(--stage-won)" }} aria-hidden="true" />
          Deals won <strong className="tabular font-semibold text-ink">{totalWon}</strong>
        </span>
      </figcaption>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full overflow-visible"
          role="img"
          aria-label={`New leads per day: ${totalCreated} in total, ${totalWon} deals won.`}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((t) => {
            const y = H - PAD.bottom - ((H - PAD.top - PAD.bottom) * t) / max;
            return (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="var(--line)" strokeDasharray={t === 0 ? undefined : "2 4"} />
                <text x={PAD.left - 8} y={y + 4} textAnchor="end" className="tabular fill-[var(--faint)] text-[11px]">
                  {Math.round(t)}
                </text>
              </g>
            );
          })}

          {bars.map((b, i) => (
            <g key={b.date}>
              <rect
                x={b.cx - b.slot / 2}
                y={PAD.top}
                width={b.slot}
                height={H - PAD.top - PAD.bottom}
                fill={hover === i ? "var(--sunken)" : "transparent"}
                onMouseEnter={() => setHover(i)}
              />
              <rect
                x={b.x}
                y={b.y}
                width={b.w}
                height={Math.max(b.h, b.created > 0 ? 2 : 0)}
                rx={Math.min(3, b.w / 3)}
                fill="var(--accent)"
                opacity={hover === null || hover === i ? 1 : 0.45}
                pointerEvents="none"
              />
              {b.won > 0 ? (
                <circle cx={b.cx} cy={Math.min(b.y, H - PAD.bottom) - 7} r={3.5} fill="var(--stage-won)" pointerEvents="none" />
              ) : null}
              {i % labelEvery === 0 ? (
                <text x={b.cx} y={H - 8} textAnchor="middle" className="fill-[var(--faint)] text-[11px]">
                  {label(b.date)}
                </text>
              ) : null}
            </g>
          ))}
        </svg>

        {active ? (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12.5px] shadow-lg"
            style={{ left: `${(active.cx / W) * 100}%` }}
          >
            <p className="font-medium">{label(active.date, true)}</p>
            <p className="tabular text-muted">
              {active.created} new, {active.won} won
            </p>
          </div>
        ) : null}
      </div>

      {/* Screen-reader table */}
      <table className="sr-only">
        <caption>Leads per day</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>New leads</th>
            <th>Deals won</th>
          </tr>
        </thead>
        <tbody>
          {series.map((p) => (
            <tr key={p.date}>
              <td>{p.date}</td>
              <td>{p.created}</td>
              <td>{p.won}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
