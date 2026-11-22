import { STATUS_META, type LeadStatus } from "@/lib/domain";
import { cn } from "@/lib/cn";

/** Stage label with its colour key. Used in tables, detail header and search. */
export function StageBadge({ status, className }: { status: LeadStatus; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px] text-ink", className)}>
      <span className="size-2 shrink-0 rounded-[2px]" style={{ background: meta.tone }} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

/**
 * The stage rail: one segment per forward stage, filled up to the current
 * one. It's LeadPilot's signature element — a lead's progress at a glance.
 */
export function StageRail({ status, className }: { status: LeadStatus; className?: string }) {
  const order: LeadStatus[] = ["new_lead", "contacted", "qualified", "viewing_scheduled", "negotiation"];
  const reached = status === "won" ? order.length : status === "lost" ? -1 : order.indexOf(status);
  return (
    <span className={cn("flex gap-[3px]", className)} role="img" aria-label={`Stage: ${STATUS_META[status].label}`}>
      {order.map((s, i) => (
        <span
          key={s}
          className="h-[3px] flex-1 rounded-full"
          style={{
            background:
              status === "lost"
                ? "var(--stage-lost)"
                : i <= reached
                  ? STATUS_META[status === "won" ? "won" : s].tone
                  : "var(--line)",
            opacity: status === "lost" ? 0.45 : 1,
          }}
        />
      ))}
    </span>
  );
}
