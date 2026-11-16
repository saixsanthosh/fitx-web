import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { canonicalRedirectUrl } from "@/lib/canonical-host";

export async function proxy(request: NextRequest) {
  // Production traffic on any other host (an old name or a deployment URL) moves to
  // ADMIN_SITE_URL first, so Google sign-in starts and finishes on the same host.
  // 307 is temporary, so browsers do not remember it if ADMIN_SITE_URL changes later.
  const canonical = canonicalRedirectUrl({
    requestUrl: request.url,
    host: request.headers.get("host") ?? request.nextUrl.host,
    vercelEnv: process.env.VERCEL_ENV,
    siteUrl: process.env.ADMIN_SITE_URL,
  });
  if (canonical) return NextResponse.redirect(canonical, 307);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let response = NextResponse.next({ request });
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        if (headers) {
          for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
        }
      },
    },
  });

  await supabase.auth.getClaims();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
