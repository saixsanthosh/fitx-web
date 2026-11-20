import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { createRouteSupabase } from "@/lib/supabase/route-client";
import { readAiConfig, type AiConfig } from "./config";
import { CoachError, toCoachError, type CoachDeps } from "./coach";
import { currentFoodCatalogue } from "./food-data";
import { createLiveLookups } from "./food-lookup";
import { createAiRouter } from "./router";
import type { Db } from "./store";
import type { CoachErrorCode, CoachStreamEvent } from "./types";

/**
 * Shared plumbing for the coach's route handlers: the same-origin check, the member's session, body
 * limits, honest error responses and the NDJSON stream. Every response is private and uncached.
 */

const STATUS: Record<CoachErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  invalid: 400,
  not_found: 404,
  consent_required: 409,
  plans_unavailable: 409,
  refused: 422,
  quota: 429,
  paused: 503,
  not_configured: 503,
  not_available: 503,
  at_capacity: 503,
  failed: 500,
};

export type CoachGate = {
  db: Db;
  userId: string;
  config: AiConfig;
  /** Puts refreshed session cookies on the response. */
  finish<T extends NextResponse>(response: T): T;
};

/**
 * Signed-in members only; requests that change something must come from FITX's own pages
 * (Sec-Fetch-Site or Origin), so another site cannot spend a member's coach allowance.
 */
export async function coachGate(request: NextRequest, options: { mutating: boolean }): Promise<{ ok: true; gate: CoachGate } | { ok: false; response: NextResponse }> {
  if (options.mutating && !isSameOriginRequest(request)) return { ok: false, response: errorResponse(new CoachError("forbidden", "This request must come from the FITX app.")) };
  const route = createRouteSupabase(request);
  if (!route) return { ok: false, response: errorResponse(new CoachError("not_available", "Accounts aren't set up on this copy of FITX.")) };
  const { data, error } = await route.supabase.auth.getUser();
  if (error || !data.user) return { ok: false, response: route.applyTo(errorResponse(new CoachError("unauthorized", "Sign in to use the coach."))) };
  return { ok: true, gate: { db: route.supabase as Db, userId: data.user.id, config: readAiConfig(), finish: (response) => route.applyTo(response) } };
}

export function coachDeps(gate: CoachGate, signal?: AbortSignal): CoachDeps {
  return {
    db: gate.db,
    userId: gate.userId,
    config: gate.config,
    router: createAiRouter({ config: gate.config }),
    catalogue: () => currentFoodCatalogue(gate.db),
    live: createLiveLookups({ usdaKey: process.env.USDA_API_KEY?.trim() || undefined, offUserAgent: process.env.OPEN_FOOD_FACTS_USER_AGENT }),
    signal,
  };
}

export function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function errorResponse(error: unknown) {
  const coach = toCoachError(error);
  if (coach.code === "failed") console.error("[fitx-coach]", error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");
  const response = jsonResponse({ error: { code: coach.code, message: coach.message, ...(coach.retryAt ? { retryAt: coach.retryAt } : {}) } }, STATUS[coach.code]);
  if (coach.retryAt) {
    const seconds = Math.max(1, Math.round((Date.parse(coach.retryAt) - Date.now()) / 1000));
    if (Number.isFinite(seconds)) response.headers.set("Retry-After", String(seconds));
  }
  return response;
}

/**
 * Runs `work`, streaming its events as NDJSON. Errors before the first event become a normal JSON
 * error response with the right status; errors after it become a final "error" event. The work is
 * stopped when the member leaves the page.
 */
export async function ndjsonResponse(request: Request, gate: CoachGate, work: (emit: (event: CoachStreamEvent) => void, signal: AbortSignal) => Promise<void>): Promise<NextResponse> {
  const controller = new AbortController();
  request.signal?.addEventListener("abort", () => controller.abort(), { once: true });
  const encoder = new TextEncoder();
  let sink: ReadableStreamDefaultController<Uint8Array> | null = null;
  const pending: Uint8Array[] = [];
  let closed = false;
  const write = (event: CoachStreamEvent) => {
    if (closed) return;
    const chunk = encoder.encode(`${JSON.stringify(event)}\n`);
    if (sink) sink.enqueue(chunk);
    else pending.push(chunk);
  };
  const close = () => {
    if (closed) return;
    closed = true;
    if (sink) sink.close();
  };

  let markStarted: () => void = () => {};
  const started = new Promise<"started">((resolve) => {
    markStarted = () => resolve("started");
  });
  let isStarted = false;
  const run = work((event) => {
    if (!isStarted) {
      isStarted = true;
      markStarted();
    }
    write(event);
  }, controller.signal).then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, error }),
  );

  const first = await Promise.race([started, run]);
  if (first !== "started" && !first.ok) return gate.finish(errorResponse(first.error));

  void run.then((outcome) => {
    if (!outcome.ok) {
      const coach = toCoachError(outcome.error);
      write({ type: "error", code: coach.code, message: coach.message, ...(coach.retryAt ? { retryAt: coach.retryAt } : {}) });
    }
    close();
  });

  const stream = new ReadableStream<Uint8Array>({
    start(controllerOfStream) {
      sink = controllerOfStream;
      for (const chunk of pending.splice(0)) controllerOfStream.enqueue(chunk);
      if (closed) controllerOfStream.close();
    },
    cancel() {
      closed = true;
      controller.abort();
    },
  });
  return gate.finish(
    new NextResponse(stream, {
      status: 200,
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "private, no-store, no-transform", "X-Accel-Buffering": "no" },
    }),
  );
}
