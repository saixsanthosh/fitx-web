import { Logo } from "@/components/ui/Logo";
import { IntroReplayControl } from "@/components/brand/IntroReplayControl";

/** Server-rendered brand lockup; replay launches the optional cinematic intro. */
export function BrandFormation() {
  return (
    <div className="fitx-brand-formation">
      <Logo size={42} />
      <span className="fitx-brand-formation__rule" aria-hidden="true" />
      <p>TRAIN SMART. LIVE FIT.</p>
      <IntroReplayControl />
    </div>
  );
}
