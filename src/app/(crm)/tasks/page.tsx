import Link from "next/link";
import { z } from "zod";
import { TaskCheckbox } from "@/components/leads/notes-and-tasks";
import { PageHeader } from "@/components/shell/page-header";
import { DeleteTaskButton } from "@/components/tasks/delete-task";
import { NewTaskForm } from "@/components/tasks/task-form";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { requireViewer } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { listAgents, listTasks, taskCounts, type TaskView } from "@/lib/data/queries";
import { formatDateTime, formatRelative } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Tasks" };

const VIEWS: { key: TaskView; label: string; empty: string }[] = [
  { key: "open", label: "All open", empty: "No open tasks. Nice work." },
  { key: "overdue", label: "Overdue", empty: "Nothing overdue." },
  { key: "today", label: "Due today", empty: "Nothing else due today." },
  { key: "upcoming", label: "Upcoming", empty: "No upcoming tasks." },
  { key: "completed", label: "Completed", empty: "Completed tasks will show up here." },
];

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const view = (VIEWS.find((v) => v.key === sp.view)?.key ?? "open") as TaskView;
  const rawAgent = typeof sp.agent === "string" ? sp.agent : undefined;
  const agent = viewer.isAdmin && (rawAgent === "unassigned" || z.uuid().safeParse(rawAgent).success) ? rawAgent : undefined;

  const supabase = await createSupabaseServerClient();
  const [tasks, agents, counts, leadOptions] = await Promise.all([
    listTasks(view, agent),
    listAgents(),
    taskCounts(agent),
    supabase.from("leads").select("id, full_name").not("status", "in", "(won,lost)").order("full_name").limit(300),
  ]);
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const now = Date.now();
  const current = VIEWS.find((v) => v.key === view)!;

  const href = (v: TaskView) => {
    const p = new URLSearchParams();
    if (v !== "open") p.set("view", v);
    if (agent) p.set("agent", agent);
    return `/tasks${p.size ? `?${p}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Tasks"
        description={`${counts.open} open${counts.overdue ? `, ${counts.overdue} overdue` : ""}.`}
        actions={
          <NewTaskForm
            agents={agents.filter((a) => a.is_active).map((a) => ({ id: a.id, name: a.full_name }))}
            leads={((leadOptions.data ?? []) as { id: string; full_name: string }[]).map((l) => ({ id: l.id, name: l.full_name }))}
            canAssign={viewer.isAdmin}
            defaultAgentId={viewer.agent?.id ?? null}
          />
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1 overflow-x-auto" aria-label="Task views">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={href(v.key)}
              aria-current={v.key === view ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-[13.5px] whitespace-nowrap transition-colors",
                v.key === view ? "bg-surface font-medium text-ink shadow-[0_0_0_1px_var(--line)]" : "text-muted hover:bg-sunken hover:text-ink",
              )}
            >
              {v.label}
              {v.key === "overdue" && counts.overdue > 0 ? <span className="tabular ml-1.5 text-danger">{counts.overdue}</span> : null}
            </Link>
          ))}
        </nav>
        {viewer.isAdmin ? (
          <form className="flex items-center gap-2 text-[13px]">
            {view !== "open" ? <input type="hidden" name="view" value={view} /> : null}
            <label htmlFor="task-agent-filter" className="text-muted">
              Agent
            </label>
            <select
              id="task-agent-filter"
              name="agent"
              defaultValue={agent ?? ""}
              className="h-8 rounded-md border border-line bg-surface px-2 text-[13px]"
            >
              <option value="">Everyone</option>
              <option value="unassigned">Unassigned</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.full_name}
                </option>
              ))}
            </select>
            <button className="h-8 rounded-md border border-line bg-surface px-2.5 hover:bg-sunken">Apply</button>
          </form>
        ) : null}
      </div>

      {tasks.length === 0 ? (
        <EmptyState title={current.empty} />
      ) : (
        <ul className="overflow-hidden rounded-xl border border-line bg-surface">
          {tasks.map((t) => {
            const overdue = !t.completed_at && new Date(t.due_at).getTime() < now;
            const a = t.assigned_agent_id ? agentById.get(t.assigned_agent_id) : undefined;
            return (
              <li key={t.id} className="group flex items-start gap-3 border-b border-line px-4 py-3 last:border-0">
                <TaskCheckbox task={t} compact />
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm", t.completed_at && "text-muted line-through")}>
                    {t.title}
                    {t.source === "automation" ? (
                    <span className="ml-2 rounded border border-accent/30 px-1 text-[11px] text-accent" title="Created by the New Lead Automation (n8n)">
                      Automation
                    </span>
                  ) : null}
                    {t.priority === "high" && !t.completed_at ? (
                      <span className="ml-2 rounded border border-[color:var(--warning)]/40 px-1 text-[11px] text-warning">High</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-[12.5px] text-muted">
                    <span className={overdue ? "font-medium text-danger" : undefined}>
                      {t.completed_at
                        ? `Completed ${formatRelative(t.completed_at)}`
                        : overdue
                          ? `Overdue, due ${formatRelative(t.due_at)}`
                          : `Due ${formatDateTime(t.due_at)}`}
                    </span>
                    {t.lead ? (
                      <Link href={`/leads/${t.lead.id}`} className="hover:text-ink hover:underline">
                        {t.lead.full_name}
                      </Link>
                    ) : null}
                  </p>
                  {t.description ? <p className="mt-1 text-[13px] text-muted">{t.description}</p> : null}
                </div>
                {a ? (
                  <span title={a.full_name}>
                    <Avatar name={a.full_name} color={a.color} size={22} />
                  </span>
                ) : (
                  <span className="text-[12.5px] text-faint">Unassigned</span>
                )}
                <DeleteTaskButton taskId={t.id} title={t.title} />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
