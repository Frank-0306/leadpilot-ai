import { notFound } from "next/navigation";
import { updateLeadAction } from "@/app/actions/leads";
import { LeadForm } from "@/components/leads/lead-form";
import { PageHeader } from "@/components/shell/page-header";
import { requireViewer } from "@/lib/auth";
import { getLeadDetail, listAgents } from "@/lib/data/queries";
import { z } from "zod";

export const metadata = { title: "Edit lead" };

export default async function EditLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const viewer = await requireViewer();
  const [detail, agents] = await Promise.all([getLeadDetail(id), listAgents()]);
  if (!detail) notFound();

  return (
    <div className="max-w-3xl">
      <PageHeader title={`Edit ${detail.lead.full_name}`} />
      <LeadForm
        action={updateLeadAction.bind(null, id)}
        lead={detail.lead}
        agents={agents}
        canAssign={viewer.isAdmin}
        cancelHref={`/leads/${id}`}
      />
    </div>
  );
}
