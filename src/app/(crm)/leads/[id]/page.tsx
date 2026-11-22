import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { DeleteLeadButton, LeadControls } from "@/components/leads/lead-controls";
import { LeadTasks, NoteComposer, NotesList } from "@/components/leads/notes-and-tasks";
import { ButtonLink } from "@/components/ui/button";
import { IconChevronLeft, IconEdit, IconMail, IconPhone } from "@/components/ui/icons";
import { StageBadge, StageRail } from "@/components/ui/stage";
import { FlashToast } from "@/components/ui/toast";
import { requireViewer } from "@/lib/auth";
import { getAiInsights, getLeadDetail, listAgents, listLeadAutomationRuns } from "@/lib/data/queries";
import { AiInsights } from "@/components/leads/ai-insights";
import { dispatchStatus, readDispatchConfig } from "@/lib/events/dispatcher";
import { ACTIVITY_LABELS, PROPERTY_LABELS, SOURCE_LABELS, STATUS_META, isLeadStatus } from "@/lib/domain";
import { formatCurrency, formatDate, formatDateTime, formatRelative } from "@/lib/format";
import type { Activity, Agent } from "@/lib/types";

export const metadata = { title: "Lead" };

function describeActivity(a: Activity, agentName: (id: unknown) => string): string | null {
  const d = a.details ?? {};
  switch (a.type) {
    case "status_changed": {
      const from = isLeadStatus(d.from) ? STATUS_META[d.from].label : "—";
      const to = isLeadStatus(d.to) ? STATUS_META[d.to].label : "—";
      return `${from} → ${to}${d.lost_reason ? ` (${String(d.lost_reason)})` : ""}`;
    }
    case "assigned":
      return d.from_agent_id ? `${agentName(d.from_agent_id)} → ${agentName(d.to_agent_id)}` : `To ${agentName(d.to_agent_id)}`;
    case "unassigned":
      return `Removed from ${agentName(d.from_agent_id)}`;
    case "note_added":
      return typeof d.preview === "string" ? `“${d.preview}”` : null;
    case "task_created":
    case "task_completed":
    case "task_reopened":
      return typeof d.title === "string" ? d.title : null;
    case "follow_up_scheduled":
      return typeof d.at === "string" ? formatDateTime(d.at) : null;
    case "lead_created":
      return typeof d.source === "string" && d.source in SOURCE_LABELS ? `From ${SOURCE_LABELS[d.source as keyof typeof SOURCE_LABELS]}` : null;
    case "ai_analysis_generated":
      return typeof d.interest_level === "string" ? `${d.interest_level} interest (suggestion)` : null;
    case "ai_draft_approved":
      return typeof d.subject === "string" ? `“${d.subject}”` : null;
    case "repeat_inquiry":
      return typeof d.message === "string" && d.message ? `“${d.message.slice(0, 140)}”` : "Submitted the website form again";
    default:
      return null;
  }
}

