import { isAppNavIcon, type NavItem } from "@/config/navigation";

/** A nav item's icon: lucide icons get a heavier stroke when active, app icons take `active`. */
export function NavGlyph({ icon: Icon, size, active, className }: { icon: NavItem["icon"]; size: number; active: boolean; className?: string }) {
  if (isAppNavIcon(Icon)) return <Icon size={size} active={active} className={className} />;
  return <Icon size={size} strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" className={className} />;
}
