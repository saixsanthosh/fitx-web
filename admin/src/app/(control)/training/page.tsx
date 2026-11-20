import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { ConfirmSubmit, SubmitButton } from "@/components/content/confirm-submit";
import { ContentHeader, ContentTabs, DataState, Empty, Pager, Pill, Section, Stat, StateNotice, Stats, contentStyles as styles, formatCount } from "@/components/content/kit";
import { requireAdmin } from "@/lib/admin-auth";
import { CONTENT_MIGRATION } from "@/lib/content/errors";
import {
  CATEGORY_LABELS,
  EQUIPMENT,
  EQUIPMENT_KIND_LABELS,
  EXERCISE_CATEGORIES,
  MUSCLE_GROUPS,
  MUSCLE_GROUP_LABELS,
  equipmentLabel,
  humanise,
  type EquipmentKind,
  type MuscleGroup,
} from "@/lib/content/vocabulary";
import { EXERCISE_PAGE_SIZE, getTrainingCounts, listExercises, parseExerciseFilters, type ExerciseFilters, type ExerciseRow } from "@/lib/data/exercises";
import { listProgrammes, type Programme } from "@/lib/data/programmes";
import { firstParam } from "@/lib/search-params";
import { formatIstDate } from "@/lib/time";
import { setExerciseActive, setProgrammeStatus } from "./actions";

export const metadata: Metadata = { title: "Workouts" };

type Params = Record<string, string | string[] | undefined>;
type Tab = "exercises" | "programmes" | "library";

const NOTICES = {
  shown: { text: "Exercise shown in the app.", good: true },
  hidden: { text: "Exercise hidden from the app. Saved workouts keep it.", good: true },
  deleted: { text: "Exercise deleted with its uploaded files.", good: true },
  programme_published: { text: "Programme published. Members can start it.", good: true },
  programme_draft: { text: "Programme moved to draft. Members already on it keep it.", good: true },
  save_failed: { text: "The change could not be saved. Nothing was changed.", good: false },
  invalid: { text: "That request was not valid.", good: false },
  configuration: { text: "Server data access is not configured.", good: false },
  forbidden: { text: "Your role cannot make this change.", good: false },
};

function listHref(filters: ExerciseFilters, change: Partial<ExerciseFilters> = {}) {
  const next = { ...filters, ...change };
  const query = new URLSearchParams();
  if (next.q) query.set("q", next.q);
  if (next.group) query.set("group", next.group);
  if (next.category) query.set("category", next.category);
  if (next.equipment) query.set("equipment", next.equipment);
  if (next.visibility !== "all") query.set("visibility", next.visibility);
  if (next.page > 1) query.set("page", String(next.page));
  const text = query.toString();
  return text ? `/training?${text}` : "/training";
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("");
}

function ExerciseItem({ row, thumb }: { row: ExerciseRow; thumb?: string }) {
  const group = row.muscle_group && (MUSCLE_GROUPS as readonly string[]).includes(row.muscle_group) ? MUSCLE_GROUP_LABELS[row.muscle_group as MuscleGroup] : humanise(row.primary_muscle);
  const equipment = row.required_equipment.length ? row.required_equipment.map(equipmentLabel).join(", ") : "No equipment";
  return (
    <li className={styles.row}>
      <span className={`${styles.thumb} ${row.is_active ? "" : styles.thumbHidden}`} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- FITX's own Storage copy; Admin's CSP allows only this project */}
        {thumb ? <img src={thumb} alt="" loading="lazy" width={52} height={52} /> : initials(row.name)}
      </span>
      <Link className={styles.rowLink} href={`/training/exercises/${encodeURIComponent(row.id)}`}>
        <span className={styles.rowTitle}>{row.name}</span>
        <span className={styles.rowSub}>{group} · {row.category ? CATEGORY_LABELS[row.category as keyof typeof CATEGORY_LABELS] ?? humanise(row.category) : "No category"} · {humanise(row.difficulty)}</span>
      </Link>
      <span className={styles.rowNumbers}>{equipment}</span>
      <span className={styles.rowMeta}>
        <Pill tone={row.is_active ? "good" : "neutral"}>{row.is_active ? "Shown" : "Hidden"}</Pill>
        {row.merged_into && <Pill plain>Merged</Pill>}
        {row.id.startsWith("fitx-") && <Pill tone="accent" plain>Admin</Pill>}
      </span>
      <form action={setExerciseActive} className={styles.rowAction}>
        <input type="hidden" name="exerciseId" value={row.id} />
        <input type="hidden" name="active" value={String(!row.is_active)} />
        <SubmitButton quiet small>{row.is_active ? "Hide" : "Show"}</SubmitButton>
      </form>
    </li>
  );
}

