import Link from "next/link";
import { Suspense } from "react";
import { DashboardFilters } from "@/components/dashboard/dashboard-filters";
import { LeadsChart } from "@/components/dashboard/leads-chart";
import { PageHeader } from "@/components/shell/page-header";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";
import { IconPlus } from "@/components/ui/icons";
import { ACTIVITY_LABELS, SOURCE_LABELS, STATUS_META, type LeadStatus } from "@/lib/domain";
import { formatCurrency, formatRelative, percentChange } from "@/lib/format";
import type { Activity, Agent, DashboardMetrics } from "@/lib/types";
import type { ResolvedRange } from "@/lib/date-range";

function Delta({ current, previous, suffix = "vs. previous period" }: { current: number; previous: number; suffix?: string }) {
  const change = percentChange(current, previous);
  if (change === null) return <span className="text-muted">No earlier data</span>;
  const tone = change > 0 ? "text-success" : change < 0 ? "text-danger" : "text-muted";
  return (
    <span className="text-muted">
      <span className={`tabular font-medium ${tone}`}>
        {change > 0 ? "+" : ""}
        {change}%
      </span>{" "}
      {suffix}
    </span>
  );
}

export interface DashboardViewProps {
  metrics: DashboardMetrics;
  agents: Agent[];
  activity: (Activity & { lead: { id: string; full_name: string } | null })[];
  range: ResolvedRange;
  agentFilter?: string;
  isAdmin: boolean;
  firstName: string;
  denied?: boolean;
}

