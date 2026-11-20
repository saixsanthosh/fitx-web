import "server-only";
import { requireAdmin } from "@/lib/admin-auth";
import { logServerError } from "@/lib/log";
import { isMissingTable } from "@/lib/schema";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type ProgrammeSlot = { label: string | null; muscles: string[]; optional: boolean; sets: number | null; reps: [number, number] | null; seconds: number | null; rest: number | null };
export type ProgrammeDay = { index: number; key: string; title: string; focus: string[]; slots: ProgrammeSlot[] };
export type Programme = {
  id: string;
  title: string;
  summary: string;
  context: string;
  split: string;
  level: string;
  daysPerWeek: number;
  sessionMinutes: number;
  builtAround: string[];
  isPremium: boolean;
  status: "draft" | "published";
  reviewedBy: string | null;
  updatedAt: string;
  days: ProgrammeDay[];
};

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** A programme slot as stored (src/lib/training/generator.ts SlotSpec), reduced to what the page shows. */
export function readSlot(value: unknown): ProgrammeSlot {
  const slot = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const reps = Array.isArray(slot.reps) && slot.reps.length === 2 && slot.reps.every((n) => typeof n === "number") ? (slot.reps as [number, number]) : null;
  return {
    label: typeof slot.label === "string" ? slot.label : null,
    muscles: typeof slot.muscle === "string" ? [slot.muscle] : Array.isArray(slot.muscle) ? slot.muscle.filter((m): m is string => typeof m === "string") : [],
    optional: slot.optional === true,
    sets: num(slot.sets),
    reps,
    seconds: num(slot.seconds),
    rest: num(slot.rest),
  };
}

/**
 * Every programme, published or draft, with its days. Their content is authored in the app
 * (src/data/programmes, seeded by a generated migration); Admin changes only whether one is published.
 */
export async function listProgrammes() {
  await requireAdmin("content.manage");
  const supabase = createAdminSupabase();
  if (!supabase) return { state: "service_key_missing" as const };
  const [programmes, days] = await Promise.all([
    supabase
      .from("training_programmes")
      .select("id,title,summary,context,split,level,days_per_week,session_minutes,built_around,is_premium,status,reviewed_by,updated_at")
      .order("context")
      .order("days_per_week"),
    supabase.from("training_programme_days").select("programme_id,day_index,key,title,focus,slots").order("day_index"),
  ]);
  const error = programmes.error ?? days.error;
  if (error) {
    logServerError("data.programmes", error);
    return { state: isMissingTable(error) ? ("migration_pending" as const) : ("query_failed" as const) };
  }
  const byProgramme = new Map<string, ProgrammeDay[]>();
  for (const row of (days.data ?? []) as Array<Record<string, unknown>>) {
    const list = byProgramme.get(String(row.programme_id)) ?? [];
    list.push({
      index: Number(row.day_index) || 0,
      key: String(row.key ?? ""),
      title: String(row.title ?? ""),
      focus: Array.isArray(row.focus) ? row.focus.map(String) : [],
      slots: Array.isArray(row.slots) ? row.slots.map(readSlot) : [],
    });
    byProgramme.set(String(row.programme_id), list);
  }
  const list: Programme[] = ((programmes.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    title: String(row.title ?? ""),
    summary: String(row.summary ?? ""),
    context: String(row.context ?? ""),
    split: String(row.split ?? ""),
    level: String(row.level ?? ""),
    daysPerWeek: Number(row.days_per_week) || 0,
    sessionMinutes: Number(row.session_minutes) || 0,
    builtAround: Array.isArray(row.built_around) ? row.built_around.map(String) : [],
    isPremium: row.is_premium === true,
    status: row.status === "published" ? "published" : "draft",
    reviewedBy: typeof row.reviewed_by === "string" ? row.reviewed_by : null,
    updatedAt: String(row.updated_at ?? ""),
    days: byProgramme.get(String(row.id)) ?? [],
  }));
  return { state: "ready" as const, programmes: list };
}
