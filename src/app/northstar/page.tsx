import type { Metadata } from "next";
import Link from "next/link";
import { AskAboutButton } from "@/components/public/ask-button";
import { InquiryForm } from "@/components/public/inquiry-form";
import { issueFormToken } from "@/lib/security/form-guard";

export const metadata: Metadata = {
  title: { absolute: "Northstar Realty — Homes in the Cedar Valley (demo)" },
  description: "Demo website for Northstar Realty, a fictional brokerage used to showcase the LeadPilot CRM.",
};

// A fresh timing token per request, so the page is rendered dynamically.
export const dynamic = "force-dynamic";

const LISTINGS = [
  {
    address: "418 Willow Bend Dr",
    area: "Maple Heights",
    price: "$489,000",
    facts: "3 bd, 2 ba, 1,960 sq ft",
    plan: [
      [0, 0, 60, 46],
      [60, 0, 40, 30],
      [60, 30, 40, 30],
      [0, 46, 34, 34],
      [34, 46, 26, 34],
      [60, 60, 40, 20],
    ],
  },
  {
    address: "22 Birch Lane, Unit 5",
    area: "Downtown",
    price: "$342,500",
    facts: "2 bd, 2 ba, 1,140 sq ft",
    plan: [
      [0, 0, 100, 38],
      [0, 38, 45, 42],
      [45, 38, 30, 42],
      [75, 38, 25, 42],
    ],
  },
  {
    address: "9 Harbor Point Rd",
    area: "Harbor Point",
    price: "$1,825,000",
    facts: "5 bd, 4.5 ba, 4,310 sq ft",
    plan: [
      [0, 0, 38, 50],
      [38, 0, 62, 32],
      [38, 32, 30, 48],
      [68, 32, 32, 48],
      [0, 50, 38, 30],
    ],
  },
];

/** Each listing gets a line-drawn floor plan instead of stock photography. */
function FloorPlan({ rooms }: { rooms: number[][] }) {
  return (
    <svg viewBox="-2 -2 104 84" className="h-auto w-full" aria-hidden="true">
      <rect x="-2" y="-2" width="104" height="84" fill="#e9ecf3" rx="3" />
      {rooms.map(([x, y, w, h], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill={i === 0 ? "#dfe5f5" : "none"} stroke="#14213d" strokeWidth="1.4" />
      ))}
      <path d="M8 80 v-6 a6 6 0 0 1 6 6" fill="none" stroke="#14213d" strokeWidth="0.8" />
    </svg>
  );
}

export default function NorthstarPage() {
  const secret = process.env.FORM_SECRET;
  const token = secret ? issueFormToken(secret) : "";

  return (
    <div className="min-h-dvh bg-[#f1f2ef] text-[#14213d]" style={{ colorScheme: "light" }}>
      <div className="bg-[#14213d] px-4 py-2 text-center text-[12.5px] text-[#c9d2ea]">
        Demo website for a fictional brokerage. Inquiries go to the LeadPilot CRM demo.
      </div>

      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6 sm:px-8">
        <Link href="/northstar" className="flex items-center gap-2.5">
          <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
            <path d="M15 2 18 12 28 15 18 18 15 28 12 18 2 15 12 12Z" fill="#14213d" />
            <circle cx="15" cy="15" r="2.4" fill="#f1f2ef" />
          </svg>
          <span className="font-display text-xl font-semibold tracking-[-0.02em]">Northstar Realty</span>
        </Link>
        <a href="#inquiry" className="hidden rounded-full border border-[#14213d]/25 px-4 py-2 text-[14px] font-medium hover:border-[#14213d] sm:inline-block">
          Talk to an agent
        </a>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl gap-12 px-5 pt-6 pb-20 sm:px-8 lg:grid-cols-[1.15fr_1fr] lg:gap-16 lg:pt-12">
          <div className="flex flex-col gap-7">
            <h1 className="font-display text-[44px] leading-[0.98] font-semibold tracking-[-0.035em] sm:text-[64px]">
              Find your place in the Cedar Valley.
            </h1>
            <p className="max-w-lg text-lg leading-relaxed text-[#4a5163]">
              Five agents who live where they sell. Tell us what you&apos;re looking for and one of us will call with homes that fit, including ones
              not online yet.
            </p>
            <dl className="grid max-w-md grid-cols-3 gap-6 border-t border-[#14213d]/15 pt-6">
              <div>
                <dt className="text-[13px] text-[#5d6475]">Homes sold in 2026</dt>
                <dd className="font-display text-3xl font-semibold">142</dd>
              </div>
              <div>
                <dt className="text-[13px] text-[#5d6475]">Median days to close</dt>
                <dd className="font-display text-3xl font-semibold">31</dd>
              </div>
              <div>
                <dt className="text-[13px] text-[#5d6475]">Neighborhoods</dt>
                <dd className="font-display text-3xl font-semibold">8</dd>
              </div>
            </dl>
            <p className="text-[12.5px] text-[#7b8192]">Figures are illustrative for this demo.</p>
          </div>

          <div id="inquiry" className="scroll-mt-6">
            {token ? (
              <InquiryForm formToken={token} />
            ) : (
              <p className="rounded-2xl bg-white p-6 text-[15px] text-[#4a5163]">
                The inquiry form isn&apos;t configured yet (FORM_SECRET is missing). See the README.
              </p>
            )}
          </div>
        </section>

        <section className="border-t border-[#14213d]/10 bg-white/60" aria-labelledby="listings-title">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
            <h2 id="listings-title" className="font-display mb-8 text-3xl font-semibold tracking-[-0.02em]">
              Just listed
            </h2>
            <ul className="grid gap-8 md:grid-cols-3">
              {LISTINGS.map((l) => (
                <li key={l.address} className="flex flex-col gap-4">
                  <FloorPlan rooms={l.plan} />
                  <div className="flex flex-col gap-1">
                    <p className="font-display text-2xl font-semibold">{l.price}</p>
                    <p className="text-[15px]">{l.address}</p>
                    <p className="text-[14px] text-[#5d6475]">
                      {l.area}, {l.facts}
                    </p>
                  </div>
                  <AskAboutButton address={`${l.address}, ${l.area}`} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-10 text-[13px] text-[#5d6475] sm:flex-row sm:justify-between sm:px-8">
        <p>Northstar Realty is a fictional company created for a software portfolio. Listings, people and figures are not real.</p>
        <Link href="/login" className="hover:text-[#14213d]">
          Agent sign-in
        </Link>
      </footer>
    </div>
  );
}
