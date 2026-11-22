import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Loading pipeline">
      <Skeleton className="h-8 w-48" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex w-[272px] shrink-0 flex-col gap-2">
            <Skeleton className="h-6 w-32" />
            {Array.from({ length: 4 - (i % 3) }).map((__, j) => (
              <Skeleton key={j} className="h-24 rounded-lg" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
