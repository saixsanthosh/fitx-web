import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Notice, Panel, consoleStyles as ui } from "@/components/console/ui";
import { AddModeratorForm } from "@/components/explore/add-moderator-form";
import { CommunityForm } from "@/components/explore/community-form";
import styles from "@/components/explore/explore.module.css";
import { exploreNotice } from "@/components/explore/notices";
import { ModuleState } from "@/components/module-state";
import { PendingButton } from "@/components/pending-button";
import { hasPermission, requireAdmin } from "@/lib/admin-auth";
import { exploreReadiness, getCommunity, type CommunityDetail } from "@/lib/data/explore";
import { signedLink } from "@/lib/data/explore-evidence";
import { EXPLORE_MIGRATION } from "@/lib/explore-rules";
import { pageNotice } from "@/lib/notice";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { formatIstDate } from "@/lib/time";
import { setCommunityRole } from "../../actions";

export const metadata: Metadata = { title: "Community" };

export default async function CommunityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAdmin("explore.view");
  const { id } = await params;
  const query = await searchParams;
  const back = <Link href="/explore/communities" className="text-link back-link"><ArrowLeft aria-hidden="true" size={15} />Communities</Link>;
  const moderator = hasPermission(actor, "explore.moderate");
  const isNew = id === "new";
  let community: CommunityDetail | null = null;
  if (isNew) {
    if (!moderator) notFound();
    const state = await exploreReadiness();
    if (state !== "ready") return <div className="page-stack">{back}<ModuleState state={state} migration={EXPLORE_MIGRATION} /></div>;
  } else {
    const result = await getCommunity(id);
    if (result.state === "not_found") notFound();
    if (result.state !== "ready") return <div className="page-stack">{back}<ModuleState state={result.state} migration={EXPLORE_MIGRATION} /></div>;
    community = result.community;
  }
  const admin = createAdminSupabase();
  const cover = admin && community?.coverPath ? await signedLink(admin, community.coverPath) : null;
  const notice = exploreNotice(pageNotice(query.notice, actor.id)?.code);

  return (
    <div className="page-stack narrow-stack">
      {back}
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">Community</p>
          <h1 className="break-anywhere">{community ? community.name : "New community"}</h1>
          <p className="page-lede">{community ? `/explore/c/${community.slug} · ${community.members === null ? "members not known" : `${community.members.toLocaleString("en-IN")} ${community.members === 1 ? "member" : "members"}`} · since ${formatIstDate(community.createdAt)}` : "Members find it in Explore once it is saved. Nothing is posted for it."}</p>
        </div>
      </div>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <CommunityForm
        className={ui.rise}
        moderator={moderator}
        coverUrl={cover}
        community={community ? { id: community.id, name: community.name, slug: community.slug, description: community.description, visibility: community.visibility, hasCover: Boolean(community.coverPath) } : null}
      />

      {community && (
        <Panel title="Moderators" hint="Accepted adult members who approve requests and can remove posts in this community" className={ui.onScroll}>
          {community.moderatorList.length ? (
            <ul className={styles.history}>
              {community.moderatorList.map((entry) => (
                <li key={entry.userId}>
                  <Link className="text-link" href={`/explore/accounts/${entry.userId}`}>{entry.username ? `@${entry.username}` : "A member without a username"}</Link>
                  {moderator && (
                    <form action={setCommunityRole}>
                      <input type="hidden" name="communityId" value={community.id} />
                      <input type="hidden" name="userId" value={entry.userId} />
                      <input type="hidden" name="role" value="member" />
                      <PendingButton className="quiet-button" pendingLabel="Removing…">Remove as moderator</PendingButton>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          ) : <p className={styles.subtle}>No moderators yet.</p>}
          {moderator && <AddModeratorForm communityId={community.id} />}
        </Panel>
      )}
    </div>
  );
}
