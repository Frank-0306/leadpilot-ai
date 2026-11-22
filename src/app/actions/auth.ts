"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

const signInSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter the email you use for LeadPilot.")),
  password: z.string().min(6, "Passwords have at least 6 characters.").max(200),
  next: z.string().optional(),
});

/** Only allow redirects to paths inside this app (no open redirects). */
function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/dashboard";
  return next;
}

export async function signInAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = signInSchema.safeParse({
    email: form.get("email"),
    password: form.get("password"),
    next: form.get("next") ?? undefined,
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check your details." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    // Same message for unknown email and wrong password.
    return { ok: false, message: "That email and password don't match. Try again." };
  }
  redirect(safeNext(parsed.data.next));
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
