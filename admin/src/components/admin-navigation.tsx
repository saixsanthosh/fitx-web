"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import {
  Apple,
  Bell,
  ChartNoAxesCombined,
  CreditCard,
  Dumbbell,
  LayoutDashboard,
  LifeBuoy,
  Menu,
  Settings2,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { EASE_OUT, prefersReducedMotion } from "@/components/motion/reduced-motion";
import { isActiveRoute, sectionForPath, visibleSections, type AdminSection, type VisibleSection } from "./admin-sections";
import styles from "./admin-shell.module.css";

const ICONS: Record<AdminSection["icon"], LucideIcon> = {
  dashboard: LayoutDashboard,
  users: Users,
  workouts: Dumbbell,
  nutrition: Apple,
  subscriptions: CreditCard,
  support: LifeBuoy,
  notifications: Bell,
  reports: ChartNoAxesCombined,
  security: ShieldCheck,
  settings: Settings2,
};

function isSectionActive(pathname: string, section: VisibleSection) {
  return section.routes.some((route) => isActiveRoute(pathname, route.href));
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The ten sections, numbered. A marker glides to the active section (Web Animations API, transform
 * only); sub-pages of the active section open beneath it. The server checks every page again.
 */
function SectionList({ sections, onNavigate, idPrefix }: { sections: VisibleSection[]; onNavigate?: () => void; idPrefix: string }) {
  const pathname = usePathname();
  const listRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLSpanElement>(null);
  const placed = useRef<{ y: number; h: number } | null>(null);

  useIsomorphicLayoutEffect(() => {
    const list = listRef.current;
    const marker = markerRef.current;
    if (!list || !marker) return;
    const active = list.querySelector<HTMLElement>("[data-active='true'] > a");
    if (!active) {
      marker.style.opacity = "0";
      return;
    }
    const y = active.offsetTop;
    const h = active.offsetHeight;
    marker.style.opacity = "1";
    marker.style.transform = `translate3d(0, ${y}px, 0) scaleY(${h / 40})`;
    const previous = placed.current;
    placed.current = { y, h };
    if (previous && (previous.y !== y || previous.h !== h) && !prefersReducedMotion()) {
      marker.animate(
        [
          { transform: `translate3d(0, ${previous.y}px, 0) scaleY(${previous.h / 40})` },
          { transform: `translate3d(0, ${y}px, 0) scaleY(${h / 40})` },
        ],
        { duration: 420, easing: EASE_OUT },
      );
    }
  }, [pathname, sections.length]);

  return (
    <div className={styles.sectionsWrap} ref={listRef}>
      <span className={styles.marker} ref={markerRef} aria-hidden="true" />
      <ol className={styles.sections}>
      {sections.map((section) => {
        const Icon = ICONS[section.icon];
        const active = isSectionActive(pathname, section);
        const subId = `${idPrefix}-${section.number}`;
        return (
          <li key={section.number} data-active={active}>
            <Link
              href={section.href}
              className={styles.sectionLink}
              aria-current={active && section.visibleRoutes.length === 1 ? "page" : undefined}
              aria-describedby={active && section.visibleRoutes.length > 1 ? subId : undefined}
              onClick={onNavigate}
            >
              <span className={styles.sectionNumber} aria-hidden="true">{section.number}</span>
              <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
              <span className={styles.sectionLabel}>{section.label}</span>
            </Link>
            {active && section.visibleRoutes.length > 1 && (
              <ul className={styles.subRoutes} id={subId} aria-label={section.label}>
                {section.visibleRoutes.map((route) => {
                  const current = isActiveRoute(pathname, route.href);
                  return (
                    <li key={route.href}>
                      <Link href={route.href} className={styles.subLink} aria-current={current ? "page" : undefined} onClick={onNavigate}>{route.label}</Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
      </ol>
    </div>
  );
}

/** The rail on wide screens. */
export function AdminNavigation({ allowed }: { allowed: readonly string[] }) {
  const sections = visibleSections(allowed);
  return <nav aria-label="Sections" className={styles.railNav}><SectionList sections={sections} idPrefix="rail" /></nav>;
}

/** The phone and tablet menu: a modal dialog (focus stays inside, Escape closes) that slides in. */
export function MobileMenu({ allowed }: { allowed: readonly string[] }) {
  const sections = visibleSections(allowed);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  const close = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog?.open) return;
    const panel = dialog.firstElementChild as HTMLElement | null;
    if (!panel || prefersReducedMotion()) {
      dialog.close();
      return;
    }
    const animation = panel.animate([{ transform: "translate3d(0, 0, 0)" }, { transform: "translate3d(-100%, 0, 0)" }], { duration: 220, easing: EASE_OUT });
    animation.onfinish = () => dialog.close();
  }, []);

  const open = () => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    const panel = dialog.firstElementChild as HTMLElement | null;
    if (panel && !prefersReducedMotion()) {
      panel.animate([{ transform: "translate3d(-100%, 0, 0)" }, { transform: "translate3d(0, 0, 0)" }], { duration: 320, easing: EASE_OUT });
      dialog.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    }
  };

  useEffect(() => {
    close();
  }, [pathname, close]);

  return (
    <>
      <button ref={openerRef} type="button" className={styles.menuButton} onClick={open} aria-haspopup="dialog" aria-label="Open menu">
        <Menu aria-hidden="true" size={20} />
      </button>
      <dialog
        ref={dialogRef}
        className={styles.drawer}
        aria-label="Menu"
        onClose={() => openerRef.current?.focus()}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <div className={styles.drawerPanel}>
          <div className={styles.drawerTop}>
            <span className={styles.drawerTitle}>FITX Admin</span>
            <button type="button" className={styles.iconButton} onClick={close} aria-label="Close menu"><X aria-hidden="true" size={20} /></button>
          </div>
          <nav aria-label="Sections"><SectionList sections={sections} onNavigate={close} idPrefix="drawer" /></nav>
        </div>
      </dialog>
    </>
  );
}

/** The current section's number and name in the top bar; it slides in when the section changes. */
export function SectionTitle() {
  const pathname = usePathname();
  const section = sectionForPath(pathname);
  const ref = useRef<HTMLSpanElement>(null);
  const key = section?.number ?? "account";

  useEffect(() => {
    if (!ref.current || prefersReducedMotion()) return;
    const animation = ref.current.animate(
      [{ opacity: 0, transform: "translate3d(0, 60%, 0)" }, { opacity: 1, transform: "translate3d(0, 0, 0)" }],
      { duration: 380, easing: EASE_OUT },
    );
    return () => animation.cancel();
  }, [key]);

  return (
    <span className={styles.sectionTitle} aria-hidden="true">
      <span ref={ref} className={styles.sectionTitleInner}>
        <span className={styles.sectionTitleNumber}>{section?.number ?? "··"}</span>
        <span>{section?.label ?? "Your account"}</span>
      </span>
    </span>
  );
}
