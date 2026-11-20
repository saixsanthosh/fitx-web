import type { Metadata } from "next";
import { BarChart, Kpi, Notice, PageHead, Panel, consoleStyles as ui } from "@/components/console/ui";
import { ModuleState } from "@/components/module-state";
import { ADMIN_OPS_MIGRATION } from "@/components/settings/settings-rules";
import { hasPermission, requireAdmin } from "@/lib/admin-auth";
import { listAdminSessions } from "@/lib/admin-session";
import { AUDIT_ACTIONS, auditActionLabel, summariseAuditDetails } from "@/lib/audit-catalog";
import { recentAuditEvents } from "@/lib/data/audit";
import { getSecurityOverview } from "@/lib/data/security";
import { LOGIN_LIMITS } from "@/lib/login-guard";
import { firstParam } from "@/lib/search-params";
import { formatIstDateTime, formatShortDay } from "@/lib/time";
import { endOperatorSessions, endSession } from "./actions";

export const metadata: Metadata = { title: "Security" };

const SIGN_IN_ACTIONS = Object.entries(AUDIT_ACTIONS).filter(([, entry]) => entry.group === "Sign-in").map(([action]) => action);

const NOTICES: Record<string, { tone: "success" | "error"; text: string }> = {
  ended: { tone: "success", text: "Session ended." },
  ended_all: { tone: "success", text: "Every session of that operator has ended." },
  current: { tone: "error", text: "That is this browser. Use Sign out instead." },
  self: { tone: "error", text: "Use Sign out for your own sessions." },
  forbidden: { tone: "error", text: "Your role cannot end that session." },
  not_found: { tone: "error", text: "That session no longer exists." },
  invalid: { tone: "error", text: "Check the request and try again." },
  failed: { tone: "error", text: "The change did not complete. The server log has the details." },
};

/** "Chrome on macOS" from a user agent, or the start of it. */
function browserOf(agent: string | null): string {
  if (!agent) return "Unknown browser";
  const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : null;
  const system = /iPhone|iPad/.test(agent) ? "iOS" : /Android/.test(agent) ? "Android" : /Mac OS X/.test(agent) ? "macOS" : /Windows/.test(agent) ? "Windows" : /Linux/.test(agent) ? "Linux" : null;
  return browser && system ? `${browser} on ${system}` : agent.slice(0, 40);
}

function minutesLeft(until: string): number {
  return Math.max(1, Math.ceil((Date.parse(until) - Date.now()) / 60_000));
}

