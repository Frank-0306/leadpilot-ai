import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function LeadNotFound() {
  return (
    <EmptyState
      title="This lead isn't available"
      body="It may have been deleted, or it's assigned to another agent."
      action={<ButtonLink href="/leads">Back to leads</ButtonLink>}
    />
  );
}
