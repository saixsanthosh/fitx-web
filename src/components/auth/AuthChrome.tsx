"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui/Logo";
import { AuthVisualImage } from "@/app/(auth)/AuthVisualImage";
import { drawsOwnScreen } from "./screen-paths";

/**
 * The (auth) group's frame. Sign-in, sign-up and the password pages draw their own screen; anything else in
 * the group (onboarding) keeps the photo frame it was designed in, until it moves to its own.
 */
export function AuthChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (drawsOwnScreen(pathname)) return <>{children}</>;
  return (
    <main className="auth-layout">
      <section className="auth-visual" aria-label="FITX training">
        <AuthVisualImage />
        <div className="auth-visual-shade" aria-hidden="true" />
        <div className="auth-visual-content">
          <Link href="/" aria-label="FITX home"><Logo size={42} /></Link>
          <div className="auth-visual-copy">
            <p className="auth-visual-kicker">TRAIN SMART. LIVE FIT.</p>
            <p className="auth-visual-title">Make every move count.</p>
          </div>
          <span />
        </div>
      </section>
      <section className="auth-main" aria-label="Account access">
        <div className="auth-content" id="main-content">
          {children}
          <p className="auth-legal-note">By continuing, you agree to FITX&apos;s <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.</p>
        </div>
      </section>
    </main>
  );
}
