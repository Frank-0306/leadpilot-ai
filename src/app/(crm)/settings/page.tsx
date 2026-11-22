import { LinkLoginSelect, ResetDemoButton, RoleSelect } from "@/components/admin/admin-buttons";
import { PageHeader } from "@/components/shell/page-header";
import { Avatar } from "@/components/ui/avatar";
import { requireAdmin } from "@/lib/auth";
import { listAgents } from "@/lib/data/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const viewer = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const [agents, { data: profiles }, demo] = await Promise.all([
    listAgents(),
    supabase.from("profiles").select("id, email, full_name, role").order("created_at"),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("is_demo", true),
  ]);
  const users = ((profiles ?? []) as { id: string; email: string; full_name: string; role: "admin" | "agent" }[]).map((p) => ({
    ...p,
    label: p.full_name ? `${p.full_name} (${p.email})` : p.email,
  }));

  return (
    <>
      <PageHeader title="Settings" description="Team access and demo data for the Northstar workspace." />

      <section className="mb-10" aria-labelledby="users-title">
        <h2 id="users-title" className="mb-1 text-[15px] font-semibold">
          Users
        </h2>
        <p className="mb-4 text-sm text-muted">
          People sign in with Supabase Auth. Invite them from the Supabase dashboard (Authentication → Users); they join as agents.
        </p>
        <ul className="overflow-hidden rounded-xl border border-line bg-surface">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-0">
              <Avatar name={u.full_name || u.email} size={26} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{u.full_name || u.email}</p>
                <p className="truncate text-[12.5px] text-muted">{u.email}</p>
              </div>
              {u.id === viewer.userId ? <span className="text-[13px] text-muted">Admin (you)</span> : <RoleSelect userId={u.id} value={u.role} label={u.label} />}
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-10" aria-labelledby="team-title">
        <h2 id="team-title" className="mb-1 text-[15px] font-semibold">
          Sales team
        </h2>
        <p className="mb-4 text-sm text-muted">
          Link an agent to a login so that person sees the agent&apos;s leads and tasks. An agent login only sees its own records.
        </p>
        <ul className="overflow-hidden rounded-xl border border-line bg-surface">
          {agents.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-0">
              <Avatar name={a.full_name} color={a.color} size={26} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {a.full_name}
                  {a.is_demo ? <span className="ml-2 rounded border border-line px-1 text-[11px] font-normal text-muted">Demo</span> : null}
                </p>
                <p className="text-[12.5px] text-muted">{a.title}</p>
              </div>
              <LinkLoginSelect agentId={a.id} agentName={a.full_name} value={a.user_id} users={users.map((u) => ({ id: u.id, label: u.label }))} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="demo-title" className="rounded-xl border border-line bg-surface p-5">
        <h2 id="demo-title" className="mb-1 text-[15px] font-semibold">
          Demo data
        </h2>
        <p className="mb-4 max-w-2xl text-sm text-muted">
          This workspace contains {demo.count ?? 0} fictional leads for Northstar Realty, each marked as demo data. Resetting restores them to their original
          state. Real leads (for example from the website form), users and agent logins are kept.
        </p>
        <ResetDemoButton />
      </section>
    </>
  );
}
