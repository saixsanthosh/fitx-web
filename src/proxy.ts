import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const privateRoots = ["/dashboard", "/workouts", "/nutrition", "/progress", "/goals", "/planner", "/profile", "/settings", "/exercises", "/onboarding"];
const authEntryRoutes = ["/signin", "/signup", "/forgot-password"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  const isPrivate = privateRoots.some((root) => request.nextUrl.pathname === root || request.nextUrl.pathname.startsWith(`${root}/`));
  const isAuthEntry = authEntryRoutes.includes(request.nextUrl.pathname);
  if (!url || !key) {
    if (isPrivate) {
      const signIn = new URL("/signin", request.url);
      signIn.searchParams.set("setup", "supabase");
      return NextResponse.redirect(signIn);
    }
    return response;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (isPrivate && !user) {
    const signIn = new URL("/signin", request.url);
    signIn.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(signIn);
  }
  if (user && ["/dashboard", "/onboarding"].includes(request.nextUrl.pathname)) {
    const { data: profile } = await supabase.from("profiles").select("onboarded").eq("id", user.id).maybeSingle();
    if (!profile?.onboarded) return NextResponse.redirect(new URL("/onboarding", request.url));
    if (request.nextUrl.pathname === "/onboarding") return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  if (isAuthEntry && user) return NextResponse.redirect(new URL("/dashboard", request.url));
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4|webm)$).*)"],
};
