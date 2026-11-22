"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useTransition } from "react";
import { addNoteAction, deleteNoteAction } from "@/app/actions/leads";
import { createTaskAction, setTaskCompletedAction } from "@/app/actions/tasks";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { DateTimeField } from "@/components/ui/datetime-field";
import { Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { LeadNote, Task } from "@/lib/types";

export function NoteComposer({ leadId }: { leadId: string }) {
  const [state, action, pending] = useActionState(addNoteAction, null);
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      formRef.current?.reset();
      toast(state.message ?? "Note saved.");
    } else toast(state.message, "error");
  }, [state, toast]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2">
      <input type="hidden" name="lead_id" value={leadId} />
      <label htmlFor="note-body" className="sr-only">
        Internal note
      </label>
      <Textarea id="note-body" name="body" required maxLength={4000} placeholder="Add an internal note. Only your team can see it." className="min-h-20" />
      <div>
        <Button type="submit" size="sm" loading={pending}>
          Save note
        </Button>
      </div>
    </form>
  );
}

export function NotesList({ notes, leadId, viewerId, isAdmin }: { notes: LeadNote[]; leadId: string; viewerId: string; isAdmin: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const [, startTransition] = useTransition();

  if (notes.length === 0) return <p className="text-sm text-muted">No notes yet.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {notes.map((n) => (
        <li key={n.id} className="group rounded-lg bg-sunken/60 px-3.5 py-3">
          <p className="text-sm leading-relaxed whitespace-pre-line">{n.body}</p>
          <p className="mt-1.5 flex items-center gap-2 text-[12.5px] text-faint">
            {n.author_label ?? "Team"}, {formatRelative(n.created_at)}
            {isAdmin || n.author_id === viewerId ? (
              <button
                className="ml-auto text-faint opacity-0 group-hover:opacity-100 hover:text-danger focus-visible:opacity-100"
                onClick={async () => {
                  if (!(await confirm({ title: "Delete this note?", confirmLabel: "Delete note" }))) return;
                  startTransition(async () => {
                    const res = await deleteNoteAction(n.id, leadId);
                    toast(res.ok ? (res.message ?? "Note deleted.") : res.message, res.ok ? "success" : "error");
                    if (res.ok) router.refresh();
                  });
                }}
              >
                Delete
              </button>
            ) : null}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function TaskCheckbox({ task, compact }: { task: Task; compact?: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const done = !!task.completed_at;
  return (
    <input
      type="checkbox"
      checked={done}
      disabled={pending}
      aria-label={done ? `Reopen “${task.title}”` : `Complete “${task.title}”`}
      className={cn("size-4 shrink-0 cursor-pointer accent-[var(--accent)]", compact && "mt-0.5")}
      onChange={() =>
        startTransition(async () => {
          const res = await setTaskCompletedAction(task.id, !done);
          if (res.ok) {
            toast(res.message ?? "Task updated.");
            router.refresh();
          } else toast(res.message, "error");
        })
      }
    />
  );
}

export function LeadTasks({ tasks, leadId, agentOptions, defaultAgentId, canAssign }: {
  tasks: Task[];
  leadId: string;
  agentOptions: { id: string; name: string }[];
  defaultAgentId: string | null;
  canAssign: boolean;
}) {
  const [state, action, pending] = useActionState(createTaskAction, null);
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  // Rounded to the hour so the server render and hydration agree.
  const now = Math.floor(Date.now() / 3_600_000) * 3_600_000;

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      formRef.current?.reset();
      toast(state.message ?? "Task created.");
    } else toast(state.message, "error");
  }, [state, toast]);

  return (
    <div className="flex flex-col gap-4">
      {tasks.length === 0 ? (
        <p className="text-sm text-muted">No tasks for this lead.</p>
      ) : (
        <ul className="flex flex-col">
          {tasks.map((t) => {
            const overdue = !t.completed_at && new Date(t.due_at).getTime() < now;
            return (
              <li key={t.id} className="flex items-start gap-3 border-t border-line py-2.5 first:border-0">
                <TaskCheckbox task={t} compact />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm", t.completed_at && "text-muted line-through")}>
                    {t.title}
                    {t.source === "automation" ? (
                    <span className="ml-2 rounded border border-accent/30 px-1 text-[11px] text-accent" title="Created by the New Lead Automation (n8n)">
                      Automation
                    </span>
                  ) : null}
                  </span>
                  <span className={cn("text-[12.5px]", overdue ? "font-medium text-danger" : "text-faint")}>
                    {t.completed_at ? `Done ${formatRelative(t.completed_at)}` : `${overdue ? "Overdue, was due" : "Due"} ${formatDateTime(t.due_at)}`}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <form ref={formRef} action={action} className="flex flex-col gap-2 rounded-lg border border-dashed border-line p-3">
        <input type="hidden" name="lead_id" value={leadId} />
        <label htmlFor="task-title" className="sr-only">
          Task
        </label>
        <Input id="task-title" name="title" required minLength={2} maxLength={160} placeholder="Add a task, e.g. Send three Lakeview listings" />
        <div className="flex flex-wrap gap-2">
          <div className="min-w-[180px] flex-1">
            <label htmlFor="task-due" className="sr-only">
              Due
            </label>
            <DateTimeField id="task-due" name="due_at" required defaultIso={new Date(now + 86_400_000).toISOString()} />
          </div>
          <label htmlFor="task-priority" className="sr-only">
            Priority
          </label>
          <Select id="task-priority" name="priority" defaultValue="normal" className="w-auto">
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </Select>
          {canAssign ? (
            <>
              <label htmlFor="task-agent" className="sr-only">
                Agent
              </label>
              <Select id="task-agent" name="assigned_agent_id" defaultValue={defaultAgentId ?? ""} className="w-auto">
                <option value="">Unassigned</option>
                {agentOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </>
          ) : null}
          <Button type="submit" loading={pending}>
            Add task
          </Button>
        </div>
      </form>
    </div>
  );
}
