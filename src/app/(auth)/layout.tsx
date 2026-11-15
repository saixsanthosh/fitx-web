import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { ThemeSwitcher } from "@/components/ui/ThemeSwitcher";
import { IMG } from "@/data/images";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  alternates: null,
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-layout">
      <section className="auth-visual" aria-label="FITX training">
        <Image
          src={IMG.workoutMan}
          alt="Athlete training in a sunlit gym"
          fill
          priority
          sizes="(max-width: 900px) 100vw, 52vw"
          className="auth-visual-image"
        />
        <div className="auth-visual-shade" aria-hidden="true" />
        <div className="auth-visual-content">
          <Link href="/" aria-label="FITX home"><Logo size={42} /></Link>
          <div className="auth-visual-copy">
            <p className="auth-visual-kicker">TRAIN SMART. LIVE FIT.</p>
            <h2>Make every move count.</h2>
            <p>Your training, nutrition and progress — connected in one place.</p>
          </div>
          <p className="auth-visual-note">A clearer way to build a routine that lasts.</p>
        </div>
      </section>
      <section className="auth-main" aria-label="Account access">
        <div className="auth-toolbar"><ThemeSwitcher /></div>
        <div className="auth-content">
          {children}
          <p className="auth-legal-note">By continuing, you agree to FITX&apos;s <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.</p>
        </div>
      </section>
    </main>
  );
}