async function ExercisesTab({ filters }: { filters: ExerciseFilters }) {
  const result = await listExercises(filters);
  const filtered = Boolean(filters.q || filters.group || filters.category || filters.equipment || filters.visibility !== "all");
  return (
    <div className={styles.section}>
      <form action="/training" className={styles.toolbar} role="search">
        <label className={styles.search}>
          <span className={styles.srOnly}>Search exercises</span>
          <Search aria-hidden="true" size={18} />
          <input type="search" name="q" defaultValue={filters.q} maxLength={80} placeholder="Search by name" />
        </label>
        <div className={styles.filters}>
          <select name="group" defaultValue={filters.group} aria-label="Muscle group">
            <option value="">All muscle groups</option>
            {MUSCLE_GROUPS.map((group) => <option key={group} value={group}>{MUSCLE_GROUP_LABELS[group]}</option>)}
          </select>
          <select name="category" defaultValue={filters.category} aria-label="Category">
            <option value="">All categories</option>
            {EXERCISE_CATEGORIES.map((category) => <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>)}
          </select>
          <select name="equipment" defaultValue={filters.equipment} aria-label="Equipment">
            <option value="">Any equipment</option>
            <option value="none">No equipment</option>
            {EQUIPMENT.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
          <select name="visibility" defaultValue={filters.visibility} aria-label="Visibility">
            <option value="all">Shown and hidden</option>
            <option value="shown">Shown</option>
            <option value="hidden">Hidden</option>
          </select>
          <div className={styles.filterActions}>
            <button className={`${styles.button} ${styles.small}`} type="submit">Apply</button>
            {filtered && <Link className={`${styles.buttonQuiet} ${styles.small}`} href="/training">Clear</Link>}
          </div>
        </div>
      </form>
      {result.state !== "ready" ? (
        <DataState state={result.state} />
      ) : (
        <div className={styles.panel}>
          {result.rows.length ? (
            <ul className={styles.list} aria-label="Exercises">
              {result.rows.map((row) => <ExerciseItem key={row.id} row={row} thumb={result.thumbs[row.id]} />)}
            </ul>
          ) : (
            <Empty title={filtered ? "No exercise matches" : "No exercises yet"}>
              {filtered ? <Link className={styles.buttonQuiet} href="/training">Clear filters</Link> : <Link className={styles.button} href="/training/exercises/new">Add exercise</Link>}
            </Empty>
          )}
          <Pager page={filters.page} total={result.total} pageSize={EXERCISE_PAGE_SIZE} href={(page) => listHref(filters, { page })} />
        </div>
      )}
    </div>
  );
}

function slotLine(slot: Programme["days"][number]["slots"][number]) {
  const amount = slot.seconds ? `${slot.sets ?? "–"} × ${slot.seconds} s` : slot.reps ? `${slot.sets ?? "–"} × ${slot.reps[0]}–${slot.reps[1]}` : `${slot.sets ?? "–"} sets`;
  return amount;
}

async function ProgrammesTab({ enrolments }: { enrolments: Record<string, number> | null }) {
  const result = await listProgrammes();
  if (result.state !== "ready") return <DataState state={result.state} />;
  return (
    <div className={styles.section}>
      <p className={styles.hint}>
        Days and exercises come with the app. Here you choose which programmes members can start.
      </p>
      {result.programmes.length ? (
        result.programmes.map((programme) => (
          <details key={programme.id} id={programme.id} className={`${styles.panel} ${styles.programme}`}>
            <summary>
              <span>
                <span className={styles.rowTitle}>{programme.title}</span>
                <span className={styles.rowSub}>
                  {humanise(programme.context)} · {humanise(programme.level)} · {programme.daysPerWeek} days a week · {programme.sessionMinutes} min
                </span>
              </span>
              <Pill tone={programme.status === "published" ? "good" : "neutral"}>{programme.status === "published" ? "Published" : "Draft"}</Pill>
            </summary>
            <div className={styles.programmeBody}>
              {programme.summary && <p className={styles.hint}>{programme.summary}</p>}
              <dl className={styles.facts}>
                <div><dt>Members on it now</dt><dd>{enrolments ? formatCount(enrolments[programme.id] ?? 0) : "–"}</dd></div>
                <div><dt>Reviewed by</dt><dd>{programme.reviewedBy ?? "Not reviewed yet"}</dd></div>
                <div><dt>Built around</dt><dd>{programme.builtAround.length ? programme.builtAround.map(equipmentLabel).join(", ") : "Body weight"}</dd></div>
                <div><dt>Last changed</dt><dd>{formatIstDate(programme.updatedAt) ?? "–"}</dd></div>
              </dl>
              <ol className={styles.days}>
                {programme.days.map((day) => (
                  <li key={day.index} className={styles.day}>
                    <h3 className={styles.dayTitle}>Day {day.index + 1} · {day.title}</h3>
                    <ul className={styles.slots}>
                      {day.slots.map((slot, index) => (
                        <li key={index}>
                          <span>{slot.label ?? slot.muscles.map((muscle) => MUSCLE_GROUP_LABELS[muscle as MuscleGroup] ?? humanise(muscle)).join(" or ")}{slot.optional ? " (optional)" : ""}</span>
                          <span>{slotLine(slot)}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
              <form action={setProgrammeStatus}>
                <input type="hidden" name="programmeId" value={programme.id} />
                <input type="hidden" name="status" value={programme.status === "published" ? "draft" : "published"} />
                {programme.status === "published" ? (
                  <ConfirmSubmit label="Move to draft" confirmLabel="Confirm: stop new starts" tone="quiet" />
                ) : (
                  <SubmitButton>Publish</SubmitButton>
                )}
              </form>
            </div>
          </details>
        ))
      ) : (
        <Empty title="No programmes in the database" />
      )}
    </div>
  );
}

function VocabularyGrid({ entries, hrefFor }: { entries: Array<{ key: string; label: string; total: number; active: number }>; hrefFor: (key: string) => string }) {
  return (
    <ul className={styles.vocab}>
      {entries.map((entry) => (
        <li key={entry.key}>
          <Link className={styles.vocabItem} href={hrefFor(entry.key)}>
            <strong>{entry.label}</strong>
            <span className={styles.vocabCount}>{entry.active.toLocaleString("en-IN")}</span>
            <span>shown · {entry.total.toLocaleString("en-IN")} in all</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function LibraryTab({ counts }: { counts: Awaited<ReturnType<typeof getTrainingCounts>> }) {
  if (counts.state !== "ready") return <DataState state={counts.state} migration={CONTENT_MIGRATION} />;
  const c = counts.counts;
  const entry = (source: Record<string, { total: number; active: number }>, key: string, label: string) => ({ key, label, total: source[key]?.total ?? 0, active: source[key]?.active ?? 0 });
  const kinds = Object.keys(EQUIPMENT_KIND_LABELS) as EquipmentKind[];
  return (
    <div className={styles.page}>
      <p className={styles.hint}>
        Fixed lists in the app, with how many exercises use each. Set them on each exercise.
      </p>
      <Section title="Muscle groups">
        <VocabularyGrid entries={MUSCLE_GROUPS.map((group) => entry(c.muscle_groups, group, MUSCLE_GROUP_LABELS[group]))} hrefFor={(key) => `/training?group=${key}`} />
      </Section>
      <Section title="Categories">
        <VocabularyGrid entries={EXERCISE_CATEGORIES.map((category) => entry(c.categories, category, CATEGORY_LABELS[category]))} hrefFor={(key) => `/training?category=${key}`} />
      </Section>
      <Section title="Equipment and machines">
        <VocabularyGrid entries={[entry(c.equipment, "none", "No equipment")]} hrefFor={() => "/training?equipment=none"} />
        {kinds.map((kind) => {
          const items = EQUIPMENT.filter((item) => item.kind === kind);
          return items.length ? (
            <Section key={kind} title={EQUIPMENT_KIND_LABELS[kind]}>
              <VocabularyGrid entries={items.map((item) => entry(c.equipment, item.key, item.label))} hrefFor={(key) => `/training?equipment=${key}`} />
            </Section>
          ) : null;
        })}
      </Section>
    </div>
  );
}

export default async function TrainingPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdmin("content.manage");
  const params = await searchParams;
  const tabParam = firstParam(params.tab);
  const tab: Tab = tabParam === "programmes" || tabParam === "library" ? tabParam : "exercises";
  const filters = parseExerciseFilters(params);
  const counts = await getTrainingCounts();
  const ready = counts.state === "ready" ? counts.counts : null;
  return (
    <div className={styles.page}>
      <ContentHeader
        eyebrow="03 Workouts"
        title="Workouts"
        meta={ready ? `${formatCount(ready.exercises.active)} exercises shown of ${formatCount(ready.exercises.total)}` : undefined}
        actions={<Link className={styles.button} href="/training/exercises/new"><Plus aria-hidden="true" size={16} />Add exercise</Link>}
      />
      <StateNotice state={firstParam(params.state)} messages={NOTICES} />
      {ready && (
        <Stats label="Exercise library">
          <Stat label="Shown in the app" value={ready.exercises.active} />
          <Stat label="Hidden" value={ready.exercises.total - ready.exercises.active} hint={`${formatCount(ready.exercises.merged)} merged duplicates`} />
          <Stat label="Photos" value={ready.media.stills} hint={`${formatCount(ready.media.uploaded)} uploaded in Admin`} />
          <Stat label="With a video" value={ready.media.exercises_with_video} unit="exercises" />
        </Stats>
      )}
      <ContentTabs
        label="Workouts"
        items={[
          { href: "/training", label: "Exercises", count: ready?.exercises.total ?? null, current: tab === "exercises" },
          { href: "/training?tab=programmes", label: "Programmes", current: tab === "programmes" },
          { href: "/training?tab=library", label: "Groups and equipment", current: tab === "library" },
        ]}
      />
      {tab === "exercises" && <ExercisesTab filters={filters} />}
      {tab === "programmes" && <ProgrammesTab enrolments={ready?.enrolments ?? null} />}
      {tab === "library" && <LibraryTab counts={counts} />}
    </div>
  );
}
