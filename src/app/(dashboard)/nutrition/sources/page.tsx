import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeading } from "@/components/app/PageHeading";
import { BasisBadge, PortionEstimateBadge } from "@/components/nutrition/FoodBadges";
import { FITX_RECIPE_SOURCE, PORTION_ESTIMATE, RECIPE_ESTIMATE, VALUE_BASIS } from "@/lib/food/value-basis";
import type { ValueBasis } from "@/lib/food/types";

export const metadata: Metadata = { title: "Food data sources" };

/** The key, in the order members meet the badges: FITX's own recipe estimates come after USDA's typical recipes. */
const BADGES: Array<{ basis: ValueBasis; source?: string; detail: string }> = [
  { basis: "lab_analysed", detail: VALUE_BASIS.lab_analysed.detail },
  { basis: "compiled", detail: VALUE_BASIS.compiled.detail },
  { basis: "recipe_calculated", detail: VALUE_BASIS.recipe_calculated.detail },
  { basis: "estimated", source: FITX_RECIPE_SOURCE, detail: RECIPE_ESTIMATE.detail },
  { basis: "label", detail: VALUE_BASIS.label.detail },
  { basis: "user_entered", detail: VALUE_BASIS.user_entered.detail },
  { basis: "ai_suggested", detail: VALUE_BASIS.ai_suggested.detail },
  { basis: "estimated", detail: VALUE_BASIS.estimated.detail },
];