/** Presentational dashboard. Data loading lives in app/(crm)/dashboard/page.tsx. */
export function DashboardView({ metrics, agents, activity, range, agentFilter, isAdmin, firstName, denied }: DashboardViewProps) {
  const closed = metrics.won + metrics.lost;
  const winRate = closed > 0 ? Math.round((metrics.won / closed) * 100) : null;
  const openPipeline = metrics.pipeline.filter((p) => !["won", "lost"].includes(p.status));
  const openTotal = openPipeline.reduce((s, p) => s + p.count, 0);
  const maxSource = Math.max(1, ...metrics.by_source.map((s) => s.count));


  return (
    <>
      {denied ? (
        <p className="mb-4 rounded-md border border-line bg-surface px-3 py-2 text-sm text-muted" role="status">
          That page is only available to admins.
        </p>
      ) : null}

      <PageHeader
        title={`Good to see you, ${firstName}`}
        description={
          isAdmin
            ? `${range.label} across the Northstar team.`
            : `${range.label} for your leads.`
        }
        actions={
          <ButtonLink href="/leads/new" variant="primary">
            <IconPlus size={16} /> New lead
          </ButtonLink>
        }
      />

      <div className="mb-6">
        <Suspense>
          <DashboardFilters
            rangeKey={range.key}
            fromDate={range.fromDate}
            toDate={range.toDate}
            agent={agentFilter}
            agents={agents}
            showAgentFilter={isAdmin}
          />
        </Suspense>
      </div>

      {/* Ledger of headline numbers: one strip, not a grid of cards. */}
      <section aria-label="Key numbers" className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-5">
        {[
          {
            label: "Total leads",
            value: metrics.total_leads,
            foot: <span className="text-muted">{metrics.awaiting_first_contact} waiting for first contact</span>,
            href: "/leads",
          },
          {
            label: "New leads",
            value: metrics.new_leads,
            foot: <Delta current={metrics.new_leads} previous={metrics.new_leads_previous} />,
            href: "/leads?sort=newest",
          },
          {
            label: "Active opportunities",
            value: metrics.active_opportunities,
            foot: <span className="text-muted">{formatCurrency(metrics.active_pipeline_value, true)} in play</span>,
            href: "/pipeline",
          },
          {
            label: "Pending tasks",
            value: metrics.pending_tasks,
            foot:
              metrics.overdue_tasks > 0 ? (
                <span className="font-medium text-danger">{metrics.overdue_tasks} overdue</span>
              ) : (
                <span className="text-muted">Nothing overdue</span>
              ),
            href: metrics.overdue_tasks > 0 ? "/tasks?view=overdue" : "/tasks",
          },
          {
            label: "Conversions",
            value: metrics.won,
            foot: (
              <span className="text-muted">
                {winRate === null ? "No deals closed yet" : `${winRate}% win rate, ${formatCurrency(metrics.won_value, true)}`}
              </span>
            ),
            href: "/pipeline",
          },
        ].map((kpi, i) => (
          <Link
            key={kpi.label}
            href={kpi.href}
            className={`flex flex-col gap-1 bg-surface px-5 py-4 transition-colors hover:bg-sunken ${i === 4 ? "col-span-2 md:col-span-1" : ""}`}
          >
            <span className="text-[13px] text-muted">{kpi.label}</span>
            <span className="tabular text-[28px] leading-tight font-semibold tracking-[-0.02em]">{kpi.value}</span>
            <span className="text-[12.5px]">{kpi.foot}</span>
          </Link>
        ))}
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <section className="rounded-xl border border-line bg-surface p-5" aria-labelledby="trend-title">
          <h2 id="trend-title" className="mb-4 text-[15px] font-semibold">
            Lead flow
          </h2>
          <LeadsChart series={metrics.series} />
        </section>

        <section className="rounded-xl border border-line bg-surface p-5" aria-labelledby="pipeline-title">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 id="pipeline-title" className="text-[15px] font-semibold">
              Pipeline
            </h2>
            <Link href="/pipeline" className="text-[13px] text-accent hover:underline">
              Open board
            </Link>
          </div>
          {/* Proportional strip of open deals by stage. */}
          <div className="mb-5 flex h-2.5 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
            {openPipeline.map((p) =>
              p.count > 0 ? (
                <span key={p.status} style={{ width: `${(p.count / Math.max(openTotal, 1)) * 100}%`, background: STATUS_META[p.status].tone }} />
              ) : null,
            )}
          </div>
          <ul className="flex flex-col">
            {metrics.pipeline.map((p) => (
              <li key={p.status} className="flex items-center gap-3 border-t border-line py-2 text-sm first:border-t-0">
                <span className="size-2 rounded-[2px]" style={{ background: STATUS_META[p.status as LeadStatus].tone }} aria-hidden="true" />
                <span className="flex-1">{STATUS_META[p.status as LeadStatus].label}</span>
                <span className="tabular w-8 text-right font-medium">{p.count}</span>
                <span className="tabular w-20 text-right text-muted">{formatCurrency(p.value, true)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="rounded-xl border border-line bg-surface p-5" aria-labelledby="sources-title">
          <h2 id="sources-title" className="mb-4 text-[15px] font-semibold">
            Where new leads came from
          </h2>
          {metrics.by_source.length === 0 ? (
            <p className="text-sm text-muted">No new leads in this period.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {metrics.by_source.map((s) => (
                <li key={s.source} className="grid grid-cols-[96px_1fr_28px] items-center gap-3 text-[13px]">
                  <span className="truncate text-muted">{SOURCE_LABELS[s.source]}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-sunken">
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${(s.count / maxSource) * 100}%` }} />
                  </span>
                  <span className="tabular text-right font-medium">{s.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-line bg-surface p-5" aria-labelledby="agents-title">
          <h2 id="agents-title" className="mb-3 text-[15px] font-semibold">
            {isAdmin ? "Agents" : "Your results"}
          </h2>
          {metrics.agents.length === 0 ? (
            <p className="text-sm text-muted">No assigned leads yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[12.5px] text-muted">
                  <th className="pb-2 font-normal">Agent</th>
                  <th className="pb-2 text-right font-normal">Open</th>
                  <th className="pb-2 text-right font-normal">Won</th>
                </tr>
              </thead>
              <tbody>
                {metrics.agents.map((a) => (
                  <tr key={a.agent_id} className="border-t border-line">
                    <td className="py-2">
                      <span className="flex items-center gap-2">
                        <Avatar name={a.full_name} color={a.color} size={22} />
                        <span className="truncate">{a.full_name}</span>
                      </span>
                    </td>
                    <td className="tabular py-2 text-right">{a.open}</td>
                    <td className="tabular py-2 text-right font-medium">{a.won}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="rounded-xl border border-line bg-surface p-5" aria-labelledby="activity-title">
          <h2 id="activity-title" className="mb-3 text-[15px] font-semibold">
            Latest activity
          </h2>
          {activity.length === 0 ? (
            <p className="text-sm text-muted">Activity on your leads will show up here.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {activity.map((a) => (
                <li key={a.id} className="flex flex-col text-[13px] leading-snug">
                  <span>
                    {a.lead ? (
                      <Link href={`/leads/${a.lead.id}`} className="font-medium hover:underline">
                        {a.lead.full_name}
                      </Link>
                    ) : (
                      "Lead"
                    )}{" "}
                    <span className="text-muted">— {(ACTIVITY_LABELS[a.type] ?? a.type).toLowerCase()}</span>
                  </span>
                  <span className="text-faint">
                    {a.actor_label ?? "System"}, {formatRelative(a.created_at)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}
