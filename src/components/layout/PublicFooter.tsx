import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, Mail } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { BRAND } from "@/config/brand";
import { LEGAL_NAV, PUBLIC_NAV } from "./publicNav";
import styles from "./PublicFooter.module.css";

const links = [...PUBLIC_NAV, ...LEGAL_NAV];
export function PublicFooter() {
  return <footer className="fitx-inverse border-t border-fitx-divider bg-background pb-[env(safe-area-inset-bottom)]"><div className="fitx-container grid gap-8 py-9 md:grid-cols-[1fr_auto]">
    <div><Link href="/" aria-label="FITX home" className="inline-flex min-h-11 items-center gap-2"><Logo size={31}/></Link><p className="mt-3 max-w-sm text-xs leading-5 text-fitx-text-secondary">Workout planning, food logging, and progress tracking in one personal fitness workspace.</p></div>
    <nav aria-label="Footer navigation" className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm text-fitx-text-secondary sm:grid-cols-4 md:grid-cols-2 lg:grid-cols-4">{links.map(({ label, href }) => <Link key={href} href={href} className={styles.footerLink}>{label}</Link>)}</nav>
    <section aria-labelledby="footer-contact-title" className="border-t-2 border-t-fitx-primary border-x border-b border-fitx-divider bg-fitx-surface p-4 sm:p-5 md:col-span-2">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-[11px] font-bold uppercase tracking-[0.2em] text-fitx-primary-text">FITX / Stay connected</p><h2 id="footer-contact-title" className="mt-1 text-lg font-semibold text-fitx-text">We’re easy to reach.</h2></div>
        <p className="text-xs text-fitx-text-secondary">Follow along or get a hand with your account.</p>
      </div>
      <div className={styles.contactGrid}>
        <a href={BRAND.instagramUrl} rel="noopener noreferrer" target="_blank" aria-label="Open FITX on Instagram @saixsanthosh in a new tab" className={styles.contactCard}>
          <span className={styles.contactTop}>
            <span className={styles.contactIdentity}>
              <span className={styles.portraitRing}><Image src="/images/instagram-profile.png" alt="Sai Santhosh" width={44} height={44} sizes="44px" className={styles.portrait}/></span>
              <span className={styles.contactLabel}>Instagram</span>
            </span>
            <ArrowUpRight size={17} aria-hidden="true" className={styles.contactArrow}/>
          </span>
          <span className={styles.contactName}>@saixsanthosh</span>
          <span className={styles.contactBottom}><span className={styles.contactLine}/><span className={styles.contactAction}>Follow the journey</span></span>
        </a>
        <a href={`mailto:${BRAND.supportEmail}`} aria-label={`Email FITX help desk at ${BRAND.supportEmail}`} className={styles.contactCard}>
          <span className={styles.contactTop}>
            <span className={styles.contactIdentity}>
              <span className={styles.mailMark}><Mail size={18} aria-hidden="true"/></span>
              <span className={styles.contactLabel}>FITX support</span>
            </span>
            <ArrowUpRight size={17} aria-hidden="true" className={styles.contactArrow}/>
          </span>
          <span className={styles.helpCopy}><span className={styles.contactName}>Need a hand?</span><span className={styles.helpDescription}>We’re here to help.</span></span>
          <span className={styles.contactBottom}><span className={styles.contactLine}/><span className={styles.supportEmail}>{BRAND.supportEmail}</span></span>
        </a>
      </div>
    </section>
    <p className="border-t border-fitx-divider pt-4 text-[11px] text-fitx-text-disabled md:col-span-2">© {new Date().getFullYear()} FITX. Use training and nutrition tools with care.</p>
  </div></footer>;
}
