"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconAlert, IconCheck, IconClose } from "./icons";

type Tone = "success" | "error" | "info";
interface Toast {
  id: number;
  tone: Tone;
  message: string;
}

const ToastContext = createContext<((message: string, tone?: Tone) => void) | null>(null);

/** Lightweight toast stack. Announced politely to screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (message: string, tone: Tone = "success") => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-3), { id, tone, message }]);
      setTimeout(() => dismiss(id), tone === "error" ? 7000 : 4000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-5 sm:items-end"
        aria-live="polite"
        role="status"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex max-w-sm animate-slide-up items-start gap-2.5 rounded-lg border border-line bg-surface py-2.5 pr-2 pl-3 text-sm text-ink shadow-[0_8px_30px_-12px_rgb(0_0_0/0.35)]"
          >
            <span className={t.tone === "error" ? "mt-0.5 text-danger" : t.tone === "success" ? "mt-0.5 text-success" : "mt-0.5 text-accent"}>
              {t.tone === "error" ? <IconAlert size={16} /> : <IconCheck size={16} />}
            </span>
            <span className="flex-1 leading-snug">{t.message}</span>
            <button className="rounded p-0.5 text-faint hover:text-ink" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
              <IconClose size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

/** Shows a toast once for ?flash=… query params set by redirects after server actions. */
export function FlashToast({ flash }: { flash?: string }) {
  const toast = useToast();
  const shown = useRef(false);
  const messages = useMemo<Record<string, string>>(
    () => ({ created: "Lead created.", updated: "Changes saved.", deleted: "Lead deleted." }),
    [],
  );
  useEffect(() => {
    if (!flash || shown.current || !messages[flash]) return;
    shown.current = true;
    toast(messages[flash]);
    const url = new URL(window.location.href);
    url.searchParams.delete("flash");
    window.history.replaceState(null, "", url.toString());
  }, [flash, messages, toast]);
  return null;
}
