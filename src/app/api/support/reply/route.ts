import { NextResponse, type NextRequest } from "next/server";
import { validateSupportReply } from "@/components/support/support-rules";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { takeRouteLimit } from "@/lib/security/rate-limit";
import { rateLimitedResponse } from "@/lib/security/responses";
import { isMissingFunctionError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";
import { readSupportJson } from "../read-json";

const noStore = { "Cache-Control": "private, no-store" };

/** Adds the signed-in person's reply to one of their own Help requests (at most 10 replies an hour). */
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "failed" }, { status: 403, headers: noStore });
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: noStore });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "signed_out" }, { status: 401, headers: noStore });

  // Bursts stop here; the hourly and daily limits are the database function's.
  const limit = takeRouteLimit("support", user.id);
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  const body = await readSupportJson(request);
  if (body.tooLarge) return NextResponse.json({ error: "payload_too_large" }, { status: 413, headers: noStore });
  const checked = validateSupportReply(body.value);
  if (!checked.ok) return NextResponse.json({ error: "invalid", message: checked.error }, { status: 400, headers: noStore });

  const { data, error } = await supabase.rpc("fitx_reply_support_request", { p_request_id: checked.value.requestId, p_body: checked.value.body });
  if (error) {
    if (isMissingFunctionError(error)) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: noStore });
    if (error.code === "PT429") return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: noStore });
    if (error.code === "PT409") return NextResponse.json({ error: "closed" }, { status: 409, headers: noStore });
    if (error.code === "PT404") return NextResponse.json({ error: "not_found" }, { status: 404, headers: noStore });
    // A table check (the reply length) refused a value the checks above let through.
    if (error.code === "23514") return NextResponse.json({ error: "invalid" }, { status: 400, headers: noStore });
    console.warn("FITX support reply failed", error.code);
    return NextResponse.json({ error: "failed" }, { status: 500, headers: noStore });
  }
  // The saved reply (the function returns its id; it stores the text as checked here), so the Help page can show
  // it at once instead of waiting for its refresh.
  const reply = typeof data === "string" ? { id: data, body: checked.value.body, createdAt: new Date().toISOString() } : null;
  return NextResponse.json({ ok: true, reply }, { status: 201, headers: noStore });
}
