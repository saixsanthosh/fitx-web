import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Notice, Panel, consoleStyles as ui } from "@/components/console/ui";
import { CoverPicker } from "@/components/explore/cover-picker";
import styles from "@/components/explore/explore.module.css";
import { exploreNotice } from "@/components/explore/notices";
import { ModuleState } from "@/components/module-state";
import { PendingButton } from "@/components/pending-button";
import { hasPermission, requireAdmin } from "@/lib/admin-auth";
import { exploreReadiness, getCommunity, type CommunityDetail } from "@/lib/data/explore";
import { signedLink } from "@/lib/data/explore-evidence";
import { COMMUNITY_LIMITS, EXPLORE_MIGRATION } from "@/lib/explore-rules";
import { firstParam } from "@/lib/search-params";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { formatIstDate } from "@/lib/time";
import { saveCommunity, setCommunityRole } from "../../actions";

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
  const notice = exploreNotice(firstParam(query.notice), firstParam(query.message));

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

      <form action={saveCommunity} className={`stack-form ${ui.rise}`}>
        {community && <input type="hidden" name="id" value={community.id} />}
        <Panel title="Details">
          <fieldset className={`stack-form ${styles.fieldset}`} disabled={!moderator}>
            <label>Name<input name="name" required maxLength={COMMUNITY_LIMITS.name} defaultValue={community?.name ?? ""} /></label>
            <label>Address<input name="slug" maxLength={COMMUNITY_LIMITS.slugMax} pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]" defaultValue={community?.slug ?? ""} aria-describedby="slug-note" /></label>
            <p className="field-note" id="slug-note">Lower-case letters, digits and dashes. Leave it empty to make one from the name.</p>
            <label>Description<textarea name="description" maxLength={COMMUNITY_LIMITS.description} rows={3} defaultValue={community?.description ?? ""} /></label>
            <label>Who can join<select name="visibility" defaultValue={community?.visibility ?? "public"}><option value="public">Public: adults join freely</option><option value="private">Private: by request</option></select></label>
            <CoverPicker currentUrl={cover} />
            {community?.coverPath && <label className="check-label"><input type="checkbox" name="remove_cover" />Remove the cover</label>}
          </fieldset>
        </Panel>
        {moderator && <PendingButton className="primary-button" pendingLabel="Saving…">Save community</PendingButton>}
      </form>

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
          {moderator && (
            <form action={setCommunityRole} className={`stack-form ${styles.inline}`}>
              <input type="hidden" name="communityId" value={community.id} />
              <input type="hidden" name="role" value="moderator" />
              <label>Explore username<input name="username" required autoComplete="off" placeholder="name.surname" /></label>
              <PendingButton className="quiet-button" pendingLabel="Adding…">Add moderator</PendingButton>
            </form>
          )}
        </Panel>
      )}
    </div>
  );
}
