import Link from "next/link";
import { ArrowUpRight, Camera, Mail } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { BRAND } from "@/config/brand";

const links = [["Features", "/features"], ["About", "/about"], ["Pricing", "/pricing"], ["Privacy", "/privacy"], ["Terms", "/terms"], ["Cookies", "/cookies"], ["Refunds", "/refunds"]] as const;
export function PublicFooter() {
  return <footer className="border-t border-fitx-divider bg-[#080b0c]"><div className="mx-auto grid max-w-7xl gap-8 px-4 py-9 sm:px-6 md:grid-cols-[1fr_auto] lg:px-8">
    <div><Link href="/" className="inline-flex items-center gap-2"><Logo size={31}/><span className="font-medium">FITX</span></Link><p className="mt-3 max-w-sm text-xs leading-5 text-fitx-text-secondary">Workout planning, food logging, and progress tracking in one personal fitness workspace.</p></div>
    <nav aria-label="Footer navigation" className="grid grid-cols-2 gap-x-8 gap-y-3 text-xs text-fitx-text-secondary sm:grid-cols-4 md:grid-cols-2 lg:grid-cols-4">{links.map(([label, href]) => <Link key={href} href={href} className="hover:text-fitx-text">{label}</Link>)}</nav>
    <section aria-labelledby="footer-contact-title" className="border-t-2 border-t-fitx-primary border-x border-b border-fitx-divider bg-[#0d1312] p-4 sm:p-5 md:col-span-2">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-fitx-primary">FITX / Stay connected</p><h2 id="footer-contact-title" className="mt-1 text-lg font-semibold text-fitx-text">We’re easy to reach.</h2></div>
        <p className="text-xs text-fitx-text-secondary">Follow along or get a hand with your account.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <a href={BRAND.instagramUrl} rel="noopener noreferrer" target="_blank" aria-label="Open FITX on Instagram @saixsanthosh in a new tab" className="group flex min-w-0 items-center gap-3 border border-fitx-divider bg-[#101716] p-3 transition-colors hover:border-fitx-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fitx-primary sm:p-4">
          <span className="flex size-10 shrink-0 items-center justify-center border border-fitx-divider text-fitx-primary"><Camera size={18} aria-hidden="true" /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-fitx-text">Instagram</span><span className="mt-0.5 block truncate text-xs text-fitx-text-secondary">@saixsanthosh</span></span>
          <ArrowUpRight size={17} aria-hidden="true" className="shrink-0 text-fitx-text-secondary transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </a>
        <a href={`mailto:${BRAND.supportEmail}`} aria-label={`Email FITX help desk at ${BRAND.supportEmail}`} className="group flex min-w-0 items-center gap-3 border border-fitx-divider bg-[#101716] p-3 transition-colors hover:border-fitx-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fitx-primary sm:p-4">
          <span className="flex size-10 shrink-0 items-center justify-center border border-fitx-divider text-fitx-primary"><Mail size={18} aria-hidden="true" /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-fitx-text">Help desk</span><span className="mt-0.5 block truncate text-xs text-fitx-text-secondary">{BRAND.supportEmail}</span></span>
          <ArrowUpRight size={17} aria-hidden="true" className="shrink-0 text-fitx-text-secondary transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </a>
      </div>
    </section>
    <p className="border-t border-fitx-divider pt-4 text-[11px] text-fitx-text-disabled md:col-span-2">© {new Date().getFullYear()} FITX. Use training and nutrition tools with care.</p>
  </div></footer>;
}
