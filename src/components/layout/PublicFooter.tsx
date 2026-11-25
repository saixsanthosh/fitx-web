import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { publicContact } from "@/components/landing/site-contact";
import { LEGAL_NAV, PUBLIC_NAV } from "./publicNav";
import styles from "./PublicFooter.module.css";

const links = [...PUBLIC_NAV, ...LEGAL_NAV];

/** The public pages' footer: the mark, the site and legal links, and the owner's contact links when set. */
export async function PublicFooter() {
  const contact = await publicContact();
  return (
    <footer className="fitx-inverse fitx-band-end border-t border-fitx-divider bg-background">
      <div className="fitx-container grid gap-6 py-9 md:grid-cols-[1fr_auto] md:items-start">
        <div className="grid gap-2">
          <Link href="/" aria-label="FITX home" className="inline-flex min-h-11 items-center"><Logo size={30} /></Link>
          <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-fitx-text-secondary">Train smart. Live fit.</p>
        </div>
        <nav aria-label="Footer navigation" className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm text-fitx-text-secondary sm:grid-cols-4 md:grid-cols-2 lg:grid-cols-4">
          {links.map(({ label, href }) => <Link key={href} href={href} className={styles.footerLink}>{label}</Link>)}
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-fitx-divider pt-4 text-[11px] text-fitx-text-disabled md:col-span-2">
          <p>© {new Date().getFullYear()} FITX. Not medical advice.</p>
          {(contact.instagram || contact.email) && (
            <ul className="flex flex-wrap items-center gap-x-5 text-xs text-fitx-text-secondary" aria-label="Contact">
              {contact.instagram && (
                <li><a href={contact.instagram.url} target="_blank" rel="noopener noreferrer" className={styles.footerLink} aria-label={`Instagram @${contact.instagram.handle} (opens in a new tab)`}>Instagram <ArrowUpRight size={13} aria-hidden="true" /></a></li>
              )}
              {contact.email && <li><a href={`mailto:${contact.email}`} className={styles.footerLink}>{contact.email}</a></li>}
            </ul>
          )}
        </div>
      </div>
    </footer>
  );
}
