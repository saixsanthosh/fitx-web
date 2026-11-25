"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AuthStage } from "./AuthStage";
import { useAskServerWhenRestored } from "./useAskServerWhenRestored";
import s from "./auth.module.css";

/**
 * The one-screen frame of the sign-in, sign-up and password pages: the moving stage and the form panel.
 * `footer` sits at the bottom of the panel, above the legal line. A sign-in page shown again from the tab's history
 * while the member may be signed in asks the server again (useAskServerWhenRestored, bug 40).
 */
export function AuthScreen({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  useAskServerWhenRestored();
  return (
    <main className={s.screen}>
      <AuthStage />
      <section className={s.panel} aria-label="Account access">
        <div className={s.panelInner} id="main-content">
          <div className={s.steps}>{children}</div>
          <div className={s.footer}>
            {footer}
            <p className={s.legal}>
              By continuing, you agree to the FITX <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
