import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-10 px-6 py-16">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">Portfolio project</p>
        <h1 className="text-4xl leading-[1.08] font-semibold tracking-[-0.03em] sm:text-5xl">
          LeadPilot keeps every real-estate lead moving toward a closing.
        </h1>
        <p className="max-w-xl text-lg text-muted">
          A CRM for small US brokerages: capture inquiries, assign them to agents, run the pipeline and never miss a follow-up. This demo runs
          on the fictional brokerage Northstar Realty.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href="/dashboard" className={buttonClass("primary")}>
          Open the CRM
        </Link>
        <Link href="/northstar" className={buttonClass("secondary")}>
          See the Northstar website form
        </Link>
      </div>
      <p className="text-[13px] text-faint">All people, listings and contact details in this demo are fictional.</p>
    </main>
  );
}
