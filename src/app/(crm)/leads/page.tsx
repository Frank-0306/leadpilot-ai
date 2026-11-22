import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/field";
import { IconChevronLeft, IconChevronRight, IconPlus, IconSearch } from "@/components/ui/icons";
import { StageBadge, StageRail } from "@/components/ui/stage";
import { FlashToast } from "@/components/ui/toast";
import { requireViewer } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { LEADS_PAGE_SIZE, listAgents, listLeads } from "@/lib/data/queries";
import { LEAD_SOURCES, LEAD_STATUSES, PROPERTY_LABELS, SOURCE_LABELS, STATUS_META } from "@/lib/domain";
import { formatCurrency, formatRelative } from "@/lib/format";
import { leadFiltersSchema } from "@/lib/validation";

export const metadata = { title: "Leads" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const filters = leadFiltersSchema.parse(sp);
  const [{ rows, count, page }, agents] = await Promise.all([listLeads(filters), listAgents()]);
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const pages = Math.max(1, Math.ceil(count / LEADS_PAGE_SIZE));
  const hasFilters = !!(filters.q || filters.status || filters.source || filters.agent);

  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v && k !== "page") params.set(k, String(v));
    if (p > 1) params.set("page", String(p));
    return `/leads${params.size ? `?${params}` : ""}`;
  };

  return (
    <>
      <FlashToast flash={typeof sp.flash === "string" ? sp.flash : undefined} />
      <PageHeader
        title="Leads"
        description={`${count} ${count === 1 ? "lead" : "leads"}${hasFilters ? " match these filters" : viewer.isAdmin ? " across the team" : " assigned to you"}.`}
        actions={
          <ButtonLink href="/leads/new" variant="primary">
            <IconPlus size={16} /> New lead
          </ButtonLink>
        }
      />

      {/* Plain GET form: filters live in the URL, work without JavaScript and are shareable. */}
      <form className="mb-4 flex flex-wrap gap-2" role="search" aria-label="Filter leads">
        <div className="relative min-w-[220px] flex-1">
          <IconSearch size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          <label htmlFor="q" className="sr-only">
            Search leads
          </label>
          <Input id="q" name="q" defaultValue={filters.q ?? ""} placeholder="Name, email, phone, area…" className="pl-9" />
        </div>
        <label htmlFor="f-status" className="sr-only">
          Stage
        </label>
        <Select id="f-status" name="status" defaultValue={filters.status ?? ""} className="w-auto">
          <option value="">All stages</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </Select>
        <label htmlFor="f-source" className="sr-only">
          Source
        </label>
        <Select id="f-source" name="source" defaultValue={filters.source ?? ""} className="w-auto">
          <option value="">All sources</option>
          {LEAD_SOURCES.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
            </option>
          ))}
        </Select>
        {viewer.isAdmin ? (
          <>
            <label htmlFor="f-agent" className="sr-only">
              Agent
            </label>
            <Select id="f-agent" name="agent" defaultValue={filters.agent ?? ""} className="w-auto">
              <option value="">All agents</option>
              <option value="unassigned">Unassigned</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.full_name}
                </option>
              ))}
            </Select>
          </>
        ) : null}
        <label htmlFor="f-sort" className="sr-only">
          Sort
        </label>
        <Select id="f-sort" name="sort" defaultValue={filters.sort ?? "newest"} className="w-auto">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="follow_up">Next follow-up</option>
          <option value="budget">Highest budget</option>
        </Select>
        <button type="submit" className={buttonClass("secondary")}>
          Apply
        </button>
        {hasFilters ? (
          <Link href="/leads" className={buttonClass("ghost")}>
            Clear
          </Link>
        ) : null}
      </form>

      {rows.length === 0 ? (
        hasFilters ? (
          <EmptyState title="No leads match these filters" body="Try a broader search or clear the filters." action={<ButtonLink href="/leads">Clear filters</ButtonLink>} />
        ) : (
          <EmptyState
            title="No leads yet"
            body="Leads from the Northstar website form appear here automatically. You can also add one by hand."
            action={
              <ButtonLink href="/leads/new" variant="primary">
                Add the first lead
              </ButtonLink>
            }
          />
        )
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          {/* Desktop table */}
          <table className="hidden w-full text-sm md:table">
            <thead>
              <tr className="border-b border-line text-left text-[12.5px] text-muted">
                <th className="px-4 py-2.5 font-normal">Lead</th>
                <th className="px-4 py-2.5 font-normal">Stage</th>
                <th className="px-4 py-2.5 font-normal">Looking for</th>
                <th className="px-4 py-2.5 text-right font-normal">Budget</th>
                <th className="px-4 py-2.5 font-normal">Agent</th>
                <th className="px-4 py-2.5 font-normal">Follow-up</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((lead) => {
                const agent = lead.assigned_agent_id ? agentById.get(lead.assigned_agent_id) : undefined;
                const overdue = lead.next_follow_up_at && new Date(lead.next_follow_up_at) < new Date() && !["won", "lost"].includes(lead.status);
                return (
                  <tr key={lead.id} className="group relative border-b border-line last:border-0 hover:bg-sunken/50">
                    <td className="px-4 py-3">
                      <Link href={`/leads/${lead.id}`} className="font-medium after:absolute after:inset-0 focus-visible:outline-none">
                        {lead.full_name}
                      </Link>
                      <p className="max-w-[240px] truncate text-[12.5px] text-muted">
                        {SOURCE_LABELS[lead.source]}, {formatRelative(lead.created_at)}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <StageBadge status={lead.status} />
                      <StageRail status={lead.status} className="mt-1.5 w-24" />
                    </td>
                    <td className="max-w-[260px] px-4 py-3">
                      <p className="truncate">{lead.property_type ? PROPERTY_LABELS[lead.property_type] : "—"}</p>
                      <p className="truncate text-[12.5px] text-muted">{lead.preferred_area ?? lead.property_interest ?? ""}</p>
                    </td>
                    <td className="tabular px-4 py-3 text-right">{formatCurrency(lead.budget)}</td>
                    <td className="px-4 py-3">
                      {agent ? (
                        <span className="flex items-center gap-2">
                          <Avatar name={agent.full_name} color={agent.color} size={22} />
                          <span className="truncate">{agent.full_name.split(" ")[0]}</span>
                        </span>
                      ) : (
                        <span className="text-faint">Unassigned</span>
                      )}
                    </td>
                    <td className={cn("px-4 py-3 whitespace-nowrap", overdue ? "font-medium text-danger" : "text-muted")}>
                      {lead.next_follow_up_at ? formatRelative(lead.next_follow_up_at) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Mobile list */}
          <ul className="md:hidden">
            {rows.map((lead) => {
              const agent = lead.assigned_agent_id ? agentById.get(lead.assigned_agent_id) : undefined;
              return (
                <li key={lead.id} className="border-b border-line last:border-0">
                  <Link href={`/leads/${lead.id}`} className="flex flex-col gap-1.5 px-4 py-3 active:bg-sunken">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium">{lead.full_name}</span>
                      <span className="tabular text-sm text-muted">{formatCurrency(lead.budget, true)}</span>
                    </span>
                    <StageRail status={lead.status} />
                    <span className="flex items-center justify-between text-[12.5px] text-muted">
                      <StageBadge status={lead.status} className="text-[12.5px]" />
                      <span>{agent ? agent.full_name : "Unassigned"}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {pages > 1 ? (
        <nav className="mt-4 flex items-center justify-between text-sm text-muted" aria-label="Pagination">
          <span className="tabular">
            Page {page} of {pages}
          </span>
          <span className="flex gap-2">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className={buttonClass("secondary", "sm")}>
                <IconChevronLeft size={14} /> Previous
              </Link>
            ) : null}
            {page < pages ? (
              <Link href={pageHref(page + 1)} className={buttonClass("secondary", "sm")}>
                Next <IconChevronRight size={14} />
              </Link>
            ) : null}
          </span>
        </nav>
      ) : null}
    </>
  );
}
