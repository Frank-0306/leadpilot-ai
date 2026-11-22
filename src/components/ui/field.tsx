import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const controlClass =
  "rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-faint transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-accent/20 aria-[invalid=true]:border-danger";

/** Full width unless the caller sets its own width (w-auto, w-40, …). */
const width = (className?: string) => (className && /(^|\s)(min-)?w-/.test(className) ? "" : "w-full");

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  className,
  optional,
}: {
  label: string;
  htmlFor: string;
  error?: string[] | string;
  hint?: string;
  children: ReactNode;
  className?: string;
  optional?: boolean;
}) {
  const message = Array.isArray(error) ? error[0] : error;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">
        {label}
        {optional ? <span className="ml-1 font-normal text-faint">optional</span> : null}
      </label>
      {children}
      {message ? (
        <p id={`${htmlFor}-error`} className="text-[12.5px] text-danger" role="alert">
          {message}
        </p>
      ) : hint ? (
        <p className="text-[12.5px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className, invalid, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={cn(controlClass, width(className), "h-9", className)}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid && rest.id ? `${rest.id}-error` : undefined}
      {...rest}
    />
  );
}

export function Select({ className, invalid, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      className={cn(controlClass, width(className), "h-9 appearance-none bg-[length:14px] bg-[right_10px_center] bg-no-repeat pr-8", className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%23888' stroke-width='1.6'%3E%3Cpath d='m6 8 4 4 4-4'/%3E%3C/svg%3E\")",
      }}
      aria-invalid={invalid || undefined}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Textarea({ className, invalid, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea className={cn(controlClass, width(className), "min-h-24 py-2 leading-relaxed", className)} aria-invalid={invalid || undefined} {...rest} />;
}
