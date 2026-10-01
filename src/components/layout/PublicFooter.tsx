import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { BRAND } from "@/config/brand";

const links = [["Features", "/features"], ["About", "/about"], ["Pricing", "/pricing"], ["Privacy", "/privacy"], ["Terms", "/terms"], ["Cookies", "/cookies"], ["Refunds", "/refunds"]] as const;
export function PublicFooter() {
  return <footer className="border-t border-fitx-divider bg-[#080b0c]"><div className="mx-auto grid max-w-7xl gap-8 px-4 py-9 sm:px-6 md:grid-cols-[1fr_auto] lg:px-8">
    <div><Link href="/" className="inline-flex items-center gap-2"><Logo size={31}/><span className="font-medium">FITX</span></Link><p className="mt-3 max-w-sm text-xs leading-5 text-fitx-text-secondary">Workout planning, food logging, and progress tracking in one personal fitness workspace.</p><div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-fitx-primary"><a href={BRAND.instagramUrl} rel="noopener noreferrer" target="_blank" className="hover:underline">Instagram @saixsanthosh</a><a href={`mailto:${BRAND.supportEmail}`} className="hover:underline">Help desk: {BRAND.supportEmail}</a></div></div>
    <nav aria-label="Footer navigation" className="grid grid-cols-2 gap-x-8 gap-y-3 text-xs text-fitx-text-secondary sm:grid-cols-4 md:grid-cols-2 lg:grid-cols-4">{links.map(([label, href]) => <Link key={href} href={href} className="hover:text-fitx-text">{label}</Link>)}</nav>
    <p className="border-t border-fitx-divider pt-4 text-[11px] text-fitx-text-disabled md:col-span-2">© {new Date().getFullYear()} FITX. Use training and nutrition tools with care.</p>
  </div></footer>;
}
