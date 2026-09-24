"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { motion, type HTMLMotionProps } from "framer-motion";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "gold" | "outline";

interface FitxButtonProps
  extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: Variant;
  size?: "sm" | "md" | "lg" | "xl";
  loading?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

const variantStyles: Record<Variant, string> = {
  primary:
    "bg-fitx-primary text-[#0b1400] hover:bg-fitx-primary-bright shadow-[0_0_24px_rgba(198,242,78,0.35),0_0_60px_rgba(198,242,78,0.12)]",
  secondary: "bg-fitx-surface-variant text-fitx-text border border-fitx-border hover:border-fitx-primary/40",
  ghost: "bg-transparent text-fitx-text-secondary hover:text-fitx-text hover:bg-white/5",
  danger: "bg-red-700 text-white hover:bg-red-600",
  gold: "bg-fitx-gold text-black hover:bg-fitx-gold-bright shadow-[0_0_20px_rgba(212,160,64,0.4)]",
  outline:
    "bg-transparent text-fitx-text border-2 border-fitx-primary/60 hover:border-fitx-primary hover:bg-fitx-primary/10",
};

const sizeStyles: Record<string, string> = {
  sm: "px-4 py-2 text-xs gap-1.5",
  md: "px-6 py-3 text-sm gap-2",
  lg: "px-8 py-4 text-base gap-2.5",
  xl: "px-10 py-5 text-lg gap-3",
};

export const FitxButton = forwardRef<HTMLButtonElement, FitxButtonProps>(
  ({ variant = "primary", size = "md", loading, icon, children, className, disabled, ...props }, ref) => {
    return (
      <motion.button
        ref={ref}
        whileHover={{ scale: disabled || loading ? 1 : 1.02 }}
        whileTap={{ scale: disabled || loading ? 1 : 0.96 }}
        disabled={disabled || loading}
        className={cn(
          "relative inline-flex items-center justify-center font-heading font-semibold rounded-xl tracking-wider uppercase transition-all duration-300 cursor-pointer overflow-hidden",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        {...props}
      >
        {loading && (
          <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {icon && !loading && <span className="flex-shrink-0">{icon}</span>}
        <span>{children}</span>
        <span className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-500 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer pointer-events-none" />
      </motion.button>
    );
  }
);

FitxButton.displayName = "FitxButton";
