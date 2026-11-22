"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createTaskAction } from "@/app/actions/tasks";
import { Button } from "@/components/ui/button";
import { DateTimeField } from "@/components/ui/datetime-field";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { IconPlus } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

export function NewTaskForm({
  agents,
  leads,
  canAssign,
  defaultAgentId,
}: {
  agents: { id: string; name: string }[];
  leads: { id: string; name: string }[];
  canAssign: boolean;
  defaultAgentId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createTaskAction, null);
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const tomorrow = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 + 86_400_000).toISOString();

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      formRef.current?.reset();
      setOpen(false);
      toast(state.message ?? "Task created.");
    } else if (!state.fieldErrors) toast(state.message, "error");
  }, [state, toast]);

  if (!open) {
    return (
      <Button variant="primary" onClick={() => setOpen(true)}>
        <IconPlus size={16} /> New task
      </Button>
    );
  }

  return (
    <form ref={formRef} action={action} className="mb-6 grid w-full animate-pop gap-4 rounded-xl border border-line bg-surface p-5 sm:grid-cols-2">
      <Field label="Task" htmlFor="nt-title" error={errors.title} className="sm:col-span-2">
        <Input id="nt-title" name="title" required minLength={2} maxLength={160} autoFocus invalid={!!errors.title} />
      </Field>
      <Field label="Due" htmlFor="nt-due" error={errors.due_at}>
        <DateTimeField id="nt-due" name="due_at" required defaultIso={tomorrow} invalid={!!errors.due_at} />
      </Field>
      <Field label="Priority" htmlFor="nt-priority">
        <Select id="nt-priority" name="priority" defaultValue="normal">
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
        </Select>
      </Field>
      <Field label="Related lead" htmlFor="nt-lead" optional>
        <Select id="nt-lead" name="lead_id" defaultValue="">
          <option value="">None</option>
          {leads.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Assign to" htmlFor="nt-agent" hint={canAssign ? undefined : "Tasks you create are assigned to you."}>
        <Select id="nt-agent" name="assigned_agent_id" defaultValue={defaultAgentId ?? ""} disabled={!canAssign}>
          <option value="">Unassigned</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Details" htmlFor="nt-desc" optional className="sm:col-span-2">
        <Textarea id="nt-desc" name="description" maxLength={2000} className="min-h-16" />
      </Field>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" variant="primary" loading={pending}>
          Create task
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
