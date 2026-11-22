import { createLeadAction } from "@/app/actions/leads";
import { LeadForm } from "@/components/leads/lead-form";
import { PageHeader } from "@/components/shell/page-header";
import { requireViewer } from "@/lib/auth";
import { listAgents } from "@/lib/data/queries";

export const metadata = { title: "New lead" };

export default async function NewLeadPage() {
  const viewer = await requireViewer();
  const agents = await listAgents();
  return (
    <div className="max-w-3xl">
      <PageHeader title="New lead" description="Add a prospect by hand, e.g. from a call or an open house." />
      <LeadForm
        action={createLeadAction}
        agents={agents}
        canAssign={viewer.isAdmin}
        defaultAgentId={viewer.agent?.id ?? null}
        cancelHref="/leads"
      />
    </div>
  );
}
