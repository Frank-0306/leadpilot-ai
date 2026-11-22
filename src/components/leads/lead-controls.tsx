"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { assignLeadAction, deleteLeadAction, moveLeadAction, scheduleFollowUpAction } from "@/app/actions/leads";
import { Button, Spinner } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Input, Select } from "@/components/ui/field";
import { IconTrash } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { LEAD_STATUSES, STATUS_META, type LeadStatus } from "@/lib/domain";
import { fromDateTimeLocal, toDateTimeLocal } from "@/lib/format";
import type { Agent, Lead } from "@/lib/types";

/** Stage, owner and follow-up controls on the lead page. Each saves immediately. */
export function LeadControls({ lead, agents, isAdmin }: { lead: Lead; agents: Agent[]; isAdmin: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<LeadStatus>(lead.status);

  function run(key: string, fn: () => Promise<{ ok: boolean; message?: string }>, onError?: () => void) {
    setBusy(key);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      if (res.ok) {
        if (res.message) toast(res.message);
        router.refresh();
      } else {
        toast(res.message ?? "Something went wrong.", "error");
        onError?.();
      }
    });
  }

  async function changeStatus(next: LeadStatus) {
    const previous = status;
    let lostReason: string | undefined;
    if (next === "lost") {
      const ok = await confirm({
        title: `Mark ${lead.full_name} as lost?`,
        body: "The lead leaves the active pipeline. You can move it back at any time.",
        confirmLabel: "Mark as lost",
      });
      if (!ok) return;
      lostReason = window.prompt("Reason (optional)", "") ?? undefined;
    }
    setStatus(next);
    run(
      "status",
      async () => {
        const res = await moveLeadAction({ id: lead.id, status: next, position: lead.position, lost_reason: lostReason });
        return res.ok ? { ok: true, message: `Moved to ${STATUS_META[next].label}.` } : res;
      },
      () => setStatus(previous),
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="lead-stage" className="flex items-center gap-2 text-[13px] text-muted">
          Stage {busy === "status" && pending ? <Spinner /> : null}
        </label>
        <Select id="lead-stage" value={status} onChange={(e) => changeStatus(e.target.value as LeadStatus)} disabled={pending}>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="lead-owner" className="flex items-center gap-2 text-[13px] text-muted">
          Responsible agent {busy === "assign" && pending ? <Spinner /> : null}
        </label>
        <Select
          id="lead-owner"
          defaultValue={lead.assigned_agent_id ?? ""}
          disabled={!isAdmin || pending}
          title={isAdmin ? undefined : "Only admins can reassign leads"}
          onChange={(e) => run("assign", () => assignLeadAction({ id: lead.id, assigned_agent_id: e.target.value || null }))}
        >
          <option value="">Unassigned</option>
          {agents
            .filter((a) => a.is_active || a.id === lead.assigned_agent_id)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_name}
              </option>
            ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="lead-follow-up" className="flex items-center gap-2 text-[13px] text-muted">
          Next follow-up {busy === "follow" && pending ? <Spinner /> : null}
        </label>
        <Input
          id="lead-follow-up"
          type="datetime-local"
          defaultValue={toDateTimeLocal(lead.next_follow_up_at)}
          disabled={pending}
          onBlur={(e) => {
            const value = e.target.value;
            const iso = value ? fromDateTimeLocal(value) : null;
            if ((iso ?? null) === (lead.next_follow_up_at ? new Date(lead.next_follow_up_at).toISOString() : null)) return;
            run("follow", () => scheduleFollowUpAction(lead.id, iso));
          }}
        />
      </div>
    </div>
  );
}

export function DeleteLeadButton({ leadId, name }: { leadId: string; name: string }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      loading={pending}
      onClick={async () => {
        const ok = await confirm({
          title: `Delete ${name}?`,
          body: "This permanently removes the lead with its notes, tasks and history. This can't be undone.",
          confirmLabel: "Delete lead",
        });
        if (!ok) return;
        startTransition(async () => {
          const res = await deleteLeadAction(leadId);
          if (res.ok) {
            toast(res.message ?? "Lead deleted.");
            router.push("/leads");
            router.refresh();
          } else toast(res.message, "error");
        });
      }}
    >
      <IconTrash size={16} /> Delete
    </Button>
  );
}
