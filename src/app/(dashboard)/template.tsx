/**
 * Page transitions in the signed-in app: each section's page fades in as it replaces the last (Next remounts a
 * template when the section changes; a sub-page or a query change does not). Opacity only, so a page's own fixed
 * bars and sheets are never moved or re-anchored during the fade, and the animation leaves no style behind once it
 * ends. Still with reduced motion (globals.css).
 */
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return <div className="fitx-page-enter">{children}</div>;
}
