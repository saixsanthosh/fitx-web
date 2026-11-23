import type { Metadata } from "next";
import staples from "@/data/fitx-staples.json";
import { CinematicIntro } from "@/components/brand/CinematicIntro";
import { FilmHero } from "@/components/landing/FilmHero";
import { CapabilityDeck } from "@/components/landing/CapabilityDeck";
import { VisionReel } from "@/components/landing/VisionReel";
import { ContactBlock } from "@/components/landing/ContactBlock";
import { publicContact } from "@/components/landing/site-contact";
import { pieceFoodFrom } from "@/components/landing/portion";
import landing from "@/components/landing/landing.module.css";

export const metadata: Metadata = {
  title: "Train smart. Live fit.",
  description: "Gym and home plans, AI Form Check, food logging, GPS activity and an AI coach in one FITX account.",
  alternates: { canonical: "/" },
};

/** Idli from the built-in list (USDA FoodData Central, FNDDS), logged by the piece. */
const IDLI = pieceFoodFrom(staples.foods, "2708346", { pieceLabel: "idli", source: "USDA FoodData Central" });

/**
 * The public home page, four screens: FITX's own film with its chapters, the seven tools as a deck, the idea, and a
 * way to say hello.
 */
export default async function HomePage() {
  const websiteSchema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "FITX",
    url: "https://fitnessx.vercel.app/",
    description: "Training, nutrition and activity in one place.",
  };
  const contact = await publicContact();

  return (
    <>
      {/* Plays once per device for signed-out visitors (and with ?intro=…), records nothing; see introBootstrap.ts. */}
      <CinematicIntro />
      <main id="main-content" className={landing.page}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema).replace(/</g, "\\u003c") }} />
        <FilmHero />
        <CapabilityDeck food={IDLI} />
        <VisionReel />
        <ContactBlock contact={contact} />
      </main>
    </>
  );
}
