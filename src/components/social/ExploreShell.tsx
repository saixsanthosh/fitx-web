"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { m } from "framer-motion";
import { Bell, Clapperboard, Compass, MessageCircle, Newspaper, CirclePause, RefreshCw, UserRound, UsersRound, type LucideIcon } from "lucide-react";
import { useOptionalUserContext } from "@/components/app/UserContextProvider";
import { useReducedMotionSafe } from "@/components/motion/useReducedMotionSafe";
import { PageHeader } from "@/components/ui/PageHeader";
import { EXPLORE_MEDIA } from "@/data/explore-media";
import { suggestUsername, suspensionText } from "@/lib/social";
import { EXPLORE_RAIL, RAIL_BADGES, railEntries, railKeyFor, railLinkName, type RailKey } from "@/lib/social/rail";
import { shareInbox, useUnreadCounts } from "@/lib/social/realtime";
import { ExploreProvider, useExplore } from "./ExploreContext";
import { ProfileForm } from "./ProfileForm";
import { NewPostButton } from "./create/CreateSheet";
import styles from "./Explore.module.css";

/** Explore's frame: the member's session and profile, the first-time profile step, and Explore's own navigation. */
export function ExploreShell({ children }: { children: ReactNode }) {
  return (
    <ExploreProvider>
      <Gate>{children}</Gate>
    </ExploreProvider>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const { status, refresh, me } = useExplore();
  const pathname = usePathname() ?? "/explore";
  if (status === "loading") {
    return (
      <div className={styles.shell} aria-busy="true" aria-label="Loading Explore">
        <div className={styles.skeleton} style={{ height: 56 }} />
        <div className={`${styles.skeleton} ${styles.narrow}`} style={{ height: 520 }} />
      </div>
    );
  }
  if (status === "signed_out") {
    return <Status title="Sign in to use Explore" action={<Link className="fitx-button" href="/signin?next=/explore">Sign in</Link>} />;
  }
  if (status === "not_configured") return <Status title="Explore is not connected" text="FITX is not connected to its database in this environment." />;
  if (status === "unavailable") return <Status title="Explore is on its way" text="Explore needs the next FITX update. Everything else works as before." />;
  if (status === "error") {
    return <Status title="Explore did not load" text="Check your connection and try again." action={<button type="button" className="fitx-button fitx-button-secondary" onClick={() => void refresh()}><RefreshCw size={16} aria-hidden="true" />Try again</button>} />;
  }
  if (status === "paused" || status === "suspended") {
    // Settings stay open, so members can still delete their content, block and report (the database allows those).
    const title = status === "paused" ? "Explore is paused" : "Your Explore account is paused";
    const text = status === "paused"
      ? "FITX has paused Explore for now. Your posts are safe, and you can still manage or delete them."
      : `${suspensionText(me?.suspension?.until)} You can still see and delete your posts and stories, and unblock people.`;
    if (me?.profile && pathname.startsWith("/explore/settings")) {
      return (
        <div className={styles.shell}>
          <div className={`${styles.closedBanner} ${styles.narrow}`} role="status">
            <span className={styles.closedTitle}>{title}</span>
            <span>{text}</span>
          </div>
          {children}
        </div>
      );
    }
    return (
      <Status
        title={title}
        text={text}
        icon={CirclePause}
        action={me?.profile ? <Link className="fitx-button fitx-button-secondary" href="/explore/settings">Manage or delete my Explore content</Link> : undefined}
      />
    );
  }
  if (status === "setup") return <Setup />;
  return (
    <div className={styles.shell}>
      <ExploreNav />
      {children}
    </div>
  );
}

function Status({ title, text, action, icon: Icon = Compass }: { title: string; text?: string; action?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className={styles.shell}>
      <PageHeader title="Explore" />
      <div className={`${styles.empty} ${styles.narrow}`}>
        <span className={styles.emptyMark}><Icon size={26} aria-hidden="true" /></span>
        <h2 className={styles.emptyTitle}>{title}</h2>
        {text && <p className={styles.emptyText}>{text}</p>}
        {action}
      </div>
    </div>
  );
}

function Setup() {
  const { session, setMe } = useExplore();
  const context = useOptionalUserContext();
  const name = context?.data?.profile?.name ?? "";
  const hero = EXPLORE_MEDIA.bodybuilding;
  // The form starts from the member's FITX name, so it waits for it (briefly) rather than starting empty.
  const waiting = context?.status === "loading";
  if (!session) return null;
  return (
    <div className={styles.shell}>
      <section className={styles.stage} aria-labelledby="explore-setup-title">
        {/* eslint-disable-next-line @next/next/no-img-element -- a local, pre-sized still */}
        <img src={hero.src} alt="" className={styles.stagePhoto} style={{ objectPosition: "60% 45%" }} />
        <span className={styles.stageShade} aria-hidden="true" />
        <div className={styles.stageInner}>
          <h1 id="explore-setup-title" className={styles.stageTitle}>Explore</h1>
          <p className={styles.stageText}>Follow friends, share your training and find people who train like you.</p>
        </div>
      </section>
      <div className={`${styles.panel} ${styles.narrow}`}>
        <h2 className={styles.panelTitle}>Your Explore profile</h2>
        <p className={`${styles.note} mb-4`}>Your workouts, food and body data stay private. Only what you post is shared.</p>
        {waiting ? <div className={styles.skeleton} style={{ height: 300 }} aria-busy="true" aria-label="Loading" /> : <ProfileForm
          db={session.db}
          compact
          submitLabel="Create profile"
          initial={{ username: suggestUsername(name), displayName: name.slice(0, 50), bio: "", isPrivate: false, commentPolicy: "everyone" }}
          onSaved={(profile) => setMe({ profile, unread: 0, requests: 0 })}
        />}
      </div>
    </div>
  );
}

const RAIL_ICONS: Record<RailKey, LucideIcon> = {
  feed: Newspaper, discover: Compass, videos: Clapperboard, community: UsersRound, messages: MessageCircle,
};

type NavItem = { key: string; href: string; label: string; icon: LucideIcon; active: boolean; badge?: RailKey };

/**
 * The Notifications bell, live: every ping on the member's inbox topic (a notice, a message, a request) reads the
 * member's Explore state again, at most once a second, so the bell's count follows without a reload. The channel is
 * shared with the message pages (shareInbox), and while Realtime is not reachable the provider's read on tab return
 * still updates it.
 */
function useLiveBell(userId: string | null, refresh: () => Promise<void>) {
  useEffect(() => {
    if (!userId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = shareInbox(userId, () => {
      if (timer !== null) return;
      timer = setTimeout(() => { timer = null; void refresh(); }, 1000);
    });
    return () => {
      if (timer !== null) clearTimeout(timer);
      stop();
    };
  }, [userId, refresh]);
}

/** Explore's rail: the ready entries of EXPLORE_RAIL, then Notifications and the member's profile, and "New post". */
function ExploreNav() {
  const pathname = usePathname() ?? "/explore";
  const reduced = useReducedMotionSafe();
  const { me, session, refresh } = useExplore();
  const userId = session?.userId ?? null;
  const username = me?.profile?.username ?? "";
  const unread = (me?.unread ?? 0) + (me?.requests ?? 0);
  // The same counts the Messages badge shows (one poller per page), so the link's name carries them too.
  const { messages: unreadMessages } = useUnreadCounts();
  const profileHref = `/explore/u/${username}`;
  const current = railKeyFor(pathname, EXPLORE_RAIL);
  useLiveBell(userId, refresh);
  const items: NavItem[] = [
    ...railEntries(EXPLORE_RAIL, me?.videos === true).map((entry) => ({ key: entry.key, href: entry.href, label: entry.label, icon: RAIL_ICONS[entry.key], active: current === entry.key, badge: entry.key })),
    { key: "activity", href: "/explore/notifications", label: "Notifications", icon: Bell, active: pathname.startsWith("/explore/notifications") },
    { key: "profile", href: profileHref, label: "Profile", icon: UserRound, active: pathname === profileHref || pathname.startsWith("/explore/settings") },
  ];
  return (
    <nav className={styles.subnav} aria-label="Explore">
      <div className={styles.subnavLinks}>
        {items.map((item) => {
          const Icon = item.icon;
          const badge = item.key === "activity" && unread > 0;
          const RailBadge = item.badge ? RAIL_BADGES[item.badge] : undefined;
          return (
            <Link key={item.key} href={item.href} className={styles.subnavLink} aria-current={item.active ? "page" : undefined} aria-label={badge ? `${item.label}, ${unread} new` : railLinkName(item.key, item.label, unreadMessages)}>
              {item.active && <m.span layoutId={reduced ? undefined : "explore-nav-marker"} className={styles.subnavMarker} transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
              <span className={styles.subnavIcon}>
                <Icon size={19} aria-hidden="true" />
                {badge && <span className={styles.badge} aria-hidden="true">{unread > 99 ? "99+" : unread}</span>}
                {RailBadge && <RailBadge />}
              </span>
              <span className={styles.subnavLabel}>{item.label}</span>
            </Link>
          );
        })}
      </div>
      <NewPostButton videosOn={me?.videos === true} />
    </nav>
  );
}
