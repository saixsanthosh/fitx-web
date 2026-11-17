import {
  EQUIPMENT_ICONS,
  EQUIPMENT_ICON_GRID,
  EQUIPMENT_ICON_SOFT_OPACITY,
  EQUIPMENT_ICON_STROKE_WIDTH,
  equipmentIconName,
  type EquipmentIconShape,
  type EquipmentIconTone,
} from "./equipment-icons";

type EquipmentIconProps = {
  /** An equipment key from src/lib/training/taxonomy.ts, or "none" for no equipment. Other names show the "specialty" icon. */
  name: string;
  /** Width and height in pixels. */
  size?: number;
  className?: string;
  /** The accessible name. Without one the icon is decorative and hidden from assistive technology. */
  title?: string;
};

const TONES: Record<EquipmentIconTone, { fill: string; fillOpacity?: number }> = {
  soft: { fill: "currentColor", fillOpacity: EQUIPMENT_ICON_SOFT_OPACITY },
  solid: { fill: "currentColor" },
};

function Shape({ shape }: { shape: EquipmentIconShape }) {
  const tone = shape.tone ? TONES[shape.tone] : undefined;
  if ("d" in shape) return <path d={shape.d} {...tone} />;
  if ("circle" in shape) return <circle {...shape.circle} {...tone} />;
  if ("ellipse" in shape) return <ellipse {...shape.ellipse} {...tone} />;
  return <rect {...shape.rect} {...tone} />;
}

/**
 * FITX's drawing of a piece of training equipment, in the line style of the app's lucide icons.
 * It draws in currentColor, so set the colour with a text utility (`text-fitx-…`) on it or a parent.
 */
export function EquipmentIcon({ name, size = 32, className, title }: EquipmentIconProps) {
  const label = title?.trim();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={`0 0 ${EQUIPMENT_ICON_GRID} ${EQUIPMENT_ICON_GRID}`}
      fill="none"
      fillRule="evenodd"
      stroke="currentColor"
      strokeWidth={EQUIPMENT_ICON_STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      className={className}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {label ? <title>{label}</title> : null}
      {EQUIPMENT_ICONS[equipmentIconName(name)].map((shape, index) => (
        <Shape key={index} shape={shape} />
      ))}
    </svg>
  );
}
