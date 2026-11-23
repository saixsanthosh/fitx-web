import { LANDING_MEDIA, type SiteImage } from "@/data/landing-media";
import { LANDING2_MEDIA } from "@/data/landing-2-media";

/**
 * What FITX does, one card each on the landing page's capability deck. Every line describes a feature that ships
 * (tests/landing/page.test.ts holds the claims to the code); the moving overlays are labelled examples.
 */
export type Capability = {
  id: "train" | "form" | "fuel" | "move" | "coach" | "progress";
  tab: string;
  title: string;
  line: string;
  image: SiteImage;
  /** Where the focal point of the photo sits (CSS object-position). */
  focus: string;
  href: string;
  cta: string;
};

export const CAPABILITIES: readonly Capability[] = [
  {
    id: "train",
    tab: "Train",
    title: "Plans for the gym or your living room.",
    line: "Sessions built around the kit you have, with every set and rep logged.",
    image: LANDING2_MEDIA.library,
    focus: "50% 50%",
    href: "/workouts",
    cta: "Open Workouts",
  },
  {
    id: "form",
    tab: "Form Check",
    title: "Your camera counts the reps.",
    line: "33 body points read live, cues on screen. Video never leaves your phone.",
    image: LANDING_MEDIA["woman-stand"],
    // Centred: the drawn skeleton is laid over the photo with the same centred crop.
    focus: "50% 50%",
    href: "/home-workout",
    cta: "Try AI Form Check",
  },
  {
    id: "fuel",
    tab: "Fuel",
    title: "Food, by the gram or the piece.",
    line: "Search, scan a barcode, or log two idli instead of 76 g.",
    image: LANDING2_MEDIA.kitchen,
    focus: "60% 50%",
    href: "/nutrition",
    cta: "Open Nutrition",
  },
  {
    id: "move",
    tab: "Move",
    title: "Every walk, run and ride.",
    line: "Live GPS route, distance and pace, saved to your week.",
    image: LANDING2_MEDIA["night-run"],
    focus: "70% 50%",
    href: "/activity",
    cta: "Open Activity",
  },
  {
    id: "coach",
    tab: "AI Coach",
    title: "A coach on call.",
    line: "Ask about training, food or recovery and get an answer that fits your goals.",
    image: LANDING2_MEDIA.coach,
    focus: "35% 50%",
    href: "/ai-coach",
    cta: "Ask the coach",
  },
  {
    id: "progress",
    tab: "Progress",
    title: "See it add up.",
    line: "Goals, trends and the muscles you have trained, in one view.",
    image: LANDING2_MEDIA.progress,
    focus: "35% 50%",
    href: "/progress",
    cta: "Open Progress",
  },
];

/** Seconds each card stays before the deck moves on by itself (until someone chooses a card). */
export const DECK_SECONDS = 7;

/** The card after `index`, wrapping round. */
export function nextCard(index: number, count = CAPABILITIES.length): number {
  return count > 0 ? (((index + 1) % count) + count) % count : 0;
}

/** The card before `index`, wrapping round. */
export function previousCard(index: number, count = CAPABILITIES.length): number {
  return count > 0 ? (((index - 1) % count) + count) % count : 0;
}
