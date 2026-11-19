import Link from "next/link";
import type { ReactNode } from "react";
import { AuthStage } from "./AuthStage";
import s from "./auth.module.css";

/**
 * The one-screen frame of the sign-in, sign-up and password pages: the moving stage and the form panel.
 * `footer` sits at the bottom of the panel, above the legal line.
 */
export function AuthScreen({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
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
