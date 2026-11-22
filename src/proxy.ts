import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";

type CookieToSet = { name: string; value: string; options: CookieOptions };

const CRM_PREFIXES = ["/dashboard", "/leads", "/pipeline", "/tasks", "/automations", "/settings"];

/**
 * First of three permission checks (proxy → server code → Postgres RLS):
 * refreshes the Supabase session cookie and sends signed-out visitors to
 * /login. It is a convenience gate only; real authorization happens in
 * server actions and in the database.
 */
export async function proxy(request: NextRequest) {
  const env = getPublicSupabaseEnv();
  if (!env) return NextResponse.next(); // pages render setup instructions

  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  const isCrm = CRM_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isLogin = pathname === "/login";

  if (!user && isCrm) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return redirectWithCookies(url, response);
  }

  if (user && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return redirectWithCookies(url, response);
  }

  if (isCrm) response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function redirectWithCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export const config = {
  matcher: [
    "/login",
    "/dashboard/:path*",
    "/leads/:path*",
    "/pipeline/:path*",
    "/tasks/:path*",
    "/automations/:path*",
    "/settings/:path*",
  ],
};
