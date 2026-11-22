import Link from "next/link";
import { SetupNotice } from "@/components/shell/setup-notice";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { getDemoCredentials, getPublicSupabaseEnv, missingEnv } from "@/lib/supabase/env";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!getPublicSupabaseEnv()) return <SetupNotice missing={missingEnv()} />;
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <div className="flex items-center justify-between">
          <Link href="/" className="font-semibold">
            LeadPilot
          </Link>
          <ThemeToggle />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 py-12">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">Sign in to Northstar</h1>
            <p className="text-sm text-muted">Use the account your admin created for you.</p>
          </div>
          <LoginForm next={next} demo={getDemoCredentials()} />
          <p className="text-[13px] text-muted">
            Looking for the public site?{" "}
            <Link href="/northstar" className="text-accent hover:underline">
              Visit Northstar Realty
            </Link>
          </p>
        </div>
      </div>

      {/* A quiet preview of the product's signature element: the stage rail. */}
      <div className="relative hidden overflow-hidden border-l border-line bg-surface lg:block" aria-hidden="true">
        <div className="absolute inset-0 flex flex-col justify-center gap-5 px-16">
          {[
            ["Chloe Fisher", "Negotiation", 5, "var(--stage-negotiation)"],
            ["Matthew Powell", "Viewing", 4, "var(--stage-viewing)"],
            ["Alexander Gray", "Qualified", 3, "var(--stage-qualified)"],
            ["Mia Hughes", "Contacted", 2, "var(--stage-contacted)"],
            ["Scarlett West", "Won", 5, "var(--stage-won)"],
          ].map(([name, stage, reached, tone], i) => (
            <div key={name as string} className="flex animate-slide-up flex-col gap-2" style={{ animationDelay: `${i * 70}ms`, animationFillMode: "backwards" }}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium">{name}</span>
                <span className="text-muted">{stage}</span>
              </div>
              <div className="flex gap-1">
                {Array.from({ length: 5 }).map((_, s) => (
                  <span key={s} className="h-1 flex-1 rounded-full" style={{ background: s < (reached as number) ? (tone as string) : "var(--line)" }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
