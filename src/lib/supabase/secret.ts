import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/**
 * Privileged client using the secret key (role: service_role, bypasses RLS).
 * Used for exactly two jobs:
 *   - calling submit_public_lead() from the public inquiry form
 *   - running the event dispatcher (Phase 2)
 * `server-only` makes the build fail if a client component imports this file.
 */
export function getSupabaseSecretClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return null;

  client ??= createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}
