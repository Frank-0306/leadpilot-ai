import { headers } from "next/headers";
import Link from "next/link";
import { AutomationSettingsForm, ProcessQueueButton, RetryEventButton } from "@/components/admin/automation-controls";
import { ScanOverdueButton } from "@/components/admin/admin-buttons";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { requireAdmin } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { lastDeliveryAttempt, listAutomationStats, listEventDeliveries, listEvents, listRunsByEvent } from "@/lib/data/queries";
import { dispatchStatus, readDispatchConfig, webhookUrl } from "@/lib/events/dispatcher";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { AutomationRun } from "@/lib/types";

export const metadata = { title: "Automations" };

const EVENT_STATUS_STYLE: Record<string, string> = {
  pending: "text-muted",
  processing: "text-accent",
  delivered: "text-success",
  failed: "text-warning",
  dead: "text-danger",
  skipped: "text-faint",
};

const RUN_STATUS: Record<AutomationRun["status"], { label: string; tone: string }> = {
  queued: { label: "Queued", tone: "var(--faint)" },
  running: { label: "Running", tone: "var(--accent)" },
  succeeded: { label: "Succeeded", tone: "var(--success)" },
  failed: { label: "Failed", tone: "var(--danger)" },
  skipped: { label: "Skipped", tone: "var(--faint)" },
};

const CONNECTION_COPY = {
  ready: { title: "Connected to n8n", tone: "var(--success)" },
  failing: { title: "Last delivery to n8n failed", tone: "var(--danger)" },
  disabled: { title: "n8n configured, dispatch paused", tone: "var(--warning)" },
  not_configured: { title: "n8n not connected", tone: "var(--faint)" },
  invalid_url: { title: "n8n URL rejected", tone: "var(--danger)" },
} as const;