export default async function LeadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();

  const viewer = await requireViewer();
  const [detail, agents, runs, ai] = await Promise.all([getLeadDetail(id), listAgents(), listLeadAutomationRuns(id), getAiInsights(id)]);
  const aiConfigured = ai.enabled && dispatchStatus(readDispatchConfig()) === "ready";
  if (!detail) notFound();
  const { lead, notes, activities, tasks } = detail;

  const agentById = new Map<string, Agent>(agents.map((a) => [a.id, a]));
  const agentName = (v: unknown) => (typeof v === "string" ? (agentById.get(v)?.full_name ?? "a former agent") : "nobody");
  const followUpOverdue = lead.next_follow_up_at && new Date(lead.next_follow_up_at) < new Date() && !["won", "lost"].includes(lead.status);

  return (
    <>
      <FlashToast flash={typeof sp.flash === "string" ? sp.flash : undefined} />
      <Link href="/leads" className="mb-4 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
        <IconChevronLeft size={14} /> Leads
      </Link>

      <header className="mb-6 flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{lead.full_name}</h1>
            {lead.is_demo ? (
              <span className="rounded border border-line px-1.5 text-[11.5px] text-muted" title="Fictional demo record">
                Demo data
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            <StageBadge status={lead.status} />
            {lead.email ? (
              <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1.5 hover:text-ink">
                <IconMail size={15} /> {lead.email}
              </a>
            ) : null}
            {lead.phone ? (
              <a href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1.5 hover:text-ink">
                <IconPhone size={15} /> {lead.phone}
              </a>
            ) : null}
          </div>
          <StageRail status={lead.status} className="mt-1 w-56" />
        </div>
        <div className="flex gap-2">
          <ButtonLink href={`/leads/${lead.id}/edit`}>
            <IconEdit size={15} /> Edit
          </ButtonLink>
          {viewer.isAdmin ? <DeleteLeadButton leadId={lead.id} name={lead.full_name} /> : null}
        </div>
      </header>

      <section className="mb-8 rounded-xl border border-line bg-surface p-5" aria-label="Stage and ownership">
        <LeadControls lead={lead} agents={agents} isAdmin={viewer.isAdmin} />
        {followUpOverdue ? (
          <p className="mt-3 text-[13px] font-medium text-danger">Follow-up was due {formatRelative(lead.next_follow_up_at)}.</p>
        ) : null}
      </section>

      <div className="mb-8">
        <AiInsights leadId={lead.id} leadEmail={lead.email} latest={ai.latest} lastAttempt={ai.lastAttempt} configured={aiConfigured} />
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-8">
          <section aria-labelledby="details-title">
            <h2 id="details-title" className="mb-3 text-[15px] font-semibold">
              Details
            </h2>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {[
                ["Source", SOURCE_LABELS[lead.source]],
                ["Budget", formatCurrency(lead.budget)],
                ["Property type", lead.property_type ? PROPERTY_LABELS[lead.property_type] : "—"],
                ["Preferred area", lead.preferred_area ?? "—"],
                ["Property of interest", lead.property_interest ?? "—"],
                ["Created", formatDate(lead.created_at)],
                ["In this stage since", formatRelative(lead.status_changed_at)],
                ...(lead.status === "lost" ? [["Lost reason", lead.lost_reason ?? "—"]] : []),
              ].map(([k, v]) => (
                <div key={k} className="flex flex-col gap-0.5 border-b border-line pb-3">
                  <dt className="text-[12.5px] text-muted">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="tasks-title">
            <h2 id="tasks-title" className="mb-3 text-[15px] font-semibold">
              Tasks
            </h2>
            <LeadTasks
              tasks={tasks}
              leadId={lead.id}
              canAssign={viewer.isAdmin}
              defaultAgentId={lead.assigned_agent_id}
              agentOptions={agents.filter((a) => a.is_active).map((a) => ({ id: a.id, name: a.full_name }))}
            />
          </section>

          <section aria-labelledby="notes-title">
            <h2 id="notes-title" className="mb-3 text-[15px] font-semibold">
              Internal notes
            </h2>
            <div className="flex flex-col gap-4">
              <NoteComposer leadId={lead.id} />
              <NotesList notes={notes} leadId={lead.id} viewerId={viewer.userId} isAdmin={viewer.isAdmin} />
            </div>
          </section>
        </div>

        <aside aria-labelledby="history-title" className="flex flex-col gap-8">
          <section aria-labelledby="automation-title">
            <h2 id="automation-title" className="mb-3 text-[15px] font-semibold">
              Automations
            </h2>
            {runs.length === 0 ? (
              <p className="text-sm text-muted">No automation has run for this lead.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {runs.map((r) => (
                  <li key={r.id} className="rounded-lg border border-line bg-surface px-3 py-2.5 text-[13px]">
                    <p className="flex items-center gap-2 font-medium">
                      <span
                        className="size-2 rounded-full"
                        style={{
                          background:
                            r.status === "succeeded" ? "var(--success)" : r.status === "failed" ? "var(--danger)" : r.status === "running" ? "var(--accent)" : "var(--faint)",
                        }}
                        aria-hidden="true"
                      />
                      {r.automation_key === "ai_lead_analysis" ? "AI Lead Analysis" : "New Lead Automation"}
                      <span className="ml-auto font-normal text-muted capitalize">{r.status}</span>
                    </p>
                    <p className="mt-0.5 text-muted">
                      {r.automation_key === "ai_lead_analysis"
                        ? r.status === "succeeded"
                          ? `Analysis stored (${String(r.result?.interest_level ?? "")} interest).`
                          : r.status === "failed"
                            ? (r.error ?? "AI analysis failed.")
                            : "Waiting for the AI workflow."
                        : r.status === "succeeded"
                        ? r.result?.task_created === false
                          ? "Duplicate delivery ignored; task already existed."
                          : "Follow-up task created."
                        : r.status === "failed"
                          ? (r.error ?? "Delivery failed. It will be retried.")
                          : r.status === "skipped"
                            ? (r.error ?? "Skipped.")
                            : "Waiting for n8n."}
                    </p>
                    <p className="mt-0.5 text-[12px] text-faint">
                      {formatDateTime(r.updated_at)}
                      {r.external_execution_id ? `, n8n execution #${r.external_execution_id}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div>
          <h2 id="history-title" className="mb-3 text-[15px] font-semibold">
            History
          </h2>
          {activities.length === 0 ? (
            <p className="text-sm text-muted">No activity yet.</p>
          ) : (
            <ol className="relative flex flex-col gap-4 border-l border-line pl-5">
              {activities.map((a) => {
                const detailText = describeActivity(a, agentName);
                const tone =
                  a.type === "status_changed" && isLeadStatus(a.details?.to) ? STATUS_META[a.details.to].tone : "var(--line-strong)";
                return (
                  <li key={a.id} className="relative text-[13px] leading-snug">
                    <span className="absolute top-1 -left-[25px] size-2.5 rounded-full border-2 border-canvas" style={{ background: tone }} aria-hidden="true" />
                    <p className="font-medium">{ACTIVITY_LABELS[a.type] ?? a.type}</p>
                    {detailText ? <p className="text-muted">{detailText}</p> : null}
                    <p className="mt-0.5 text-[12px] text-faint">
                      {a.actor_label ?? "System"}, <time dateTime={a.created_at}>{formatDateTime(a.created_at)}</time>
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
          </div>
        </aside>
      </div>
    </>
  );
}
