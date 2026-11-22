import { PipelineBoard } from "@/components/pipeline/board";
import { AgentFilter } from "@/components/pipeline/agent-filter";
import { PageHeader } from "@/components/shell/page-header";
import { ButtonLink } from "@/components/ui/button";
import { IconPlus } from "@/components/ui/icons";
import { requireViewer } from "@/lib/auth";
import { listAgents, listPipelineLeads } from "@/lib/data/queries";
import { formatCurrency } from "@/lib/format";
import { Suspense } from "react";
import { z } from "zod";

export const metadata = { title: "Pipeline" };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const raw = typeof sp.agent === "string" ? sp.agent : undefined;
  const agent = viewer.isAdmin && (raw === "unassigned" || z.uuid().safeParse(raw).success) ? raw : undefined;

  const [leads, agents] = await Promise.all([listPipelineLeads(agent), listAgents()]);
  const open = leads.filter((l) => !["won", "lost"].includes(l.status));
  const openValue = open.reduce((s, l) => s + (l.budget ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Pipeline"
        description={`${open.length} open deals worth ${formatCurrency(openValue, true)}. Drag a card to change its stage, or use its Move to menu.`}
        actions={
          <>
            {viewer.isAdmin ? (
              <Suspense>
                <AgentFilter agents={agents} value={agent} />
              </Suspense>
            ) : null}
            <ButtonLink href="/leads/new" variant="primary">
              <IconPlus size={16} /> New lead
            </ButtonLink>
          </>
        }
      />
      <PipelineBoard key={agent ?? "all"} initialLeads={leads} agents={agents} />
    </>
  );
}
