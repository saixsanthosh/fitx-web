import { isAppNavIcon, type NavItem } from "@/config/navigation";
import { cn } from "@/lib/utils";

/**
 * A nav item's icon: app icons take `active` and carry their own motion (nav-icons.css); lucide icons get a
 * heavier stroke when active and the small shared lift on hover (`fitx-navglyph`).
 */
export function NavGlyph({ icon: Icon, size, active, className }: { icon: NavItem["icon"]; size: number; active: boolean; className?: string }) {
  if (isAppNavIcon(Icon)) return <Icon size={size} active={active} className={className} />;
  return <Icon size={size} strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" className={cn("fitx-navglyph", className)} />;
}
