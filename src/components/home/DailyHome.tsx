"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { AnimatePresence, m } from "framer-motion";
import { checkSession, signInHref } from "@/components/account/session-state";
import { useOptionalUserContext } from "@/components/app/UserContextProvider";
import { useReducedMotionSafe } from "@/components/motion";
import { HomeScene } from "@/components/home/HomeScene";
import type { Quote, QuoteTheme } from "@/data/quotes";
import { getDailyQuote } from "@/lib/home/daily-quote";
import { greeting, longDate } from "@/lib/home/greeting";
import { sceneFor } from "@/lib/home/scenes";
import { firstName } from "@/lib/onboarding/form";
import { createClient } from "@/lib/supabase/client";
import styles from "./DailyHome.module.css";

const THEME_LABEL: Readonly<Record<QuoteTheme, string>> = {
  discipline: "Discipline",
  consistency: "Consistency",
  strength: "Strength",
  mind: "Mind",
  growth: "Growth",
  recovery: "Recovery",
};

/** The hour on this device, checked every minute so the greeting turns with the day; null on the server. */
function subscribeToMinute(onChange: () => void) {
  const timer = window.setInterval(onChange, 60_000);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onChange);
  };
}
function useHour(): number | null {
  return useSyncExternalStore(subscribeToMinute, () => new Date().getHours(), () => null);
}

type Loaded = { key: string; quote: Quote } | { key: string; quote: null };

/**
 * Home (owner's phase 6): only a greeting with the member's name and one quote a day, over a moving scene that
 * matches the quote's mood. The quote never repeats for this member (src/lib/home/daily-quote.ts).
 */
export function DailyHome({ today }: { today: string }) {
  const context = useOptionalUserContext();
  const reduced = useReducedMotionSafe();
  const hour = useHour();
  // The shared profile normally gives the member's id; if it failed to load, ask the session directly.
  const [session, setSession] = useState<{ user: string | null; ended: boolean }>({ user: null, ended: false });
  const contextFailed = context === null || context.status === "error";
  useEffect(() => {
    if (!contextFailed) return;
    let live = true;
    const supabase = createClient();
    if (!supabase) return;
    void (async () => {
      const { state, user } = await checkSession<User>(() => supabase.auth.getUser());
      if (live) setSession({ user: user?.id ?? null, ended: state === "signed_out" });
    })();
    return () => {
      live = false;
    };
  }, [contextFailed]);
  const userId = context?.data?.userId ?? session.user;
  // An ended session (signed out elsewhere, or Home shown again after Log out) says so, never loads for ever.
  const signedOut = context?.status === "signed_out" || session.ended;
  const name = firstName(context?.data?.profile?.name);
  const key = userId ? `${userId}:${today}` : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!key || !userId) return;
    let live = true;
    void getDailyQuote(createClient(), { userId, localDate: today })
      .then((result) => { if (live) setLoaded({ key, quote: result.quote }); })
      .catch(() => { if (live) setLoaded({ key, quote: null }); });
    return () => {
      live = false;
    };
  }, [key, userId, today]);

  const quote = loaded && loaded.key === key ? loaded.quote : null;
  const pending = !loaded || loaded.key !== key;
  const scene = quote ? sceneFor(quote.scene) : null;
  const hello = hour === null ? null : greeting(hour, context?.status === "ready" ? name : null);
  const ease = [0.16, 1, 0.3, 1] as const;

  return (
    <section className={styles.home} aria-labelledby="home-greeting">
      <HomeScene scene={scene} />
      <div className={styles.content}>
        <header className={styles.top}>
          <p className={styles.date}>{longDate(today)}</p>
          <h1 id="home-greeting" className={styles.greeting}>
            <AnimatePresence mode="wait" initial={false}>
              <m.span
                key={hello ?? "…"}
                className={styles.greetingText}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: -10 }}
                transition={{ duration: reduced ? 0.2 : 0.8, ease }}
              >
                {hello ?? "Welcome"}
              </m.span>
            </AnimatePresence>
          </h1>
        </header>

        <figure className={styles.quote} aria-label="Today's quote" aria-busy={(pending && !signedOut) || undefined}>
          <AnimatePresence mode="wait">
            {quote ? (
              <m.div key={quote.id} initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: reduced ? 0.15 : 0.5 } }}>
                <m.p className={styles.theme} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0.2 : 0.8, delay: reduced ? 0 : 0.3 }}>
                  <span aria-hidden="true" className={styles.rule} />{THEME_LABEL[quote.theme]}
                </m.p>
                <blockquote className={styles.text}>
                  <p>
                    {reduced ? quote.text : quote.text.split(" ").map((word, index) => (
                      <m.span
                        key={`${quote.id}-${index}`}
                        className={styles.word}
                        initial={{ opacity: 0, y: "0.45em" }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.9, ease, delay: 0.45 + index * 0.055 }}
                      >
                        {word}{" "}
                      </m.span>
                    ))}
                  </p>
                </blockquote>
                <m.figcaption className={styles.caption} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0.2 : 0.8, delay: reduced ? 0 : 0.9 + quote.text.split(" ").length * 0.055 }}>
                  {quote.author ? <>{quote.author}{quote.source ? <cite>, {quote.source}</cite> : null}</> : "FITX"}
                </m.figcaption>
              </m.div>
            ) : signedOut ? (
              <m.p key="signed-out" role="status" className={styles.caption} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                You’re signed out. <Link href={signInHref("/dashboard")} className={styles.signIn}>Sign in again</Link> to see today’s quote.
              </m.p>
            ) : pending ? (
              <m.div key="loading" className={styles.loading} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <span /><span />
              </m.div>
            ) : (
              <m.p key="none" className={styles.caption} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>Today’s quote could not be loaded. It will be here when you come back.</m.p>
            )}
          </AnimatePresence>
        </figure>
      </div>
    </section>
  );
}
