"use client";

import { usePathname, useRouter } from "next/navigation";
import { Select } from "@/components/ui/field";
import type { Agent } from "@/lib/types";

export function AgentFilter({ agents, value }: { agents: Agent[]; value?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <>
      <label htmlFor="pipeline-agent" className="sr-only">
        Filter by agent
      </label>
      <Select
        id="pipeline-agent"
        className="w-auto min-w-40"
        value={value ?? ""}
        onChange={(e) => router.replace(e.target.value ? `${pathname}?agent=${e.target.value}` : pathname)}
      >
        <option value="">All agents</option>
        <option value="unassigned">Unassigned</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.full_name}
          </option>
        ))}
      </Select>
    </>
  );
}
