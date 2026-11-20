import { NextResponse, type NextRequest } from "next/server";
import { canonicalRedirectUrl } from "@/lib/canonical-host";
import { buildAdminCsp, createNonce, originOf } from "@/lib/csp";
import { isConsolePath } from "@/lib/roles";
import { ADMIN_SESSION_COOKIE } from "@/lib/session-policy";

function isHttps(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return forwarded ? forwarded === "https" : request.nextUrl.protocol === "https:";
}

/** Paths that open without a session cookie. */
const PUBLIC_PATHS = new Set(["/login", "/robots.txt"]);

export async function proxy(request: NextRequest) {
  // Production traffic on any other host (an old name or a deployment URL) moves to ADMIN_SITE_URL
  // first, so the session cookie always belongs to one host. 307 is temporary, so browsers do not
  // remember it if ADMIN_SITE_URL changes later.
  const canonical = canonicalRedirectUrl({
    requestUrl: request.url,
    host: request.headers.get("host") ?? request.nextUrl.host,
    vercelEnv: process.env.VERCEL_ENV,
    siteUrl: process.env.ADMIN_SITE_URL,
  });
  if (canonical) return NextResponse.redirect(canonical, 307);

  // A page request without the session cookie goes straight to /login. This only saves a render:
  // every page checks the session itself (requireAdmin), and the proxy does no database work.
  const { pathname } = request.nextUrl;
  if ((request.method === "GET" || request.method === "HEAD") && !PUBLIC_PATHS.has(pathname) && !request.cookies.has(ADMIN_SESSION_COOKIE)) {
    const login = new URL("/login", request.url);
    if (isConsolePath(pathname)) login.searchParams.set("next", pathname);
    return NextResponse.redirect(login, 307);
  }

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
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set(responseHeader, csp);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
