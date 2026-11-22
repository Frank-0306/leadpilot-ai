"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { processQueueAction, retryEventAction, updateAutomationAction } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

function useAction() {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      toast(res.message ?? (res.ok ? "Done." : "Something went wrong."), res.ok ? "success" : "error");
      router.refresh();
    });
  return { pending, run };
}

export function ProcessQueueButton() {
  const { pending, run } = useAction();
  return (
    <Button loading={pending} onClick={() => run(processQueueAction)}>
      Process queue now
    </Button>
  );
}

export function RetryEventButton({ eventId }: { eventId: string }) {
  const { pending, run } = useAction();
  return (
    <Button size="sm" loading={pending} onClick={() => run(() => retryEventAction(eventId))}>
      Retry
    </Button>
  );
}

export function AutomationSettingsForm({
  automationKey,
  enabled,
  followUpHours,
}: {
  automationKey: string;
  enabled: boolean;
  followUpHours: number | null;
}) {
  const { pending, run } = useAction();
  const [on, setOn] = useState(enabled);
  const [hours, setHours] = useState(String(followUpHours ?? ""));
  const dirty = on !== enabled || (followUpHours !== null && Number(hours) !== followUpHours);

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          updateAutomationAction(
            followUpHours === null ? { key: automationKey, enabled: on } : { key: automationKey, enabled: on, follow_up_hours: Number(hours) },
          ),
        );
      }}
    >
      <label className="flex h-9 items-center gap-2 text-[13px]">
        <span className="relative inline-flex">
          <input
            type="checkbox"
            role="switch"
            checked={on}
            onChange={(e) => setOn(e.target.checked)}
            className="peer h-5 w-9 cursor-pointer appearance-none rounded-full bg-line-strong transition-colors checked:bg-accent"
          />
          <span className="pointer-events-none absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
        </span>
        {on ? "Active" : "Paused"}
      </label>
      {followUpHours !== null ? (
      <div className="flex flex-col gap-1">
        <label htmlFor={`hours-${automationKey}`} className="text-[12.5px] text-muted">
          Follow-up due after (hours)
        </label>
        <Input
          id={`hours-${automationKey}`}
          type="number"
          min={1}
          max={720}
          step={1}
          required
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          className="h-9 w-28"
        />
      </div>
      ) : null}
      <Button type="submit" size="md" variant={dirty ? "primary" : "secondary"} loading={pending} disabled={!dirty}>
        Save
      </Button>
    </form>
  );
}
