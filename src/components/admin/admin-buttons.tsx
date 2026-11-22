"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { linkAgentAction, resetDemoDataAction, scanOverdueTasksAction, setRoleAction } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

function useRun() {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      toast(res.message ?? (res.ok ? "Done." : "Something went wrong."), res.ok ? "success" : "error");
      if (res.ok) router.refresh();
    });
  return { pending, run };
}

export function ResetDemoButton() {
  const confirm = useConfirm();
  const { pending, run } = useRun();
  return (
    <Button
      variant="danger"
      loading={pending}
      onClick={async () => {
        const ok = await confirm({
          title: "Reset demo data?",
          body: "All records marked as demo data (leads, notes, tasks, history and their events) are deleted and recreated. Real leads, users and logins are not touched.",
          confirmLabel: "Reset demo data",
        });
        if (ok) run(resetDemoDataAction);
      }}
    >
      Reset demo data
    </Button>
  );
}

export function ScanOverdueButton() {
  const { pending, run } = useRun();
  return (
    <Button loading={pending} onClick={() => run(scanOverdueTasksAction)}>
      Record overdue tasks now
    </Button>
  );
}

export function LinkLoginSelect({
  agentId,
  agentName,
  value,
  users,
}: {
  agentId: string;
  agentName: string;
  value: string | null;
  users: { id: string; label: string }[];
}) {
  const { pending, run } = useRun();
  return (
    <>
      <label htmlFor={`link-${agentId}`} className="sr-only">
        Login for {agentName}
      </label>
      <Select
        id={`link-${agentId}`}
        defaultValue={value ?? ""}
        disabled={pending}
        className="h-8 w-auto min-w-48 text-[13px]"
        onChange={(e) => run(() => linkAgentAction(agentId, e.target.value || null))}
      >
        <option value="">No login</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.label}
          </option>
        ))}
      </Select>
    </>
  );
}

export function RoleSelect({ userId, value, label }: { userId: string; value: "admin" | "agent"; label: string }) {
  const { pending, run } = useRun();
  return (
    <>
      <label htmlFor={`role-${userId}`} className="sr-only">
        Role for {label}
      </label>
      <Select
        id={`role-${userId}`}
        defaultValue={value}
        disabled={pending}
        className="h-8 w-auto text-[13px]"
        onChange={(e) => run(() => setRoleAction(userId, e.target.value as "admin" | "agent"))}
      >
        <option value="agent">Agent</option>
        <option value="admin">Admin</option>
      </Select>
    </>
  );
}
