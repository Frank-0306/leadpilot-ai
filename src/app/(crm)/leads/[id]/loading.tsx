import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Loading lead">
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-9 w-72" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}
