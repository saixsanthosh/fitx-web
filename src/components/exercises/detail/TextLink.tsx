import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A brand-coloured text link with a 44 px touch target. globals.css sets `a { color: inherit; text-decoration: none }`
 * outside any cascade layer, which beats Tailwind's colour and underline utilities on the link itself, so the colour
 * and the hover underline sit on an inner span.
 */
export function TextLink({ href, children, className = "", size = "text-sm" }: { href: string; children: ReactNode; className?: string; size?: string }) {
  return (
    <Link href={href} className={`group inline-flex min-h-11 items-center rounded-md px-1 font-semibold ${size} ${className}`}>
      <span className="inline-flex items-center gap-1.5 text-fitx-primary-text group-hover:underline group-hover:underline-offset-2">{children}</span>
    </Link>
  );
}
