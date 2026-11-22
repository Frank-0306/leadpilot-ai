import { CommandPalette } from "@/components/shell/command-palette";
import { SetupNotice } from "@/components/shell/setup-notice";
import { Sidebar } from "@/components/shell/sidebar";
import { requireViewer } from "@/lib/auth";
import { taskCounts } from "@/lib/data/queries";
import { getPublicSupabaseEnv, missingEnv } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  if (!getPublicSupabaseEnv()) return <SetupNotice missing={missingEnv()} />;

  const viewer = await requireViewer();
  const counts = await taskCounts(viewer.isAdmin ? undefined : (viewer.agent?.id ?? undefined));

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <Sidebar
        isAdmin={viewer.isAdmin}
        userName={viewer.fullName}
        userColor={viewer.agent?.color}
        roleLabel={viewer.isAdmin ? "Admin" : (viewer.agent?.title ?? "Agent")}
        overdueTasks={counts.overdue}
      />
      <main className="min-w-0 flex-1 px-4 pt-5 pb-16 sm:px-6 lg:px-10 lg:pt-8">
        {!viewer.isAdmin && !viewer.agent ? (
          <div className="mb-6 rounded-lg border border-line bg-surface px-4 py-3 text-sm text-muted">
            Your login isn&apos;t linked to an agent profile yet, so there are no leads to show. An admin can link it in Settings → Team.
          </div>
        ) : null}
        <div className="mx-auto max-w-[1280px]">{children}</div>
      </main>
      <CommandPalette />
    </div>
  );
}
