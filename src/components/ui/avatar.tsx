import { initials } from "@/lib/format";
import { cn } from "@/lib/cn";

export function Avatar({ name, color, size = 24, className }: { name: string; color?: string; size?: number; className?: string }) {
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center rounded-full font-semibold text-white", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), background: color ?? "var(--stage-new)" }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
