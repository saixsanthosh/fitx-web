import { cn } from "@/lib/utils";
import { FitxMark } from "@/components/ui/FitxMark";

interface LogoProps {
  size?: number;
  className?: string;
  markOnly?: boolean;
  animateMark?: boolean;
}

/** The mark and the FITX wordmark remain separate, crisp HTML/SVG elements. */
export function Logo({ size = 36, className, markOnly = false, animateMark = false }: LogoProps) {
  return (
    <span
      className={cn("fitx-logo inline-flex shrink-0 items-center", animateMark && "is-forming", className)}
      style={{ fontSize: size * 0.58, lineHeight: 1 }}
    >
      <FitxMark size={size} animate={animateMark} />
      {!markOnly && <span className="fitx-wordmark">FITX</span>}
    </span>
  );
}
