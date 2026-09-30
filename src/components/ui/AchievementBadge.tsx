"use client";

import { motion } from "framer-motion";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

type Rarity = "Common" | "Rare" | "Epic" | "Legendary";

interface AchievementBadgeProps {
  icon: React.ReactNode;
  name: string;
  rarity: Rarity;
  unlocked: boolean;
  progress?: number;
  target?: number;
}

const rarityStyles: Record<Rarity, { glow: string; border: string; text: string; bg: string }> = {
  Common: { glow: "", border: "border-fitx-text-disabled/40", text: "text-fitx-text-secondary", bg: "from-fitx-surface-variant to-fitx-surface" },
  Rare: { glow: "drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]", border: "border-blue-400/50", text: "text-blue-400", bg: "from-blue-500/20 to-fitx-surface" },
  Epic: { glow: "drop-shadow-[0_0_10px_rgba(88,211,123,0.35)]", border: "border-fitx-primary/50", text: "text-fitx-primary", bg: "from-fitx-primary/15 to-fitx-surface" },
  Legendary: { glow: "drop-shadow-[0_0_14px_rgba(212,160,64,0.6)]", border: "border-fitx-gold/60", text: "text-fitx-gold", bg: "from-fitx-gold/20 to-fitx-surface" },
};

export function AchievementBadge({ icon, name, rarity, unlocked, progress, target }: AchievementBadgeProps) {
  const style = rarityStyles[rarity];

  return (
    <motion.div
      whileHover={{ scale: 1.05, y: -4 }}
      className="flex flex-col items-center text-center"
    >
      <div className={cn("relative w-20 h-20 mb-2", unlocked && style.glow)}>
        <svg viewBox="0 0 100 100" className="w-full h-full">
          <polygon
            points="50,3 93,27 93,73 50,97 7,73 7,27"
            className={cn("fill-current", unlocked ? "" : "opacity-30")}
            style={{ fill: `url(#grad-${rarity}-${unlocked})` }}
            stroke="currentColor"
            strokeWidth="2"
          />
          <defs>
            <linearGradient id={`grad-${rarity}-${unlocked}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={unlocked ? (rarity === "Legendary" ? "#D4A040" : rarity === "Epic" ? "#A855F7" : rarity === "Rare" ? "#3B82F6" : "#1A0808") : "#1A0808"} stopOpacity={unlocked ? "0.3" : "0.5"} />
              <stop offset="100%" stopColor="#0F0404" />
            </linearGradient>
          </defs>
        </svg>
        <div className={cn("absolute inset-0 flex items-center justify-center", unlocked ? style.text : "text-fitx-text-disabled")}>
          {unlocked ? icon : <Lock size={20} />}
        </div>
      </div>
      <p className={cn("text-[10px] font-heading uppercase tracking-wider", unlocked ? "text-fitx-text" : "text-fitx-text-disabled")}>
        {name}
      </p>
      <p className={cn("text-[9px] font-mono uppercase", style.text)}>{rarity}</p>
      {!unlocked && progress !== undefined && target !== undefined && (
        <div className="mt-1 w-16">
          <div className="h-1 bg-fitx-surface-variant rounded-full overflow-hidden">
            <div className="h-full bg-fitx-primary/60 rounded-full" style={{ width: `${(progress / target) * 100}%` }} />
          </div>
          <p className="text-[8px] font-mono text-fitx-text-disabled mt-0.5">{progress}/{target}</p>
        </div>
      )}
    </motion.div>
  );
}
