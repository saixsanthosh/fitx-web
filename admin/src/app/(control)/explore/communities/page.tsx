import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Notice, PageHead, consoleStyles as ui } from "@/components/console/ui";
import styles from "@/components/explore/explore.module.css";
import { exploreNotice } from "@/components/explore/notices";
import { ModuleState } from "@/components/module-state";
import { hasPermission, requireAdmin } from "@/lib/admin-auth";
import { listCommunities } from "@/lib/data/explore";
import { EXPLORE_MIGRATION } from "@/lib/explore-rules";
import { firstParam } from "@/lib/search-params";

export const metadata: Metadata = { title: "Communities" };

const STATE = { visible: null, limited: "Limited by FITX", hidden: "Hidden by FITX", gone: null } as const;

export default async function CommunitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAdmin("explore.view");
  const notice = exploreNotice(firstParam((await searchParams).notice));
  const result = await listCommunities();
  const moderator = hasPermission(actor, "explore.moderate");
  return (
    <div className="page-stack">
      <PageHead
        eyebrow="Explore"
        title="Communities"
        meta={result.state === "ready" ? `${result.rows.length.toLocaleString("en-IN")} ${result.rows.length === 1 ? "community" : "communities"}, created by FITX` : undefined}
        actions={moderator && result.state === "ready" ? <Link className="primary-button" href="/explore/communities/new"><Plus aria-hidden="true" size={16} />New community</Link> : undefined}
      />
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {result.state === "ready" ? (
        result.rows.length ? (
          <ul className={`${styles.cards} ${styles.grid} ${ui.stagger}`}>
            {result.rows.map((row) => (
              <li key={row.id}>
                <Link className={styles.card} href={`/explore/communities/${row.id}`}>
                  <span className={styles.cardTop}>
                    <span className={styles.cardTitle}>{row.name}</span>
                    <span className={`status-pill ${row.visibility === "private" ? "status-neutral" : "status-good"}`}><i />{row.visibility === "private" ? "Private" : "Public"}</span>
                  </span>
                  <span className={styles.subtle}>/explore/c/{row.slug}</span>
                  <span className={styles.meta}>
                    <span>{row.members === null ? "Members not known" : `${row.members.toLocaleString("en-IN")} ${row.members === 1 ? "member" : "members"}`}</span>
                    {row.pending ? <span>· {row.pending} waiting to join</span> : null}
                    {row.moderators !== null && <span>· {row.moderators} {row.moderators === 1 ? "moderator" : "moderators"}</span>}
                    {STATE[row.moderationState] && <span className="status-pill status-warn"><i />{STATE[row.moderationState]}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <section className="table-panel"><div className="empty-state"><h3>No communities yet</h3><p>{moderator ? "Communities are made here by FITX. Members can join them once they exist." : "Admins create communities here."}</p></div></section>
        )
      ) : <ModuleState state={result.state} migration={EXPLORE_MIGRATION} />}
    </div>
  );
}
