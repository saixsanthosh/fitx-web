export const BRAND = {
  name: "FITX",
  tagline: "TRAIN SMART. LIVE FIT.",
  logoUrl: "/brand/fitx-mark-black.svg",
  supportEmail: "saisanthosh5369@gmail.com",
  instagramUrl: "https://www.instagram.com/saixsanthosh/",
  // fitx-allow-raw-color: Razorpay Checkout's theme takes a literal colour (this is --fitx-primary in the light theme).
  primaryColor: "#C44933",
  meta: {
    title: "FITX — Train smart. Live fit.",
    description: "Plan workouts, explore exercises, log food, and follow your fitness progress in one focused FITX workspace.",
    author: "FITX",
  },
} as const;

export type Brand = typeof BRAND;
