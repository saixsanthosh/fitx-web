import { NextResponse, type NextRequest } from "next/server";
import { supportLimitBody, validateSupportRequest } from "@/components/support/support-rules";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { takeRouteLimit } from "@/lib/security/rate-limit";
import { rateLimitedResponse } from "@/lib/security/responses";
import { isMissingFunctionError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";
import { supportLimitResponse } from "./limit";
import { readSupportJson } from "./read-json";

const noStore = { "Cache-Control": "private, no-store" };

/**
 * Opens a Help request for the signed-in person. The database function takes the account from the
 * session (never from the body) and allows at most 3 requests an hour and 10 a day.
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "failed" }, { status: 403, headers: noStore });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: noStore });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "signed_out" }, { status: 401, headers: noStore });

  // Bursts stop here; the hourly and daily limits are the database function's.
  const limit = takeRouteLimit("support", user.id);
  if (!limit.allowed) {
    const now = Date.now();
    return rateLimitedResponse(limit.retryAfterSeconds, supportLimitBody("request", "burst", now + limit.retryAfterSeconds * 1000, now));
  }
  const body = await readSupportJson(request);
  if (body.tooLarge) return NextResponse.json({ error: "payload_too_large" }, { status: 413, headers: noStore });
  const checked = validateSupportRequest(body.value);
  if (!checked.ok) return NextResponse.json({ error: "invalid", message: checked.error }, { status: 400, headers: noStore });

  const { data, error } = await supabase.rpc("fitx_submit_support_request", {
    p_category: checked.value.category,
    p_subject: checked.value.subject,
    p_body: checked.value.body,
    p_page_path: checked.value.pagePath,
  });
  if (error) {
    if (isMissingFunctionError(error)) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: noStore });
    // The database's hourly or daily limit: say which, and when the next one can go.
    if (error.code === "PT429") return supportLimitResponse(supabase, "request", error.details);
    // A table check (length or category) refused the values the checks above let through.
    if (error.code === "23514") return NextResponse.json({ error: "invalid" }, { status: 400, headers: noStore });
    console.warn("FITX support request failed", error.code);
    return NextResponse.json({ error: "failed" }, { status: 500, headers: noStore });
  }
  return NextResponse.json({ id: data }, { status: 201, headers: noStore });
}
