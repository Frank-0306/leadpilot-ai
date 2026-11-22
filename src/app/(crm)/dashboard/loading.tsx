import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Loading dashboard">
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-9 w-96 max-w-full" />
      <Skeleton className="h-[104px] w-full rounded-xl" />
      <div className="grid gap-6 xl:grid-cols-[1.65fr_1fr]">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
}
