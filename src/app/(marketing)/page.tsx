import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Barcode,
  Check,
  Dumbbell,
  MapPin,
  Target,
  Timer,
  Utensils,
} from "lucide-react";
import { IMG } from "@/data/images";
import usdaFoundationFoods from "@/data/usda-foundation-foods.json";
import { BrandFormation } from "@/components/brand/BrandFormation";
import { CinematicIntro } from "@/components/brand/CinematicIntro";
import { CinematicMedia } from "./CinematicMedia";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Train smart. Live fit.",
  description:
    "Plan workouts, explore exercise demonstrations, track food and calories, and follow your fitness progress with FITX.",
  alternates: { canonical: "/" },
};

const featuredExercise = {
  name: "Barbell Bench Press",
  description: "Press a bar from the chest while keeping the shoulder blades stable.",
  primaryMuscle: "Chest",
  secondaryMuscles: ["Triceps", "Front deltoids"],
  equipment: ["Barbell", "Bench"],
  difficulty: "Intermediate",
  sets: 3,
  reps: "6–10",
  rest: 150,
};

// A common staple, shown exactly as USDA FoodData Central lists it (per 100 g).
const featuredFood = usdaFoundationFoods.find((food) => food.id === "748967");

const preferenceFields = [
  { icon: Target, label: "Goal", detail: "Choose a focus" },
  { icon: Dumbbell, label: "Level", detail: "Set your experience" },
  { icon: Check, label: "Equipment", detail: "Use what you have" },
  { icon: Timer, label: "Time", detail: "Fit the session to your day" },
];

const personalizationPlaces = ["Gym", "Home", "Both", "Outdoors"];

function photoAt(src: string, width: number) {
  return src.replace(/([?&]w=)\d+/, (_match, prefix: string) => `${prefix}${width}`);
}

/** Full-bleed photos are requested at 2400 px so large and high-density screens stay sharp. */
const widePhoto = (src: string) => photoAt(src, 2400);

