"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { moveLeadAction } from "@/app/actions/leads";
import { Avatar } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { LEAD_STATUSES, STATUS_META, type LeadStatus } from "@/lib/domain";
import { formatCurrency, formatRelative, positionBetween } from "@/lib/format";
import type { Agent, Lead } from "@/lib/types";

/**
 * Kanban board.
 *  - Mouse: drag a card onto a column or between cards (HTML5 drag and drop).
 *  - Keyboard / touch: every card has a "Move to" menu, so the board is fully
 *    usable without dragging.
 * Moves are optimistic: the card moves at once, the server action persists
 * it, and on failure the card snaps back with an error toast.
 */
export function PipelineBoard({ initialLeads, agents }: { initialLeads: Lead[]; agents: Agent[] }) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ status: LeadStatus; beforeId: string | null } | null>(null);
  const [, startTransition] = useTransition();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const lastSync = useRef(initialLeads);

  // Pick up fresh server data after router.refresh() without clobbering in-flight moves.
  if (lastSync.current !== initialLeads && saving.size === 0) {
    lastSync.current = initialLeads;
    setLeads(initialLeads);
  }

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const columns = useMemo(() => {
    const map = new Map<LeadStatus, Lead[]>(LEAD_STATUSES.map((s) => [s, []]));
    for (const l of leads) map.get(l.status)?.push(l);
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [leads]);

  async function move(leadId: string, status: LeadStatus, beforeId: string | null) {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;

    const target = (columns.get(status) ?? []).filter((l) => l.id !== leadId);
    const index = beforeId ? target.findIndex((l) => l.id === beforeId) : target.length;
    const before = index > 0 ? target[index - 1]!.position : null;
    const after = index >= 0 && index < target.length ? target[index]!.position : null;
    const position = positionBetween(before, after);

    if (lead.status === status && (before === null || before <= lead.position) && (after === null || lead.position <= after)) return;

    if (status === "lost" && lead.status !== "lost") {
      const ok = await confirm({
        title: `Mark ${lead.full_name} as lost?`,
        body: "The lead leaves the active pipeline. You can drag it back later.",
        confirmLabel: "Mark as lost",
      });
      if (!ok) return;
    }

    const snapshot = leads;
    setLeads((ls) => ls.map((l) => (l.id === leadId ? { ...l, status, position } : l)));
    setSaving((s) => new Set(s).add(leadId));

    startTransition(async () => {
      const res = await moveLeadAction({ id: leadId, status, position });
      setSaving((s) => {
        const next = new Set(s);
        next.delete(leadId);
        return next;
      });
      if (!res.ok) {
        setLeads(snapshot);
        toast(res.message, "error");
        return;
      }
      if (res.data) setLeads((ls) => ls.map((l) => (l.id === leadId ? res.data! : l)));
      if (lead.status !== status) toast(`${lead.full_name} moved to ${STATUS_META[status].label}.`);
      router.refresh();
    });
  }

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
      <div className="flex min-w-max snap-x snap-mandatory gap-3">
        {LEAD_STATUSES.map((status) => {
          const list = columns.get(status) ?? [];
          const total = list.reduce((s, l) => s + (l.budget ?? 0), 0);
          const isTarget = dropTarget?.status === status && dragId !== null;
          return (
            <section
              key={status}
              aria-label={`${STATUS_META[status].label}: ${list.length} leads`}
              className={cn(
                "flex w-[272px] shrink-0 snap-start flex-col rounded-xl border bg-sunken/40 transition-colors",
                isTarget ? "border-accent/60 bg-accent-soft/40" : "border-transparent",
              )}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                // Over the column itself (not a card): drop at the end.
                if (dropTarget?.status !== status || dropTarget.beforeId !== null) setDropTarget({ status, beforeId: null });
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/lead-id") || dragId;
                const beforeId = dropTarget?.status === status ? dropTarget.beforeId : null;
                setDragId(null);
                setDropTarget(null);
                if (id) void move(id, status, beforeId);
              }}
            >
              <header className="flex flex-col gap-2 px-3 pt-3 pb-2">
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-[2px]" style={{ background: STATUS_META[status].tone }} aria-hidden="true" />
                  <h2 className="text-[13.5px] font-semibold">{STATUS_META[status].label}</h2>
                  <span className="tabular text-[13px] text-muted">{list.length}</span>
                  <span className="tabular ml-auto text-[12.5px] text-faint">{total ? formatCurrency(total, true) : ""}</span>
                </div>
                <span className="h-[2px] rounded-full" style={{ background: STATUS_META[status].tone, opacity: 0.55 }} aria-hidden="true" />
              </header>

              <ol className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2" data-column="true">
                {list.map((lead) => {
                  const agent = lead.assigned_agent_id ? agentById.get(lead.assigned_agent_id) : undefined;
                  const showLine = isTarget && dropTarget?.beforeId === lead.id;
                  const overdue = lead.next_follow_up_at && new Date(lead.next_follow_up_at) < new Date() && !["won", "lost"].includes(lead.status);
                  return (
                    <li
                      key={lead.id}
                      draggable={!saving.has(lead.id)}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/lead-id", lead.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragId(lead.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropTarget(null);
                      }}
                      onDragOver={(e) => {
                        if (!dragId) return;
                        e.preventDefault();
                        e.stopPropagation();
                        if (dragId === lead.id) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const upperHalf = e.clientY < rect.top + rect.height / 2;
                        const idx = list.findIndex((l) => l.id === lead.id);
                        const beforeId = upperHalf ? lead.id : (list[idx + 1]?.id ?? null);
                        if (dropTarget?.status !== status || dropTarget.beforeId !== beforeId) setDropTarget({ status, beforeId });
                      }}
                      className={cn(
                        "group relative rounded-lg border border-line bg-surface p-3 transition-[opacity,box-shadow] duration-150",
                        "cursor-grab active:cursor-grabbing hover:border-line-strong",
                        dragId === lead.id && "opacity-40",
                        showLine && "before:absolute before:-top-[6px] before:inset-x-1 before:h-[2px] before:rounded-full before:bg-accent",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/leads/${lead.id}`} className="text-sm leading-snug font-medium hover:underline" draggable={false}>
                          {lead.full_name}
                        </Link>
                        {saving.has(lead.id) ? <Spinner className="mt-0.5 text-accent" /> : null}
                      </div>
                      <p className="mt-0.5 truncate text-[12.5px] text-muted">{lead.preferred_area ?? lead.property_interest ?? "No area yet"}</p>
                      <div className="mt-2.5 flex items-center gap-2 text-[12.5px]">
                        <span className="tabular font-medium">{formatCurrency(lead.budget, true)}</span>
                        {lead.next_follow_up_at && !["won", "lost"].includes(lead.status) ? (
                          <span className={cn("truncate", overdue ? "text-danger" : "text-faint")}>{formatRelative(lead.next_follow_up_at)}</span>
                        ) : null}
                        <span className="ml-auto">
                          {agent ? <Avatar name={agent.full_name} color={agent.color} size={20} /> : <span className="text-faint">Unassigned</span>}
                        </span>
                      </div>
                      <label className="sr-only" htmlFor={`move-${lead.id}`}>
                        Move {lead.full_name} to stage
                      </label>
                      <select
                        id={`move-${lead.id}`}
                        value={lead.status}
                        disabled={saving.has(lead.id)}
                        onChange={(e) => void move(lead.id, e.target.value as LeadStatus, null)}
                        className="mt-2.5 h-7 w-full rounded-md border border-line bg-canvas px-2 text-[12.5px] text-muted focus:border-accent focus:outline-none [@media(hover:hover)]:hidden [@media(hover:hover)]:group-focus-within:block [@media(hover:hover)]:group-hover:block"
                      >
                        {LEAD_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s === lead.status ? `In ${STATUS_META[s].label}` : `Move to ${STATUS_META[s].label}`}
                          </option>
                        ))}
                      </select>
                    </li>
                  );
                })}
                {list.length === 0 ? (
                  <li className="grid flex-1 place-items-center rounded-lg border border-dashed border-line px-3 py-6 text-center text-[12.5px] text-faint">
                    {dragId ? "Drop here" : "No leads in this stage"}
                  </li>
                ) : null}
                {isTarget && dropTarget?.beforeId === null && list.length > 0 ? (
                  <li className="h-[2px] rounded-full bg-accent" aria-hidden="true" />
                ) : null}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}
