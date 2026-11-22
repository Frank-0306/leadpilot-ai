"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { deleteTaskAction } from "@/app/actions/tasks";
import { useConfirm } from "@/components/ui/confirm";
import { IconTrash } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

export function DeleteTaskButton({ taskId, title }: { taskId: string; title: string }) {
  const confirm = useConfirm();
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      className="grid size-7 place-items-center rounded-md text-faint opacity-0 group-hover:opacity-100 hover:bg-sunken hover:text-danger focus-visible:opacity-100 disabled:opacity-40"
      aria-label={`Delete task “${title}”`}
      disabled={pending}
      onClick={async () => {
        if (!(await confirm({ title: "Delete this task?", body: title, confirmLabel: "Delete task" }))) return;
        startTransition(async () => {
          const res = await deleteTaskAction(taskId);
          toast(res.ok ? (res.message ?? "Task deleted.") : res.message, res.ok ? "success" : "error");
          if (res.ok) router.refresh();
        });
      }}
    >
      <IconTrash size={15} />
    </button>
  );
}
