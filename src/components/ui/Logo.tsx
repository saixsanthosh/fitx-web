import { cn } from "@/lib/utils";

interface LogoProps {
  size?: number;
  className?: string;
  glow?: boolean;
}

export function Logo({ size = 36, className }: LogoProps) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center font-black italic tracking-[-0.12em] text-white", className)}
      style={{ fontSize: size * 0.53, lineHeight: 1, width: size, height: size }}
      aria-label="FITX"
    >
      FIT<span className="text-fitx-primary">X</span>
    </span>
  );
}
