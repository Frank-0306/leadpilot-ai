"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Spinner } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { RANGE_PRESETS } from "@/lib/date-range";
import type { Agent } from "@/lib/types";

/** Date range + agent filters, kept in the URL so views are shareable. */
export function DashboardFilters({
  rangeKey,
  fromDate,
  toDate,
  agent,
  agents,
  showAgentFilter,
}: {
  rangeKey: string;
  fromDate: string;
  toDate: string;
  agent?: string;
  agents: Agent[];
  showAgentFilter: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(next: Record<string, string | undefined>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    startTransition(() => router.replace(`${pathname}?${sp.toString()}`, { scroll: false }));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {pending ? <Spinner className="text-faint" /> : null}
      <div className="flex h-9 items-center rounded-md border border-line bg-surface p-0.5" role="group" aria-label="Date range">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => update({ range: p.key, from: undefined, to: undefined })}
            aria-pressed={rangeKey === p.key}
            className={cn(
              "h-full rounded-[5px] px-2.5 text-[13px] transition-colors",
              rangeKey === p.key ? "bg-sunken font-medium text-ink" : "text-muted hover:text-ink",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex h-9 items-center gap-1 rounded-md border border-line bg-surface px-2 text-[13px]">
        <label className="sr-only" htmlFor="range-from">
          From
        </label>
        <input
          id="range-from"
          type="date"
          value={fromDate}
          max={toDate}
          onChange={(e) => e.target.value && update({ range: undefined, from: e.target.value, to: toDate })}
          className={cn("bg-transparent text-ink outline-none", rangeKey !== "custom" && "text-muted")}
        />
        <span className="text-faint">to</span>
        <label className="sr-only" htmlFor="range-to">
          To
        </label>
        <input
          id="range-to"
          type="date"
          value={toDate}
          min={fromDate}
          onChange={(e) => e.target.value && update({ range: undefined, from: fromDate, to: e.target.value })}
          className={cn("bg-transparent text-ink outline-none", rangeKey !== "custom" && "text-muted")}
        />
      </div>
      {showAgentFilter ? (
        <>
          <label htmlFor="agent-filter" className="sr-only">
            Agent
          </label>
          <Select id="agent-filter" value={agent ?? ""} onChange={(e) => update({ agent: e.target.value || undefined })} className="w-auto min-w-40">
            <option value="">All agents</option>
            {agents
              .filter((a) => a.is_active)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.full_name}
                </option>
              ))}
          </Select>
        </>
      ) : null}
    </div>
  );
}