export default function HomePage() {
  const websiteSchema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "FITX",
    url: "https://fitnessx.vercel.app/",
    description: "Training, nutrition, and fitness progress in one place.",
  };

  return (
    <>
    {/* Plays once per tab for signed-out visitors (and with ?intro=…), records nothing; see introBootstrap.ts. */}
    <CinematicIntro />
    <main id="main-content" className={styles.page}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema).replace(/</g, "\\u003c") }} />
      <section className={styles.hero} aria-labelledby="hero-title">
        <CinematicMedia
          src={widePhoto(IMG.workoutMan)}
          alt="An athlete performing a dynamic workout in a gym"
          ratio="cinema"
          priority
          className={styles.heroMedia}
        />
        <div className={styles.heroShade} aria-hidden="true" />
        <div className={styles.heroContent}>
          <BrandFormation />
          <p className={styles.heroEyebrow}>TRAIN <span>·</span> EAT <span>·</span> PROGRESS</p>
          <h1 id="hero-title" className={styles.heroTitle}>
            Your fitness.<br />
            <span>Your way.</span>
          </h1>
          <p className={styles.heroCopy}>
            Build training around your goals, equipment, time, and routine.
            Track nutrition. Measure progress. Keep improving.
          </p>
          <div className={styles.heroActions}>
            <Link href="/signup" className={styles.primaryAction}>
              Start training <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <Link href="#personalization" className={styles.secondaryAction}>
              Explore FITX <ArrowDown size={15} aria-hidden="true" />
            </Link>
          </div>
          <p className={styles.heroNote}>A training and nutrition record shaped by you.</p>
        </div>
        <div className={styles.heroIndex} aria-hidden="true">
          <i /> FITX / YOUR ROUTINE
        </div>
      </section>

      <section id="personalization" className={`${styles.story} ${styles.personalization}`} aria-labelledby="personalization-title">
        <div className={styles.personalVisual}>
          <CinematicMedia
            src={IMG.womanFit}
            alt="Athlete training in a gym"
            ratio="portrait"
            className={styles.roundedMedia}
          />
          <div className={styles.imageCaption}><span>01 / PREFERENCES</span><span>MADE FOR YOUR ROUTINE</span></div>
        </div>
        <div className={styles.storyCopy}>
          <SectionEyebrow>01 / Your preferences</SectionEyebrow>
          <h2 id="personalization-title" className={styles.storyTitle}>Built around you.</h2>
          <p className={styles.lede}>FITX adapts your plan to how you actually train.</p>
          <div className={styles.placeChoices} aria-label="Available workout locations">
            {personalizationPlaces.map((place) => <span key={place}>{place}</span>)}
          </div>
          <div className={styles.preferenceList}>
            {preferenceFields.map(({ icon: Icon, label, detail }) => (
              <div className={styles.preferenceRow} key={label}>
                <Icon size={17} aria-hidden="true" />
                <span className={styles.preferenceLabel}>{label}</span>
                <span className={styles.preferenceDetail}>{detail}</span>
              </div>
            ))}
          </div>
          <Link href="/signup" className={styles.inlineAction}>Set your preferences <ArrowUpRight size={15} aria-hidden="true" /></Link>
        </div>
      </section>

      <section className={`${styles.darkStory} ${styles.story}`} aria-labelledby="workout-title">
        <div className={styles.workoutIntro}>
          <SectionEyebrow>02 / Workout engine</SectionEyebrow>
          <h2 id="workout-title" className={styles.storyTitle}>Train with a plan.</h2>
          <p className={styles.lede}>Choose your focus and FITX builds a session from your level, available equipment, and time.</p>
        </div>
        <div className={styles.workoutLayout}>
          <div className={styles.workoutFlow} aria-label="Workout plan flow">
            {[
              ["01", "Goal"], ["02", "Level"], ["03", "Equipment"], ["04", "Time"], ["05", "Workout"],
            ].map(([number, label], index) => (
              <div className={styles.flowStep} key={number}>
                <span>{number}</span><strong>{label}</strong>
                {index < 4 && <i aria-hidden="true" />}
              </div>
            ))}
          </div>
          <div className={styles.planCard}>
            <div className={styles.planCardHead}>
              <div><span className={styles.miniLabel}>FITX WORKOUT BUILDER</span><h3>Auto plan</h3></div>
              <Dumbbell size={20} aria-hidden="true" />
            </div>
            <p className={styles.planDescription}>A practical session drawn from your preferences and the exercise library.</p>
            <div className={styles.planInputs}>
              {preferenceFields.map(({ label, detail }, index) => (
                <div className={styles.planInput} key={label}>
                  <span>{label}</span><strong>{detail}</strong><b>0{index + 1}</b>
                </div>
              ))}
            </div>
            <Link href="/signup" className={styles.planAction}>Build your plan <ArrowRight size={15} aria-hidden="true" /></Link>
          </div>
        </div>
        <div className={styles.workoutMedia}>
          <CinematicMedia
            src={IMG.training}
            alt="Athlete preparing for a training session"
            ratio="wide"
            className={styles.roundedMedia}
          />
          <span className={styles.mediaNote}>REAL TRAINING. A PLAN THAT FITS.</span>
        </div>
      </section>

      <section className={`${styles.story} ${styles.exerciseStory}`} aria-labelledby="exercise-title">
        <div className={styles.storyCopy}>
          <SectionEyebrow>03 / Exercise library</SectionEyebrow>
          <h2 id="exercise-title" className={styles.storyTitle}>Know the movement.</h2>
          <p className={styles.lede}>Look up a movement, see the target muscles and equipment, then follow its instructions.</p>
          <Link href="/exercises" className={styles.inlineAction}><AuthLabel signedOut="Sign in to explore the library" signedIn="Explore the exercise library" /> <ArrowUpRight size={15} aria-hidden="true" /></Link>
          <div className={styles.exerciseMedia}>
            <CinematicMedia
              src={IMG.athlete}
              alt="Athlete working through a strength training movement"
              ratio="wide"
              className={styles.roundedMedia}
            />
          <span className={styles.mediaNote}>MOVEMENT DETAILS IN FITX</span>
          </div>
        </div>
        <article className={styles.exerciseCard} aria-label="Example from the FITX exercise library">
          <div className={styles.exerciseCardHead}>
            <span className={styles.miniLabel}>FROM THE FITX LIBRARY</span>
            <span className={styles.difficulty}>{featuredExercise.difficulty}</span>
          </div>
          <h3>{featuredExercise.name}</h3>
          <p className={styles.exerciseDescription}>{featuredExercise.description}</p>
          <dl className={styles.exerciseDetails}>
            <div><dt>Primary muscle</dt><dd>{featuredExercise.primaryMuscle}</dd></div>
            <div><dt>Also works</dt><dd>{featuredExercise.secondaryMuscles.join(", ")}</dd></div>
            <div><dt>Equipment</dt><dd>{featuredExercise.equipment.join(" + ")}</dd></div>
            <div><dt>Suggested work</dt><dd>{featuredExercise.sets} sets · {featuredExercise.reps} reps</dd></div>
            <div><dt>Rest</dt><dd>{featuredExercise.rest} seconds</dd></div>
          </dl>
          <p className={styles.exerciseFootnote}>Library entry preview. Exercise descriptions and suggested sets are general guidance.</p>
        </article>
      </section>

      <section className={`${styles.foodStory} ${styles.story}`} aria-labelledby="nutrition-title">
        <div className={styles.foodPhoto}>
          <CinematicMedia
            src={IMG.saladBowl}
            alt="A bowl of fresh food"
            ratio="portrait"
            className={styles.roundedMedia}
          />
          <div className={styles.imageCaption}><span>04 / NUTRITION</span><span>SEARCH · SELECT · LOG</span></div>
        </div>
        <div className={styles.foodContent}>
          <SectionEyebrow>04 / Nutrition</SectionEyebrow>
          <h2 id="nutrition-title" className={styles.storyTitle}>Eat with purpose.</h2>
          <p className={styles.lede}>Search food, set a portion, and save the nutrition to your daily log.</p>
          <div className={styles.nutritionFlow} aria-label="Nutrition workflow">
            <span>Food</span><ArrowRight size={14} aria-hidden="true" /><span>Search / scan</span><ArrowRight size={14} aria-hidden="true" /><span>Log</span>
          </div>
          {featuredFood ? (
            <article className={styles.foodCard} aria-label={`USDA nutrition for ${featuredFood.name} per 100 grams`}>
              <div className={styles.foodCardHead}>
                <div><span className={styles.miniLabel}>USDA FOODDATA CENTRAL · PER 100 G</span><h3>{featuredFood.name}</h3></div>
                <Utensils size={19} aria-hidden="true" />
              </div>
              <div className={styles.foodMacros}>
                <Macro label="Calories" value={`${featuredFood.calories}`} unit="kcal" />
                <Macro label="Protein" value={macroValue(featuredFood.protein)} unit="g" />
                <Macro label="Carbohydrates" value={macroValue(featuredFood.carbs)} unit="g" />
                <Macro label="Fat" value={macroValue(featuredFood.fat)} unit="g" />
              </div>
            </article>
          ) : <p className={styles.foodCard}>Food data preview unavailable.</p>}
          <Link href="/nutrition" className={styles.inlineAction}><AuthLabel signedOut="Sign in to start logging food" signedIn="Open nutrition tracking" /> <ArrowUpRight size={15} aria-hidden="true" /></Link>
        </div>
      </section>

      <section className={`${styles.barcodeStory} ${styles.story}`} aria-labelledby="barcode-title">
        <div className={styles.barcodeCopy}>
          <SectionEyebrow>05 / Packaged food lookup</SectionEyebrow>
          <h2 id="barcode-title" className={styles.storyTitle}>Scan it. Log it.</h2>
          <p className={styles.lede}>Use the camera to read a product barcode. FITX looks up available food information before you choose what to log.</p>
          <Link href="/nutrition" className={styles.inlineAction}><AuthLabel signedOut="Sign in to scan or search food" signedIn="Find food in FITX" /> <ArrowUpRight size={15} aria-hidden="true" /></Link>
        </div>
        <div className={styles.barcodeVisual}>
          <CinematicMedia
            src={IMG.veggies}
            alt="Fresh ingredients prepared for a meal"
            ratio="wide"
            className={styles.barcodePhoto}
          />
          <div className={styles.scanPanel}>
            <div className={styles.scanPanelHead}><Barcode size={18} aria-hidden="true"/><span>PRODUCT LOOKUP</span></div>
            <div className={styles.scanFrame} aria-hidden="true"><span /><i /></div>
            <div className={styles.scanSteps}>
              <span>Product</span><ArrowRight size={13} aria-hidden="true"/><span>Scan</span><ArrowRight size={13} aria-hidden="true"/><span>Nutrition</span>
            </div>
            <p>Camera starts when you choose to scan.</p>
          </div>
        </div>
      </section>

      <section className={`${styles.darkStory} ${styles.story}`} aria-labelledby="progress-title">
        <div className={styles.progressIntro}>
          <SectionEyebrow>06 / Progress</SectionEyebrow>
          <h2 id="progress-title" className={styles.storyTitle}>See the work.</h2>
          <p className={styles.lede}>Review the sessions, measurements, and personal records you choose to log.</p>
        </div>
        <div className={styles.progressLayout}>
          <CinematicMedia
            src={IMG.gymEquipment}
            alt="Strength training equipment in a gym"
            ratio="wide"
            className={styles.roundedMedia}
          />
          <div className={styles.progressPreview}>
            <div className={styles.progressPreviewHead}><span className={styles.miniLabel}>YOUR TRAINING RECORD</span><span>PREVIEW</span></div>
            <div className={styles.progressCategories}>
              {["Strength", "Consistency", "Volume", "Bodyweight"].map((item) => <span key={item}>{item}</span>)}
            </div>
            <div className={styles.emptyProgress}>
              <div className={styles.emptyGrid} aria-hidden="true"><i /><i /><i /><i /></div>
              <p>Records and trends appear as you log your training.</p>
            </div>
            <Link href="/progress" className={styles.planAction}><AuthLabel signedOut="Sign in to see your progress" signedIn="View your progress" /> <ArrowRight size={15} aria-hidden="true" /></Link>
          </div>
        </div>
      </section>

      <section className={`${styles.story} ${styles.contextStory}`} aria-labelledby="context-title">
        <div className={styles.contextVisual}>
          <CinematicMedia
            src={IMG.gymInterior}
            alt="A calm, well-equipped training space"
            ratio="wide"
            className={styles.roundedMedia}
          />
          <div className={styles.contextStamp}><MapPin size={15} aria-hidden="true"/><span>YOUR ROUTINE, IN ONE PLACE</span></div>
        </div>
        <div className={styles.storyCopy}>
          <SectionEyebrow>07 / Your training context</SectionEyebrow>
          <h2 id="context-title" className={styles.storyTitle}>Your data.<br />Your next move.</h2>
          <p className={styles.lede}>Bring your workout plans, nutrition entries, and progress history together. Review what you have logged, then choose what comes next.</p>
          <p className={`${styles.contextNote} fitx-when-signed-out`}>These open after you sign in.</p>
          <div className={styles.contextLinks}>
            <Link href="/workouts"><Dumbbell size={17} aria-hidden="true"/><span>Plans and sessions</span><ArrowUpRight size={14} aria-hidden="true"/></Link>
            <Link href="/nutrition"><Utensils size={17} aria-hidden="true"/><span>Food and daily logs</span><ArrowUpRight size={14} aria-hidden="true"/></Link>
            <Link href="/progress"><Target size={17} aria-hidden="true"/><span>Measurements and records</span><ArrowUpRight size={14} aria-hidden="true"/></Link>
          </div>
        </div>
      </section>

      <section className={styles.finalCta} aria-labelledby="final-title">
        <CinematicMedia
          src={widePhoto(IMG.heroGym)}
          alt="A gym floor with racks and free weights"
          ratio="cinema"
          className={styles.finalMedia}
        />
        <div className={styles.finalShade} aria-hidden="true" />
        <div className={styles.finalContent}>
          <SectionEyebrow>FITX / TRAIN · EAT · PROGRESS</SectionEyebrow>
          <h2 id="final-title" className={styles.finalTitle}>Train smarter.<br /><span>Live stronger.</span></h2>
          <Link href="/signup" className={styles.primaryAction}>Start training <ArrowRight size={17} aria-hidden="true" /></Link>
        </div>
        <div className={styles.finalIndex} aria-hidden="true">FITX · YOUR FITNESS, YOUR WAY</div>
      </section>
    </main>
    </>
  );
}

/** One link label for signed-out visitors and another for signed-in ones, chosen before first paint. */
function AuthLabel({ signedOut, signedIn }: { signedOut: string; signedIn: string }) {
  return <><span className="fitx-when-signed-out">{signedOut}</span><span className="fitx-when-signed-in">{signedIn}</span></>;
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return <p className={styles.sectionEyebrow}>{children}</p>;
}

function Macro({ label, value, unit }: { label: string; value: string; unit: string }) {
  return <div className={styles.macro}>
    <span>{label}</span><strong>{value}<small> {unit}</small></strong>
  </div>;
}

function macroValue(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