/** Where FITX's food values come from, how they are labelled, and the credits their licences ask for. */
export default function NutritionSourcesPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/nutrition" className="inline-flex min-h-11 items-center gap-2 text-sm text-fitx-text-secondary hover:text-fitx-text"><ArrowLeft size={15}/>Back to nutrition</Link>
      <PageHeading title="Food data sources" description="Where FITX's food values come from, how estimates are marked, and the credits each source asks for."/>

      <section className="fitx-panel space-y-3 p-5" aria-labelledby="sources-badges">
        <h2 id="sources-badges" className="text-base font-semibold text-fitx-text">What the labels mean</h2>
        <p className="text-sm text-fitx-text-secondary">Every food and every logged entry says how its values were obtained, so an estimate is never shown as a measurement.</p>
        <ul className="space-y-3">
          {BADGES.map(({ basis, source, detail }) => (
            <li key={`${basis}-${source ?? ""}`} className="grid gap-1 sm:grid-cols-[11rem_1fr] sm:items-start">
              <span><BasisBadge basis={basis} source={source}/></span>
              <span className="text-sm text-fitx-text-secondary">{detail}</span>
            </li>
          ))}
          <li className="grid gap-1 sm:grid-cols-[11rem_1fr] sm:items-start">
            <span><PortionEstimateBadge/></span>
            <span className="text-sm text-fitx-text-secondary">{PORTION_ESTIMATE.detail} For example, &ldquo;3 idli&rdquo; uses USDA&apos;s 38 g per idli, so it logs 114 g.</span>
          </li>
        </ul>
        <p className="text-sm text-fitx-text-secondary">&ldquo;Non-veg&rdquo; and &ldquo;Contains egg&rdquo; come from a food&apos;s USDA name, category and ingredient list; &ldquo;Vegetarian&rdquo; and &ldquo;Vegan&rdquo; only from FITX&apos;s own check of common foods. When FITX can&apos;t tell, it shows no label, and the diet filter on the food search can&apos;t hide that food: it is shown as &ldquo;Diet not checked&rdquo;. Check the package if it matters to you.</p>
      </section>

      <section className="fitx-panel space-y-3 p-5" aria-labelledby="sources-usda">
        <h2 id="sources-usda" className="text-base font-semibold text-fitx-text">USDA FoodData Central</h2>
        <p className="text-sm text-fitx-text-secondary">
          FITX&apos;s food catalogue, including the Indian dishes USDA covers (idli, dosa, sambar, dal, roti, biryani and more), comes from
          USDA FoodData Central: Foundation Foods (laboratory analysis), SR Legacy (reference values) and FNDDS (typical recipes, with
          household portion weights). USDA&apos;s Indian recipes are typical versions, so a dish made at home can differ.
        </p>
        <p className="text-sm text-fitx-text-secondary">
          The data is in the public domain (CC0 1.0). Source: U.S. Department of Agriculture, Agricultural Research Service.
          FoodData Central. <a className="text-fitx-primary-text underline underline-offset-2" href="https://fdc.nal.usda.gov/" target="_blank" rel="noopener noreferrer">fdc.nal.usda.gov</a>.
        </p>
      </section>

      <section className="fitx-panel space-y-3 p-5" aria-labelledby="sources-off">
        <h2 id="sources-off" className="text-base font-semibold text-fitx-text">Open Food Facts</h2>
        <p className="text-sm text-fitx-text-secondary">
          Barcode lookups and the &ldquo;packaged products&rdquo; search use Open Food Facts, a database of product labels entered by its
          community. FITX uses only the per-100 g values, converts kJ to kcal, and leaves out labels whose energy can&apos;t match their
          protein, carbohydrate and fat. FITX does not check these labels against the packs.
        </p>
        <p className="text-sm text-fitx-text-secondary">
          Product data: &copy; Open Food Facts contributors, available under the{" "}
          <a className="text-fitx-primary-text underline underline-offset-2" href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer">Open Database Licence</a>.
          Product photos: Open Food Facts contributors, under{" "}
          <a className="text-fitx-primary-text underline underline-offset-2" href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener noreferrer">CC BY-SA</a>;
          each photo links to its product page.{" "}
          <a className="text-fitx-primary-text underline underline-offset-2" href="https://world.openfoodfacts.org/" target="_blank" rel="noopener noreferrer">openfoodfacts.org</a>.
        </p>
      </section>

      <section className="fitx-panel space-y-3 p-5" aria-labelledby="sources-estimates">
        <h2 id="sources-estimates" className="text-base font-semibold text-fitx-text">FITX estimates</h2>
        <p className="text-sm text-fitx-text-secondary">
          Some everyday dishes (curd rice, rajma rice, chole, dal tadka, khichdi, raita, lassi, aloo paratha) are not in USDA FoodData Central.
          FITX works their values out from USDA values for the ingredients, using the amounts shown on each dish, and labels them
          “FITX recipe estimate”. A dish made with other proportions will differ. FITX does not guess foods it has no source for, such as
          plain paneer or bhindi; it says so and lets you add a packaged product or your own food.
        </p>
        <p className="text-sm text-fitx-text-secondary">
          Millilitres, cups and spoons are worked out from the food&apos;s own USDA cup or spoon weight, and never assume that 1 ml weighs 1 g.
          A katori, bowl or glass has no standard size, so FITX starts from a working size (katori 150 ml, bowl 250 ml, glass 200 ml),
          marks the result a portion estimate, and uses the size you set under “Set my katori and bowl sizes” instead.
        </p>
      </section>

      <section className="fitx-panel space-y-3 p-5" aria-labelledby="sources-yours">
        <h2 id="sources-yours" className="text-base font-semibold text-fitx-text">Your foods and the AI coach</h2>
        <p className="text-sm text-fitx-text-secondary">
          Foods you save keep the values you entered and are private to your account, except their names, which the AI coach sends
          to outside AI services if you use it with “Use my FITX data” on. Foods the AI coach adds to your plan take their values
          from FITX’s food data (this catalogue, USDA FoodData Central or Open Food Facts) when FITX finds a match; otherwise they
          keep the coach’s own estimate and are labelled “AI estimate”. Either way they are marked as AI suggestions, until you change
          their values. Deleting one of your foods deletes it and its photo; meals you already logged keep their values.
        </p>
        <p className="text-sm text-fitx-text-secondary">
          FITX does not include the Indian Food Composition Tables (IFCT 2017) or the Indian Nutrient Databank, because their licences
          don&apos;t allow it without permission.
        </p>
      </section>
    </div>
  );
}
