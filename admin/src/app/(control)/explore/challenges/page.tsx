import type { Metadata } from "next";
import { Notice, PageHead, Panel, consoleStyles as ui } from "@/components/console/ui";
import { ConfirmSubmit } from "@/components/content/confirm-submit";
import styles from "@/components/explore/explore.module.css";
import { exploreNotice } from "@/components/explore/notices";
import { ModuleState } from "@/components/module-state";
import { PendingButton } from "@/components/pending-button";
import { hasPermission, requireAdmin } from "@/lib/admin-auth";
import { listChallenges, type ChallengeRow, type TemplateRow } from "@/lib/data/explore";
import {
  CHALLENGE_METRICS,
  CHALLENGE_SPORTS,
  EXPLORE_MIGRATION,
  METRIC_LABELS,
  SPORT_LABELS,
  challengePhase,
  istToday,
  windowText,
  type ChallengeSport,
} from "@/lib/explore-rules";
import { firstParam } from "@/lib/search-params";
import { formatIstDate } from "@/lib/time";
import { closeChallenge, saveChallenge, saveTemplate } from "../actions";

export const metadata: Metadata = { title: "Challenges" };

const PHASES = { upcoming: ["Starts soon", "status-neutral"], running: ["Running", "status-good"], ending: ["Ended, waiting to close", "status-warn"], closed: ["Closed", "status-neutral"] } as const;

function goal(row: { metric: ChallengeRow["metric"]; target: number | null; sport: string | null }) {
  const metric = METRIC_LABELS[row.metric];
  const sport = row.sport ? ` (${SPORT_LABELS[row.sport as ChallengeSport] ?? row.sport})` : "";
  return `${metric.label}${sport}${row.target === null ? "" : ` · target ${row.target.toLocaleString("en-IN")} ${metric.unit}`}`;
}

/** The fields a challenge and a template share. */
function CommonFields({ row }: { row?: Pick<TemplateRow, "kind" | "title" | "metric" | "sport" | "target"> }) {
  return (
    <>
      <label>Title<input name="title" required maxLength={80} defaultValue={row?.title ?? ""} placeholder="Five workouts this week" /></label>
      <div className="form-row">
        <label>Runs<select name="kind" defaultValue={row?.kind ?? "weekly"}><option value="weekly">Weekly (Monday to Monday)</option><option value="monthly">Monthly (1st to 1st)</option></select></label>
        <label>Counts<select name="metric" defaultValue={row?.metric ?? "workouts"}>{CHALLENGE_METRICS.map((metric) => <option key={metric} value={metric}>{METRIC_LABELS[metric].label}</option>)}</select></label>
      </div>
      <div className="form-row">
        <label>Sport (distance and active minutes only)<select name="sport" defaultValue={row?.sport ?? ""}><option value="">Any</option>{CHALLENGE_SPORTS.map((sport) => <option key={sport} value={sport}>{SPORT_LABELS[sport]}</option>)}</select></label>
        <label>Target (optional)<input name="target" inputMode="decimal" defaultValue={row?.target ?? ""} placeholder="5" /></label>
      </div>
    </>
  );
}

