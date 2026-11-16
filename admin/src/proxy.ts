import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { canonicalRedirectUrl } from "@/lib/canonical-host";
import { buildAdminCsp, createNonce, originOf } from "@/lib/csp";

function isHttps(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return forwarded ? forwarded === "https" : request.nextUrl.protocol === "https:";
}

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

  // A fresh nonce per response. Next.js reads it from the request's CSP header and puts it on its
  // own scripts. FITX_ADMIN_CSP_REPORT_ONLY=1 reports violations instead of blocking, as a switch
  // that needs no code change if the policy ever blocks something it should not.
  const nonce = createNonce();
  const csp = buildAdminCsp({
    nonce,
    supabaseOrigin: originOf(process.env.NEXT_PUBLIC_SUPABASE_URL),
    isDev: process.env.NODE_ENV === "development",
    upgradeInsecureRequests: isHttps(request),
  });
  const responseHeader = process.env.FITX_ADMIN_CSP_REPORT_ONLY === "1" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";
  const forwardedHeaders = () => {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", csp);
    return headers;
  };
  const finish = (response: NextResponse) => {
    response.headers.set(responseHeader, csp);
    return response;
  };

  let response = NextResponse.next({ request: { headers: forwardedHeaders() } });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return finish(response);

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
        response = NextResponse.next({ request: { headers: forwardedHeaders() } });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        if (headers) {
          for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
        }
      },
    },
  });

  await supabase.auth.getClaims();
  return finish(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