function RunDot({ status }: { status: AutomationRun["status"] }) {
  return <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: RUN_STATUS[status].tone }} aria-hidden="true" />;
}

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireAdmin();
  const sp = await searchParams;
  const status = typeof sp.status === "string" && sp.status in EVENT_STATUS_STYLE ? sp.status : undefined;

  const config = readDispatchConfig();
  const configStatus = dispatchStatus(config);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"}`;
  const callbackConfigured = (process.env.AUTOMATION_CALLBACK_SECRET ?? "").length >= 16;

  const [stats, { rows, counts }, lastAttempt] = await Promise.all([listAutomationStats(), listEvents(status), lastDeliveryAttempt()]);
  // "Connected" only when configured AND the most recent delivery worked.
  const connection: keyof typeof CONNECTION_COPY =
    configStatus === "ready" && lastAttempt && !lastAttempt.success ? "failing" : configStatus;
  const eventIds = rows.map((r) => r.id);
  const [runs, deliveries] = await Promise.all([listRunsByEvent(eventIds), listEventDeliveries(eventIds)]);
  const lastDelivered = rows.find((r) => r.status === "delivered");

  return (
    <>
      <PageHeader
        title="Automations"
        description="Workflows that run in n8n when something happens in the CRM. Every run is recorded here."
        actions={
          <>
            <ScanOverdueButton />
            <ProcessQueueButton />
          </>
        }
      />

      {/* Connection */}
      <section aria-labelledby="conn-title" className="mb-8 grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-2 bg-surface p-5">
          <h2 id="conn-title" className="flex items-center gap-2 text-[15px] font-semibold">
            <span className="size-2 rounded-full" style={{ background: CONNECTION_COPY[connection].tone }} aria-hidden="true" />
            {CONNECTION_COPY[connection].title}
          </h2>
          <p className="max-w-xl text-sm text-muted">
            {connection === "failing"
              ? `${lastAttempt?.error ?? "Delivery failed"} (${formatRelative(lastAttempt?.created_at)}). Events wait in the queue and are retried automatically; you can also retry them below.`
              : connection === "ready"
              ? lastDelivered
                ? `Last successful delivery ${formatRelative(lastDelivered.delivered_at ?? lastDelivered.created_at)}.`
                : "Waiting for the first event. Create a lead or submit the Northstar form."
              : connection === "disabled"
                ? "Events are recorded and wait in the queue. Set EVENTS_DISPATCH_ENABLED=true to start sending them."
                : connection === "invalid_url"
                  ? "N8N_BASE_URL must use https. Plain http is only allowed for a local n8n on localhost."
                  : "Events are recorded and wait in the queue. Add N8N_BASE_URL and N8N_WEBHOOK_SECRET to connect (see docs/n8n-setup.md)."}
          </p>
          {!callbackConfigured ? (
            <p className="text-sm font-medium text-warning">AUTOMATION_CALLBACK_SECRET is missing, so n8n can&apos;t create tasks in LeadPilot yet.</p>
          ) : null}
        </div>
        <dl className="grid gap-3 bg-surface p-5 text-[13px]">
          <div>
            <dt className="text-muted">n8n instance</dt>
            <dd className="truncate">{config.baseUrl ?? "Not set"}</dd>
          </div>
          <div>
            <dt className="text-muted">Callback URL for n8n</dt>
            <dd>
              <code className="break-all">{origin}/api/automations/callback</code>
            </dd>
          </div>
          {config.mode === "test" ? (
            <div>
              <dt className="text-muted">Mode</dt>
              <dd className="text-warning">Test (posting to /webhook-test/)</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {/* Workflows */}
      <section aria-labelledby="wf-title" className="mb-10">
        <h2 id="wf-title" className="mb-3 text-[15px] font-semibold">
          Workflows
        </h2>
        <ul className="flex flex-col gap-4">
          {stats.map(({ automation: a, succeeded, failed, pending, lastRun }) => (
            <li key={a.key} className="rounded-xl border border-line bg-surface">
              <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex max-w-2xl flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[15px] font-semibold">{a.name}</h3>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[11.5px] font-medium",
                        a.enabled && configStatus === "ready" ? "bg-[color:var(--success)]/12 text-success" : "bg-sunken text-muted",
                      )}
                    >
                      {!a.enabled ? "Paused" : configStatus === "ready" ? "Active" : "Waiting for n8n"}
                    </span>
                  </div>
                  <p className="text-sm text-muted">{a.description}</p>
                  <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted">
                    <span>
                      Trigger{" "}
                      <code className="text-ink">{a.trigger_event.startsWith("manual.") ? "Agent clicks “Generate analysis”" : a.trigger_event}</code>
                    </span>
                    <span className="break-all">
                      Webhook <code className="text-ink">{config.baseUrl ? webhookUrl(config, a.webhook_path) : `/webhook/${a.webhook_path}`}</code>
                    </span>
                  </p>
                </div>
                {viewer.isDemo ? (
                  <span className="text-[13px] text-muted">{a.enabled ? "Active" : "Paused"} (read-only in the demo)</span>
                ) : (
                  <AutomationSettingsForm
                    automationKey={a.key}
                    enabled={a.enabled}
                    followUpHours={a.key === "new_lead_follow_up" ? Number(a.settings.follow_up_hours ?? 24) : null}
                  />
                )}
              </div>
              <dl className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
                <div className="bg-surface px-5 py-3">
                  <dt className="text-[12.5px] text-muted">Successful runs</dt>
                  <dd className="tabular text-xl font-semibold text-success">{succeeded}</dd>
                </div>
                <div className="bg-surface px-5 py-3">
                  <dt className="text-[12.5px] text-muted">{a.trigger_event.startsWith("manual.") ? "Failed runs" : "Failed attempts"}</dt>
                  <dd className={cn("tabular text-xl font-semibold", failed ? "text-danger" : "")}>{failed}</dd>
                </div>
                <div className="bg-surface px-5 py-3">
                  <dt className="text-[12.5px] text-muted">Waiting</dt>
                  <dd className="tabular text-xl font-semibold">{pending}</dd>
                </div>
                <div className="bg-surface px-5 py-3">
                  <dt className="text-[12.5px] text-muted">Last run</dt>
                  <dd className="text-sm">
                    {lastRun ? (
                      <span className="flex items-center gap-1.5">
                        <RunDot status={lastRun.status} />
                        {RUN_STATUS[lastRun.status].label}, {formatRelative(lastRun.updated_at)}
                      </span>
                    ) : (
                      <span className="text-muted">Never</span>
                    )}
                  </dd>
                </div>
              </dl>
              {lastRun?.status === "failed" && lastRun.error ? (
                <p className="border-t border-line px-5 py-3 text-[13px] text-danger">Last error: {lastRun.error}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {/* Event history */}
      <section aria-labelledby="events-title">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="events-title" className="text-[15px] font-semibold">
            Event history
          </h2>
          <nav className="flex flex-wrap gap-1" aria-label="Filter events by status">
            {[undefined, "pending", "delivered", "failed", "dead", "skipped"].map((s) => (
              <Link
                key={s ?? "all"}
                href={s ? `/automations?status=${s}` : "/automations"}
                aria-current={s === status ? "page" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[13px] capitalize",
                  s === status ? "bg-surface font-medium shadow-[0_0_0_1px_var(--line)]" : "text-muted hover:bg-sunken",
                )}
              >
                {s ?? "All"}
                {s ? <span className="tabular ml-1.5 text-faint">{counts[s] ?? 0}</span> : null}
              </Link>
            ))}
          </nav>
        </div>

        {rows.length === 0 ? (
          <EmptyState title="No events here" body="Create a lead or submit the Northstar form and its lead.created event appears here." />
        ) : (
          <ul className="overflow-hidden rounded-xl border border-line bg-surface">
            {rows.map((e) => {
              const data = (e.payload?.data ?? {}) as Record<string, unknown>;
              const name = typeof data.full_name === "string" ? data.full_name : typeof data.title === "string" ? data.title : null;
              const leadId = e.aggregate_type === "lead" ? e.aggregate_id : typeof data.lead_id === "string" ? data.lead_id : null;
              const run = runs.get(e.id);
              const attempts = deliveries.get(e.id) ?? [];
              const taskId = typeof run?.result?.task_id === "string" ? run.result.task_id : null;
              const canRetry = ["failed", "dead", "skipped"].includes(e.status);
              return (
                <li key={e.id} className="border-b border-line last:border-0">
                  <details className="group">
                    <summary className="grid cursor-pointer list-none grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-sunken/50 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_120px_150px_auto]">
                      <span className="min-w-0">
                        <code className="text-[13px]">{e.type}</code>
                        <span className="block truncate text-[12.5px] text-muted">{name ?? "—"}</span>
                      </span>
                      <span className={cn("text-[13px] capitalize md:order-none", EVENT_STATUS_STYLE[e.status])}>
                        {e.status}
                        {e.attempts > 1 ? <span className="tabular text-faint"> · {e.attempts} attempts</span> : null}
                      </span>
                      <span className="hidden items-center gap-1.5 text-[13px] md:flex">
                        {run ? (
                          <>
                            <RunDot status={run.status} /> {RUN_STATUS[run.status].label}
                          </>
                        ) : (
                          <span className="text-faint">No run</span>
                        )}
                      </span>
                      <span className="hidden text-[13px] whitespace-nowrap text-muted md:block">{formatDateTime(e.created_at)}</span>
                      <span className="hidden text-[12.5px] text-faint group-open:rotate-90 md:block" aria-hidden="true">
                        ›
                      </span>
                    </summary>

                    <div className="flex flex-col gap-4 border-t border-line bg-sunken/40 px-4 py-4 text-[13px]">
                      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
                        <div>
                          <dt className="text-muted">Idempotency key</dt>
                          <dd className="break-all">
                            <code>{e.idempotency_key}</code>
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted">Record</dt>
                          <dd>
                            {leadId ? (
                              <Link href={`/leads/${leadId}`} className="text-accent hover:underline">
                                Open lead
                              </Link>
                            ) : (
                              "—"
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted">n8n execution</dt>
                          <dd>{run?.external_execution_id ? `#${run.external_execution_id}` : "—"}</dd>
                        </div>
                        <div>
                          <dt className="text-muted">Result</dt>
                          <dd>
                            {taskId ? (run?.result?.task_created === false ? "Task already existed (duplicate delivery)" : "Follow-up task created") : "—"}
                          </dd>
                        </div>
                      </dl>

                      {e.last_error && e.status !== "delivered" ? (
                        <p className="rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-danger">{e.last_error}</p>
                      ) : null}

                      {attempts.length > 0 ? (
                        <table className="w-full max-w-2xl text-left">
                          <caption className="mb-1 text-left text-muted">Delivery attempts</caption>
                          <thead>
                            <tr className="text-[12px] text-faint">
                              <th className="py-1 font-normal">#</th>
                              <th className="py-1 font-normal">Result</th>
                              <th className="py-1 font-normal">HTTP</th>
                              <th className="py-1 font-normal">Time</th>
                              <th className="py-1 font-normal">When</th>
                            </tr>
                          </thead>
                          <tbody>
                            {attempts.map((d, i) => (
                              <tr key={i} className="border-t border-line align-top">
                                <td className="tabular py-1.5">{d.attempt}</td>
                                <td className={cn("py-1.5", d.success ? "text-success" : "text-danger")}>
                                  {d.success ? "Delivered" : (d.error ?? "Failed")}
                                </td>
                                <td className="tabular py-1.5">{d.response_status ?? "—"}</td>
                                <td className="tabular py-1.5">{d.duration_ms != null ? `${d.duration_ms} ms` : "—"}</td>
                                <td className="py-1.5 whitespace-nowrap text-muted">{formatDateTime(d.created_at)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p className="text-muted">Not sent yet.</p>
                      )}

                      {canRetry ? (
                        <div>
                          <RetryEventButton eventId={e.id} />
                        </div>
                      ) : null}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
