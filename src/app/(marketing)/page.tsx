import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import staples from "@/data/fitx-staples.json";
import { LANDING_MEDIA } from "@/data/landing-media";
import { CinematicIntro } from "@/components/brand/CinematicIntro";
import { Parallax } from "@/components/motion";
import { LandingHero } from "@/components/landing/LandingHero";
import { DualScenes } from "@/components/landing/DualScenes";
import { HomeWorkoutFeatures } from "@/components/landing/HomeWorkoutFeatures";
import { MoreTiles } from "@/components/landing/MoreTiles";
import { ContactBlock } from "@/components/landing/ContactBlock";
import { landingContact } from "@/components/landing/contact";
import { pieceFoodFrom } from "@/components/landing/portion";
import styles from "@/components/landing/landing.module.css";

export const metadata: Metadata = {
  title: "Train smart. Live fit.",
  description: "Gym plans, a home workout that checks your form, food logging and activity tracking in one FITX account.",
  alternates: { canonical: "/" },
};

/** Idli from the built-in list (USDA FoodData Central, FNDDS), logged by the piece. */
const IDLI = pieceFoodFrom(staples.foods, "2708346", { pieceLabel: "idli", source: "USDA FoodData Central" });

export default function HomePage() {
  const websiteSchema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "FITX",
    url: "https://fitnessx.vercel.app/",
    description: "Training, nutrition and activity in one place.",
  };
  const closing = LANDING_MEDIA.closing;

  return (
    <>
      {/* Plays once per tab for signed-out visitors (and with ?intro=…), records nothing; see introBootstrap.ts. */}
      <CinematicIntro />
      <main id="main-content" className={styles.page}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema).replace(/</g, "\\u003c") }} />
        <LandingHero />
        <DualScenes />
        <HomeWorkoutFeatures />
        <MoreTiles food={IDLI} />
        <section className={styles.closing} aria-labelledby="closing-title">
          <Parallax speed={0.12} className={styles.closingPhoto}>
            <Image src={closing.src} alt="" fill sizes="100vw" placeholder="blur" blurDataURL={closing.blurDataURL} />
          </Parallax>
          <div className={styles.closingShade} aria-hidden="true" />
          <div className={styles.closingInner}>
            <h2 id="closing-title" className={styles.closingTitle}>Start today.</h2>
            <Link href="/signup" prefetch={false} className={`${styles.primary} fitx-when-signed-out`}>
              Create account <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <Link href="/dashboard" prefetch={false} className={`${styles.primary} fitx-when-signed-in`}>
              Open dashboard <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </section>
        <ContactBlock contact={landingContact()} />
      </main>
    </>
  );
}
