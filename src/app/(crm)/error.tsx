"use client";

import { Button } from "@/components/ui/button";

export default function CrmError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-line bg-surface p-6" role="alert">
      <h1 className="text-lg font-semibold">This page couldn&apos;t load</h1>
      <p className="max-w-xl text-sm text-muted">
        The server didn&apos;t answer as expected. Your data is safe. Try again, and if it keeps happening check the Supabase connection.
      </p>
      {error.digest ? <p className="text-[12px] text-faint">Reference: {error.digest}</p> : null}
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
