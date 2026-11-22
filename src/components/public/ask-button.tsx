"use client";

import { LISTING_EVENT } from "./inquiry-form";

export function AskAboutButton({ address }: { address: string }) {
  return (
    <button
      type="button"
      className="text-[14.5px] font-medium text-[#1d3a8a] underline-offset-4 hover:underline"
      onClick={() => {
        window.dispatchEvent(new CustomEvent(LISTING_EVENT, { detail: address }));
        document.getElementById("inquiry")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
    >
      Ask about this home
    </button>
  );
}
