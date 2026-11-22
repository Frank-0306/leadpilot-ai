"use client";

import { useEffect, useState } from "react";
import { IconMoon, IconSun } from "@/components/ui/icons";

export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("lp-theme", next ? "dark" : "light");
    } catch {
      /* storage may be unavailable (private mode) — the toggle still works for this visit */
    }
    setDark(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={className ?? "grid size-8 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink"}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Light theme" : "Dark theme"}
    >
      {dark ? <IconSun size={17} /> : <IconMoon size={17} />}
    </button>
  );
}