export default async function SecurityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAdmin("security.view");
  const notice = NOTICES[firstParam((await searchParams).state)];
  const manage = hasPermission(actor, "access.manage");
  const [overview, sessions, history] = await Promise.all([
    getSecurityOverview(),
    listAdminSessions({ activeOnly: true, limit: 50 }),
    recentAuditEvents({ limit: 30, actions: SIGN_IN_ACTIONS, permission: "security.view" }),
  ]);
  const data = overview.state === "ready" ? overview.overview : null;

  return (
    <div className="page-stack">
      <PageHead eyebrow="Admin and security" title="Security" meta={`${LOGIN_LIMITS.userFailures} wrong passwords lock a username on that address for ${LOGIN_LIMITS.lockMinutes} minutes`} />
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      {data ? (
        <>
          <div className={`${ui.kpiGrid} ${ui.stagger}`}>
            <Kpi label="Sign-ins, 24 hours" value={data.succeeded24h} />
            <Kpi label="Failed, 24 hours" value={data.failed24h} accent={data.failed24h > 0} hint={`${data.failed7d.toLocaleString("en-IN")} in 7 days`} />
            <Kpi label="Locked now" value={data.locked.length + data.lockedUnknown} hint={data.lockedUnknown ? `${data.lockedUnknown} unknown usernames` : "Usernames"} accent={data.locked.length > 0} />
            <Kpi label="Addresses at limit" value={data.ipLimitedNow} hint={`${LOGIN_LIMITS.ipAttempts} tries in ${LOGIN_LIMITS.ipWindowMinutes} min`} />
          </div>
          <Panel title="Sign-in attempts" hint="Last 14 days, IST" className={ui.onScroll}>
            <div className={ui.columns}>
              <div><h3 className="metric-definition">Failed</h3><BarChart title="Failed sign-ins" points={data.daily.map((day) => ({ label: formatShortDay(day.day), value: day.failed }))} /></div>
              <div><h3 className="metric-definition">Successful</h3><BarChart title="Successful sign-ins" points={data.daily.map((day) => ({ label: formatShortDay(day.day), value: day.succeeded }))} tone="green" /></div>
            </div>
          </Panel>
          {data.locked.length > 0 && (
            <Panel title="Locked operators" hint="Locked from one or more addresses; the lock lifts by itself" className={ui.onScroll}>
              <ul className="settings-list">
                {data.locked.map((lock) => <li key={lock.operatorId} className="settings-row"><span><strong>{lock.username}</strong><small>Until {formatIstDateTime(lock.lockedUntil)}</small></span><span className="status-pill status-danger"><i />{minutesLeft(lock.lockedUntil)} min left</span></li>)}
              </ul>
            </Panel>
          )}
        </>
      ) : overview.state !== "ready" ? <ModuleState state={overview.state} migration={ADMIN_OPS_MIGRATION} /> : null}

      <Panel title="Active sessions" hint="12 hours at most, 60 minutes idle" flush className={ui.onScroll}>
        {sessions.state !== "ready" ? <ModuleState state={sessions.state} /> : sessions.sessions.length ? (
          <div className="table-scroll"><table><thead><tr><th>Operator</th><th>Browser</th><th>Signed in</th><th>Last seen</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
            {sessions.sessions.map((session) => {
              const own = session.operatorId === actor.id;
              // Only the owner may end the owner's sessions, so other operators never see those buttons.
              const canEndOthers = manage && !own && (!session.ownerIsRoot || actor.isRoot);
              return (
                <tr key={session.id}>
                  <td><strong>{session.username ?? "–"}</strong>{session.isCurrent && <small className="table-subline">This browser</small>}</td>
                  <td>{browserOf(session.userAgent)}</td>
                  <td>{formatIstDateTime(session.createdAt) ?? "–"}</td>
                  <td>{formatIstDateTime(session.lastSeenAt) ?? "–"}</td>
                  <td>
                    <div className="pagination-actions">
                      {!session.isCurrent && (own || canEndOthers) && <form action={endSession}><input type="hidden" name="sessionId" value={session.id} /><button className="quiet-button" type="submit">End</button></form>}
                      {canEndOthers && <form action={endOperatorSessions}><input type="hidden" name="operatorId" value={session.operatorId} /><button className="quiet-button" type="submit">End all</button></form>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody></table></div>
        ) : <div className="empty-state"><h3>No active sessions</h3></div>}
      </Panel>

      <Panel title="Login history" hint="Newest first" flush className={ui.onScroll}>
        {history.state !== "ready" ? <ModuleState state={history.state} /> : history.rows.length ? (
          <div className="table-scroll"><table><thead><tr><th>Time</th><th>Event</th><th>Operator</th><th>Details</th></tr></thead><tbody>
            {history.rows.map((row) => (
              <tr key={row.id}>
                <td>{formatIstDateTime(row.createdAt) ?? "–"}</td>
                <td><span className={`status-pill ${/failed|locked|limited/.test(row.action) ? "status-danger" : row.action === "admin_login_succeeded" ? "status-good" : "status-neutral"}`}><i />{auditActionLabel(row.action)}</span></td>
                <td>{row.actorLabel ?? "–"}</td>
                <td className="details-cell">{summariseAuditDetails(row.details) || "–"}</td>
              </tr>
            ))}
          </tbody></table></div>
        ) : <div className="empty-state"><h3>No sign-ins recorded</h3></div>}
      </Panel>
    </div>
  );
}