function ChallengeForm({ row, communities }: { row?: ChallengeRow; communities: ReadonlyArray<{ id: string; name: string }> }) {
  const day = row ? new Date(Date.parse(row.startsAt) + 330 * 60_000).toISOString().slice(0, 10) : istToday();
  return (
    <form action={saveChallenge} className="stack-form">
      {row && <input type="hidden" name="id" value={row.id} />}
      <CommonFields row={row} />
      <div className="form-row">
        <label>In the week or month of<input type="date" name="day" required defaultValue={day} /></label>
        <label>Community (optional)<select name="community" defaultValue={row?.communityId ?? ""}><option value="">All of Explore</option>{communities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      </div>
      <PendingButton className="primary-button" pendingLabel="Saving…">Save challenge</PendingButton>
    </form>
  );
}

function TemplateForm({ row }: { row?: TemplateRow }) {
  return (
    <form action={saveTemplate} className="stack-form">
      {row && <input type="hidden" name="id" value={row.id} />}
      <CommonFields row={row} />
      <label className="check-label"><input type="checkbox" name="active" defaultChecked={row?.active ?? true} />Open a new challenge from it every week or month</label>
      <PendingButton className="quiet-button" pendingLabel="Saving…">Save template</PendingButton>
    </form>
  );
}

export default async function ChallengesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAdmin("explore.view");
  const query = await searchParams;
  const notice = exploreNotice(firstParam(query.notice), firstParam(query.message));
  const moderator = hasPermission(actor, "explore.moderate");
  const result = await listChallenges();

  return (
    <div className="page-stack">
      <PageHead eyebrow="Explore" title="Challenges" meta="Members' values are counted from their own workouts and activities, never typed. Weeks and months run in India time." />
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {result.state === "ready" ? (
        <div className={styles.layout}>
          <div className={styles.stack}>
            <Panel title="Open" hint={result.open.length ? undefined : "No challenge is open"} className={ui.rise}>
              {result.open.length ? (
                <ul className={styles.cards}>
                  {result.open.map((row) => {
                    const [phase, tone] = PHASES[challengePhase(row)];
                    return (
                      <li key={row.id} className={styles.card}>
                        <div className={styles.cardTop}>
                          <h3 className={styles.cardTitle}>{row.title}</h3>
                          <span className={`status-pill ${tone}`}><i />{phase}</span>
                        </div>
                        <p className={styles.subtle}>{goal(row)} · {windowText(row.startsAt, row.endsAt)}{row.communityName ? ` · ${row.communityName}` : ""}{row.templateId ? " · from a template" : ""}</p>
                        <p className={styles.subtle}>{row.participants === null ? "Participants not known" : `${row.participants.toLocaleString("en-IN")} ${row.participants === 1 ? "participant" : "participants"}`}</p>
                        {moderator && (
                          <div className={styles.buttons}>
                            <details className={styles.edit}>
                              <summary>Edit</summary>
                              <ChallengeForm row={row} communities={result.communities} />
                            </details>
                            <form action={closeChallenge}>
                              <input type="hidden" name="id" value={row.id} />
                              <ConfirmSubmit label="Close challenge" confirmLabel="Close now: cannot be reopened" />
                            </form>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : <p className={styles.subtle}>{moderator ? "Add one below, or switch on a template." : "Admins add challenges here."}</p>}
            </Panel>
            {moderator && (
              <Panel title="New challenge" className={ui.onScroll}>
                <ChallengeForm communities={result.communities} />
              </Panel>
            )}
            <Panel title="Recently closed" className={ui.onScroll}>
              {result.closed.length ? (
                <ul className={styles.history}>
                  {result.closed.map((row) => (
                    <li key={row.id}>
                      <span>{row.title} · {goal(row)}</span>
                      <span className={styles.subtle}>{row.participants === null ? "" : `${row.participants.toLocaleString("en-IN")} took part · `}closed {formatIstDate(row.closedAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className={styles.subtle}>None yet.</p>}
            </Panel>
          </div>
          <aside className={styles.stack} aria-label="Templates">
            <Panel title="Templates" hint="The hourly job opens the next week's or month's challenge from each one that is on">
              {result.templates.length ? (
                <ul className={styles.cards}>
                  {result.templates.map((row) => (
                    <li key={row.id} className={styles.card}>
                      <div className={styles.cardTop}>
                        <h3 className={styles.cardTitle}>{row.title}</h3>
                        <span className={`status-pill ${row.active ? "status-good" : "status-neutral"}`}><i />{row.active ? "On" : "Off"}</span>
                      </div>
                      <p className={styles.subtle}>{row.kind === "weekly" ? "Weekly" : "Monthly"} · {goal(row)}</p>
                      {moderator && <details className={styles.edit}><summary>Edit</summary><TemplateForm row={row} /></details>}
                    </li>
                  ))}
                </ul>
              ) : <p className={styles.subtle}>No templates yet.</p>}
              {moderator && <details className={styles.edit}><summary>New template</summary><TemplateForm /></details>}
            </Panel>
          </aside>
        </div>
      ) : <ModuleState state={result.state} migration={EXPLORE_MIGRATION} />}
    </div>
  );
}
