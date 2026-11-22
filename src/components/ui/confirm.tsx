"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Button } from "./button";

interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel: string;
  tone?: "danger" | "primary";
}

const ConfirmContext = createContext<((o: ConfirmOptions) => Promise<boolean>) | null>(null);

/**
 * Promise-based confirmation built on the native <dialog> element, which
 * gives focus trapping, Esc to cancel and an accessible modal for free.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    setOptions(o);
    requestAnimationFrame(() => dialogRef.current?.showModal());
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (value: boolean) => {
    dialogRef.current?.close();
    resolver.current?.(value);
    resolver.current = null;
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <dialog
        ref={dialogRef}
        className="m-auto w-[min(92vw,420px)] animate-pop rounded-xl border border-line bg-surface p-0 text-ink shadow-2xl"
        aria-labelledby="confirm-title"
        onCancel={(e) => {
          e.preventDefault();
          close(false);
        }}
      >
        {options ? (
          <div className="flex flex-col gap-4 p-5">
            <div className="flex flex-col gap-1.5">
              <h2 id="confirm-title" className="text-base font-semibold">
                {options.title}
              </h2>
              {options.body ? <p className="text-sm leading-relaxed text-muted">{options.body}</p> : null}
            </div>
            <div className="flex justify-end gap-2">
              <Button autoFocus onClick={() => close(false)}>
                Cancel
              </Button>
              <Button variant={options.tone === "primary" ? "primary" : "danger"} onClick={() => close(true)}>
                {options.confirmLabel}
              </Button>
            </div>
          </div>
        ) : null}
      </dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}
