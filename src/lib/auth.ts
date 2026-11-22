import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "./supabase/server";
import type { Agent, Role } from "./types";

export interface Viewer {
  userId: string;
  email: string;
  fullName: string;
  role: Role;
  agent: Agent | null;
  isAdmin: boolean;
}

/**
 * The signed-in user with role and linked agent, or null.
 * Uses getUser() (verified with Supabase Auth), never the unverified session.
 * Cached per request so layouts and pages share one lookup.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: agent }] = await Promise.all([
    supabase.from("profiles").select("full_name, email, role").eq("id", user.id).maybeSingle(),
    supabase.from("agents").select("*").eq("user_id", user.id).eq("is_active", true).maybeSingle(),
  ]);

  const role: Role = profile?.role === "admin" ? "admin" : "agent";
  return {
    userId: user.id,
    email: profile?.email ?? user.email ?? "",
    fullName: profile?.full_name || (agent as Agent | null)?.full_name || user.email || "User",
    role,
    agent: (agent as Agent | null) ?? null,
    isAdmin: role === "admin",
  };
});

export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  return viewer;
}

export async function requireAdmin(): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!viewer.isAdmin) redirect("/dashboard?denied=1");
  return viewer;
}
