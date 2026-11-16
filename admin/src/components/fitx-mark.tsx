type FitxMarkProps = { size?: number; className?: string };

/** The original FITX mark geometry, kept separate from the wordmark. */
export function FitxMark({ size = 34, className }: FitxMarkProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      focusable="false"
    >
      <path d="M10 13H54" stroke="currentColor" strokeWidth="5.5" strokeLinecap="square" />
      <path d="M32 13V54" stroke="currentColor" strokeWidth="5.5" strokeLinecap="square" />
      <path d="M10 29H32" stroke="currentColor" strokeWidth="5.5" strokeLinecap="square" />
      <path d="M32 31L53 52M32 52L53 31" stroke="currentColor" strokeWidth="5.5" strokeLinecap="square" />
    </svg>
  );
}
