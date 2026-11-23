"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { m } from "framer-motion";
import { Bell, Compass, Newspaper, Plus, RefreshCw, UserRound } from "lucide-react";
import { useOptionalUserContext } from "@/components/app/UserContextProvider";
import { useReducedMotionSafe } from "@/components/motion/useReducedMotionSafe";
import { PageHeader } from "@/components/ui/PageHeader";
import { EXPLORE_MEDIA } from "@/data/explore-media";
import { suggestUsername } from "@/lib/social";
import { ExploreProvider, useExplore } from "./ExploreContext";
import { ProfileForm } from "./ProfileForm";
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
  const { status, refresh } = useExplore();
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
  if (status === "setup") return <Setup />;
  return (
    <div className={styles.shell}>
      <ExploreNav />
      {children}
    </div>
  );
}

function Status({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className={styles.shell}>
      <PageHeader title="Explore" />
      <div className={`${styles.empty} ${styles.narrow}`}>
        <span className={styles.emptyMark}><Compass size={26} aria-hidden="true" /></span>
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

const LINKS = [
  { key: "feed", href: "/explore", label: "Feed", icon: Newspaper, match: (path: string) => path === "/explore" },
  { key: "discover", href: "/explore/discover", label: "Discover", icon: Compass, match: (path: string) => path.startsWith("/explore/discover") },
  { key: "activity", href: "/explore/notifications", label: "Notifications", icon: Bell, match: (path: string) => path.startsWith("/explore/notifications") },
] as const;

function ExploreNav() {
  const pathname = usePathname() ?? "/explore";
  const reduced = useReducedMotionSafe();
  const { me } = useExplore();
  const username = me?.profile?.username ?? "";
  const unread = (me?.unread ?? 0) + (me?.requests ?? 0);
  const profileHref = `/explore/u/${username}`;
  const items = [
    ...LINKS.map((link) => ({ ...link, active: link.match(pathname) })),
    { key: "profile", href: profileHref, label: "Profile", icon: UserRound, active: pathname === profileHref || pathname.startsWith("/explore/settings") },
  ];
  return (
    <nav className={styles.subnav} aria-label="Explore">
      <div className={styles.subnavLinks}>
        {items.map((item) => {
          const Icon = item.icon;
          const badge = item.key === "activity" && unread > 0;
          return (
            <Link key={item.key} href={item.href} className={styles.subnavLink} aria-current={item.active ? "page" : undefined} aria-label={badge ? `${item.label}, ${unread} new` : item.label}>
              {item.active && <m.span layoutId={reduced ? undefined : "explore-nav-marker"} className={styles.subnavMarker} transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
              <span className={styles.subnavIcon}>
                <Icon size={19} aria-hidden="true" />
                {badge && <span className={styles.badge} aria-hidden="true">{unread > 99 ? "99+" : unread}</span>}
              </span>
              <span className={styles.subnavLabel}>{item.label}</span>
            </Link>
          );
        })}
      </div>
      <Link href="/explore/new" className={styles.newPost} aria-label="New post"><Plus size={19} aria-hidden="true" /><span className={styles.newPostLabel}>New post</span></Link>
    </nav>
  );
}
