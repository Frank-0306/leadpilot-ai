import { DashboardView } from "@/components/dashboard/dashboard-view";
import { requireViewer } from "@/lib/auth";
import { getDashboardMetrics, listAgents, listRecentActivity } from "@/lib/data/queries";
import { resolveRange } from "@/lib/date-range";
import { z } from "zod";

export const metadata = { title: "Dashboard" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);

  const range = resolveRange({ range: str("range"), from: str("from"), to: str("to") });
  const agentParam = z.uuid().safeParse(str("agent")).success ? str("agent") : undefined;
  const agentFilter = viewer.isAdmin ? agentParam : undefined;

  // Every number is computed in Postgres from stored rows, scoped by RLS.
  const [metrics, agents, activity] = await Promise.all([
    getDashboardMetrics(range.from, range.to, agentFilter),
    listAgents(),
    listRecentActivity(8),
  ]);

  return (
    <DashboardView
      metrics={metrics}
      agents={agents}
      activity={activity}
      range={range}
      agentFilter={agentFilter}
      isAdmin={viewer.isAdmin}
      firstName={viewer.fullName.split(" ")[0] ?? viewer.fullName}
      denied={!!str("denied")}
    />
  );
}
