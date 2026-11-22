"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { submitInquiryAction } from "@/app/actions/public-inquiry";
import { HONEYPOT_FIELD } from "@/lib/security/form-guard-fields";
import { PROPERTY_LABELS, PROPERTY_TYPES } from "@/lib/domain";

const control =
  "w-full rounded-lg border border-[#c9ccd3] bg-white px-3.5 text-[15px] text-[#14213d] placeholder:text-[#8a90a0] focus:border-[#1d3a8a] focus:outline-none focus:ring-2 focus:ring-[#1d3a8a]/15 aria-[invalid=true]:border-[#b3403a]";

export const LISTING_EVENT = "northstar:ask-about";

export function InquiryForm({ formToken }: { formToken: string }) {
  const [state, action, pending] = useActionState(submitInquiryAction, null);
  const [interest, setInterest] = useState("");
  const [sentKey, setSentKey] = useState(0);
  const [dismissed, setDismissed] = useState<typeof state>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const err = (k: string) => errors[k]?.[0];

  useEffect(() => {
    const onAsk = (e: Event) => {
      setInterest((e as CustomEvent<string>).detail);
      formRef.current?.querySelector<HTMLInputElement>("#ns-name")?.focus({ preventScroll: true });
    };
    window.addEventListener(LISTING_EVENT, onAsk);
    return () => window.removeEventListener(LISTING_EVENT, onAsk);
  }, []);

  if (state?.ok && state !== dismissed) {
    return (
      <div className="flex flex-col gap-4 rounded-2xl bg-white p-7 shadow-[0_1px_0_#d7d9de,0_20px_50px_-30px_rgb(20_33_61/0.45)]" role="status">
        <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r="19" fill="#e6ecfb" />
          <path d="m12.5 20.5 5 5 10-11" stroke="#1d3a8a" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h3 className="font-display text-2xl font-semibold text-[#14213d]">Request received</h3>
        <p className="text-[15px] leading-relaxed text-[#4a5163]">{state.message}</p>
        <button
          type="button"
          className="self-start text-[15px] font-medium text-[#1d3a8a] underline-offset-4 hover:underline"
          onClick={() => {
            setDismissed(state);
            setSentKey((k) => k + 1);
            setInterest("");
          }}
        >
          Ask about another home
        </button>
      </div>
    );
  }

  return (
    <form
      key={sentKey}
      ref={formRef}
      action={action}
      className="flex flex-col gap-4 rounded-2xl bg-white p-6 shadow-[0_1px_0_#d7d9de,0_20px_50px_-30px_rgb(20_33_61/0.45)] sm:p-7"
      aria-labelledby="inquiry-title"
    >
      <div>
        <h2 id="inquiry-title" className="font-display text-2xl font-semibold text-[#14213d]">
          Ask about a home
        </h2>
        <p className="mt-1 text-[14.5px] text-[#4a5163]">A local agent replies within one business day.</p>
      </div>

      {state && !state.ok ? (
        <p className="rounded-lg bg-[#fbeceb] px-3 py-2 text-[14px] text-[#9b2f29]" role="alert">
          {state.message}
        </p>
      ) : null}

      <input type="hidden" name="form_token" value={formToken} />
      {/* Honeypot: hidden from people and screen readers; bots tend to fill it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={HONEYPOT_FIELD}>Company website</label>
        <input id={HONEYPOT_FIELD} name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="ns-name" className="text-[14px] font-medium text-[#14213d]">
          Full name
        </label>
        <input id="ns-name" name="full_name" required minLength={2} maxLength={120} autoComplete="name" className={`${control} h-11`} aria-invalid={!!err("full_name")} />
        {err("full_name") ? <p className="text-[13px] text-[#9b2f29]">{err("full_name")}</p> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ns-email" className="text-[14px] font-medium text-[#14213d]">
            Email
          </label>
          <input id="ns-email" name="email" type="email" required maxLength={254} autoComplete="email" className={`${control} h-11`} aria-invalid={!!err("email")} />
          {err("email") ? <p className="text-[13px] text-[#9b2f29]">{err("email")}</p> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ns-phone" className="text-[14px] font-medium text-[#14213d]">
            Phone <span className="font-normal text-[#8a90a0]">optional</span>
          </label>
          <input id="ns-phone" name="phone" type="tel" maxLength={40} autoComplete="tel" className={`${control} h-11`} aria-invalid={!!err("phone")} />
          {err("phone") ? <p className="text-[13px] text-[#9b2f29]">{err("phone")}</p> : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ns-type" className="text-[14px] font-medium text-[#14213d]">
            Home type
          </label>
          <select id="ns-type" name="property_type" defaultValue="" className={`${control} h-11`}>
            <option value="">Any</option>
            {PROPERTY_TYPES.map((t) => (
              <option key={t} value={t}>
                {PROPERTY_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ns-budget" className="text-[14px] font-medium text-[#14213d]">
            Budget <span className="font-normal text-[#8a90a0]">optional</span>
          </label>
          <input id="ns-budget" name="budget" inputMode="numeric" placeholder="$450,000" className={`${control} h-11`} aria-invalid={!!err("budget")} />
          {err("budget") ? <p className="text-[13px] text-[#9b2f29]">{err("budget")}</p> : null}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="ns-interest" className="text-[14px] font-medium text-[#14213d]">
          Home or area you&apos;re interested in
        </label>
        <input
          id="ns-interest"
          name="property_interest"
          maxLength={300}
          value={interest}
          onChange={(e) => setInterest(e.target.value)}
          placeholder="e.g. 418 Willow Bend Dr, or 3 bed in Lakeview"
          className={`${control} h-11`}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="ns-message" className="text-[14px] font-medium text-[#14213d]">
          Message <span className="font-normal text-[#8a90a0]">optional</span>
        </label>
        <textarea id="ns-message" name="message" maxLength={2000} rows={3} className={`${control} py-2.5`} />
      </div>

      <label className="flex items-start gap-2.5 text-[13.5px] leading-snug text-[#4a5163]">
        <input type="checkbox" name="consent" required className="mt-0.5 size-4 accent-[#1d3a8a]" />
        I agree that Northstar Realty may contact me about this inquiry by email or phone.
      </label>
      {err("consent") ? <p className="-mt-2 text-[13px] text-[#9b2f29]">{err("consent")}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#1d3a8a] text-[15.5px] font-semibold text-white transition hover:bg-[#162e70] disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send my request"}
      </button>
    </form>
  );
}
