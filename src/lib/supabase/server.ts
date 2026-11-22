import "server-only";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { getPublicSupabaseEnv } from "./env";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Supabase client bound to the signed-in user's session cookies.
 * Every query runs as that user, so Row Level Security decides what they can
 * read or change. Use in Server Components, Server Actions and Route Handlers.
 */
export async function createSupabaseServerClient() {
  const env = getPublicSupabaseEnv();
  if (!env) throw new Error("Supabase is not configured. See README → Setup.");

  const cookieStore = await cookies();

  return createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components can't write cookies; the proxy refreshes the session.
        }
      },
    },
  });
}
