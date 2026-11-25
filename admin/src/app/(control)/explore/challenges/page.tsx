import type { Metadata } from "next";
import { Notice, PageHead, Panel, consoleStyles as ui } from "@/components/console/ui";
import { ConfirmSubmit } from "@/components/content/confirm-submit";
import { ChallengeForm, TemplateForm, type ChallengeDefaults } from "@/components/explore/challenge-forms";
import styles from "@/components/explore/explore.module.css";
import { exploreNotice } from "@/components/explore/notices";
import { ModuleState } from "@/components/module-state";
import { hasPermission, requireAdmin } from "@/lib/admin-auth";
import { listChallenges, type ChallengeRow } from "@/lib/data/explore";
import {
  EXPLORE_MIGRATION,
  METRIC_LABELS,
  SPORT_LABELS,
  challengePhase,
  istToday,
  windowText,
  type ChallengeSport,
} from "@/lib/explore-rules";
import { pageNotice } from "@/lib/notice";
import { formatIstDate } from "@/lib/time";
import { closeChallenge } from "../actions";

export const metadata: Metadata = { title: "Challenges" };

const PHASES = { upcoming: ["Starts soon", "status-neutral"], running: ["Running", "status-good"], ending: ["Ended, waiting to close", "status-warn"], closed: ["Closed", "status-neutral"] } as const;

function goal(row: { metric: ChallengeRow["metric"]; target: number | null; sport: string | null }) {
  const metric = METRIC_LABELS[row.metric];
  const sport = row.sport ? ` (${SPORT_LABELS[row.sport as ChallengeSport] ?? row.sport})` : "";
  return `${metric.label}${sport}${row.target === null ? "" : ` · target ${row.target.toLocaleString("en-IN")} ${metric.unit}`}`;
}

/** An open challenge as its edit form starts: the IST day it starts on. */
function challengeDefaults(row: ChallengeRow): ChallengeDefaults {
  const day = new Date(Date.parse(row.startsAt) + 330 * 60_000).toISOString().slice(0, 10);
  return { id: row.id, kind: row.kind, title: row.title, metric: row.metric, sport: row.sport, target: row.target, day, communityId: row.communityId };
}

export default async function ChallengesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAdmin("explore.view");
  const query = await searchParams;
  const notice = exploreNotice(pageNotice(query.notice, actor.id)?.code);
  const moderator = hasPermission(actor, "explore.moderate");
  const result = await listChallenges();
  const today = istToday();

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
                              <ChallengeForm row={challengeDefaults(row)} day={today} communities={result.communities} />
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
                <ChallengeForm day={today} communities={result.communities} />
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
