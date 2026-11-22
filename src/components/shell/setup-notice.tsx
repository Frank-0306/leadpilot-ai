/** Shown instead of the CRM when Supabase environment variables are missing. */
export function SetupNotice({ missing }: { missing: string[] }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Connect Supabase to start</h1>
      <p className="text-muted">
        LeadPilot stores leads, tasks and users in Supabase. Add these variables to <code className="rounded bg-sunken px-1">.env.local</code>{" "}
        (or your Vercel project) and restart the server:
      </p>
      <ul className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4 text-sm">
        {missing.map((m) => (
          <li key={m}>
            <code>{m}</code>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">The README walks through creating the project and running the migrations.</p>
    </main>
  );
}
