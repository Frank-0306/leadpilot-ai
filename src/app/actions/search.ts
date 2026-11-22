"use server";

import { getViewer } from "@/lib/auth";
import { STATUS_META } from "@/lib/domain";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Lead } from "@/lib/types";
import { sanitizeSearch } from "@/lib/validation";

export interface SearchHit {
  kind: "lead" | "task";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

/** Global search (⌘K). Runs as the user, so results respect RLS. */
export async function searchAction(raw: string): Promise<SearchHit[]> {
  const viewer = await getViewer();
  if (!viewer) return [];
  const q = sanitizeSearch(String(raw ?? ""));
  if (q.length < 2) return [];

  const supabase = await createSupabaseServerClient();
  const digits = q.replace(/\D/g, "");
  const ors = [`full_name.ilike.*${q}*`, `email.ilike.*${q}*`, `preferred_area.ilike.*${q}*`];
  if (digits.length >= 3) ors.push(`phone_digits.like.*${digits}*`);

  const [leads, tasks] = await Promise.all([
    supabase.from("leads").select("id, full_name, email, status, preferred_area").or(ors.join(",")).limit(6),
    supabase.from("tasks").select("id, title, lead_id, completed_at").ilike("title", `%${q}%`).limit(4),
  ]);

  const hits: SearchHit[] = [];
  for (const l of (leads.data ?? []) as Pick<Lead, "id" | "full_name" | "email" | "status" | "preferred_area">[]) {
    hits.push({
      kind: "lead",
      id: l.id,
      title: l.full_name,
      subtitle: [STATUS_META[l.status].label, l.email, l.preferred_area].filter(Boolean).join(" · "),
      href: `/leads/${l.id}`,
    });
  }
  for (const t of (tasks.data ?? []) as { id: string; title: string; lead_id: string | null; completed_at: string | null }[]) {
    hits.push({
      kind: "task",
      id: t.id,
      title: t.title,
      subtitle: t.completed_at ? "Completed task" : "Open task",
      href: t.lead_id ? `/leads/${t.lead_id}` : "/tasks",
    });
  }
  return hits;
}
