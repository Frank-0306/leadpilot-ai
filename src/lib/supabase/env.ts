/**
 * Supabase settings.
 *
 * Public (safe in the browser, protected by RLS):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY   (sb_publishable_…; legacy name NEXT_PUBLIC_SUPABASE_ANON_KEY)
 *
 * Server only (bypasses RLS — never import from client code):
 *   SUPABASE_SECRET_KEY                    (sb_secret_…; legacy name SUPABASE_SERVICE_ROLE_KEY)
 */

export function getPublicSupabaseEnv(): { url: string; publishableKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

/** Names of required variables that are missing, for the setup screen. Never returns values. */
export function missingEnv(): string[] {
  const missing: string[] = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }
  if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SECRET_KEY");
  if (!process.env.FORM_SECRET) missing.push("FORM_SECRET");
  return missing;
}

/**
 * Optional public demo login shown on the sign-in page (DEMO_EMAIL, DEMO_PASSWORD).
 * These are meant to be public: mark that user with profiles.is_demo = true so the
 * database limits what it can change (see migration 20261122000100_demo_account.sql).
 */
export function getDemoCredentials(): { email: string; password: string } | null {
  const email = process.env.DEMO_EMAIL?.trim();
  const password = process.env.DEMO_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}
