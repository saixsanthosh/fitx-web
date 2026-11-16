"use client";

import { createClient } from "@/lib/supabase/client";

export type Session = { db: NonNullable<ReturnType<typeof createClient>>; userId: string };
export type SessionProblem = "not-configured" | "signed-out" | "error";

let pending: Promise<Session> | null = null;

/**
 * The browser Supabase client and the signed-in user's id, looked up once per page load and shared
 * by every widget (each getUser() is a network request). A failure is not cached.
 */
export function getSession(): Promise<Session> {
  if (pending) return pending;
  const db = createClient();
  if (!db) return Promise.reject(problem("not-configured"));
  const lookup: Promise<Session> = db.auth.getUser().then(({ data, error }: { data: { user: { id: string } | null }; error: unknown }) => {
    if (error && !data.user) throw problem("error");
    if (!data.user) throw problem("signed-out");
    return { db, userId: data.user.id };
  });
  pending = lookup;
  lookup.catch(() => { pending = null; });
  return lookup;
}

function problem(kind: SessionProblem) {
  return Object.assign(new Error(kind), { kind });
}

export function sessionProblem(error: unknown): SessionProblem | null {
  const kind = (error as { kind?: unknown } | null)?.kind;
  return kind === "not-configured" || kind === "signed-out" || kind === "error" ? kind : null;
}

/** A sentence for a failed request: the session problem, the data layer's message, or a fallback. */
export function messageFor(error: unknown, fallback: string): string {
  const kind = sessionProblem(error);
  if (kind === "not-configured") return "FITX is not connected to its database in this environment.";
  if (kind === "signed-out") return "Sign in to see this.";
  if (error instanceof Error && error.name !== "Error" && error.message) return error.message;
  return fallback;
}
