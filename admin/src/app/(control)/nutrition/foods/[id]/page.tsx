import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MacroBar } from "@/components/content/charts";
import { ConfirmSubmit, SubmitButton } from "@/components/content/confirm-submit";
import { FoodForm } from "@/components/content/food-form";
import { ContentHeader, DataState, Pill, Section, StateNotice, contentStyles as styles } from "@/components/content/kit";
import { MediaUploader } from "@/components/content/media-uploader";
import { PortionsEditor } from "@/components/content/portions-editor";
import { requireAdmin } from "@/lib/admin-auth";
import { FOOD_ID } from "@/lib/content/food-input";
import { VALUE_BASIS_LABELS, type ValueBasis } from "@/lib/content/vocabulary";
import { getFood, getFoodCategories } from "@/lib/data/foods";
import { firstParam } from "@/lib/search-params";
import { formatIstDate } from "@/lib/time";
import { finishFoodImageUpload, prepareFoodImageUpload, removeFoodImage, saveFood, saveFoodPortions, setFoodActive } from "../../actions";

export const metadata: Metadata = { title: "Food" };

const NOTICES = {
  created: { text: "Food added. It stays out of search until you show it.", good: true },
  shown: { text: "Food shown in food search.", good: true },
  hidden: { text: "Food hidden from food search. Meals already logged keep it.", good: true },
  photo_removed: { text: "Photo removed.", good: true },
  save_failed: { text: "The change could not be saved. Nothing was changed.", good: false },
  configuration: { text: "Server data access is not configured.", good: false },
  forbidden: { text: "Your role cannot make this change.", good: false },
};

export default async function FoodPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("nutrition.manage");
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  if (!FOOD_ID.test(id)) notFound();
  const query = await searchParams;
  const [result, categories] = await Promise.all([getFood(id), getFoodCategories()]);
  if (result.state === "not_found") notFound();
  if (result.state !== "ready") {
    return (
      <div className={styles.page}>
        <ContentHeader eyebrow="04 Nutrition" title="Food" back={{ href: "/nutrition", label: "Food database" }} />
        <DataState state={result.state} />
      </div>
    );
  }
  const { food, portions } = result;
  const names = categories.state === "ready" ? categories.categories.flatMap((item) => (item.category ? [item.category] : [])) : [];
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "") ?? "";
  const ownPhoto = Boolean(food.image_url && supabase && food.image_url.startsWith(supabase));
  const basis = VALUE_BASIS_LABELS[food.value_basis as ValueBasis] ?? food.value_basis;
  const defaultIndex = portions.findIndex((portion) => portion.is_default);
  return (
    <div className={styles.page}>
      <ContentHeader
        eyebrow="04 Nutrition"
        title={food.name}
        back={{ href: "/nutrition", label: "Food database" }}
        meta={`${Math.round(food.kcal).toLocaleString("en-IN")} kcal per 100 g · ${basis} · ${food.id}`}
        actions={
          <>
            <Pill tone={food.is_active ? "good" : "neutral"}>{food.is_active ? "Shown" : "Hidden"}</Pill>
            <form action={setFoodActive}>
              <input type="hidden" name="foodId" value={food.id} />
              <input type="hidden" name="active" value={String(!food.is_active)} />
              <input type="hidden" name="back" value="detail" />
              <SubmitButton quiet>{food.is_active ? "Hide" : "Show in search"}</SubmitButton>
            </form>
          </>
        }
      />
      <StateNotice state={firstParam(query.state)} messages={NOTICES} />
      <MacroBar protein={food.protein_g} carbs={food.carbs_g} fat={food.fat_g} />

      <div className={styles.split}>
        <FoodForm
          action={saveFood.bind(null, food.id)}
          creating={false}
          categories={names}
          initial={{
            name: food.name,
            aliases: food.aliases,
            keywords: food.keywords,
            category: food.category,
            cuisine: food.cuisine,
            diet_type: food.diet_type,
            state: food.state,
            kcal: food.kcal,
            protein_g: food.protein_g,
            carbs_g: food.carbs_g,
            fat_g: food.fat_g,
            fiber_g: food.fiber_g,
            sugar_g: food.sugar_g,
            sodium_mg: food.sodium_mg,
            value_basis: food.value_basis,
            attribution: food.attribution,
          }}
        />
        <div className={styles.page}>
          <Section title="Portions" note="What members pick instead of grams.">
            <PortionsEditor
              action={saveFoodPortions.bind(null, food.id)}
              initialDefault={defaultIndex}
              initial={portions.map((portion) => ({ label: portion.label, unit: portion.unit, grams: String(portion.grams), measured: !portion.is_estimate }))}
            />
          </Section>
          <Section title="Photo">
            {food.image_url && (
              <div className={styles.mediaCard}>
                <div className={styles.mediaFrame}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- FITX's own Storage copy, sized by its frame */}
                  {ownPhoto ? <img src={food.image_url} alt={food.name} loading="lazy" width={400} height={300} /> : <span>Hosted outside FITX storage</span>}
                </div>
                <p className={styles.mediaCaption}>{food.image_attribution} · {food.image_license}</p>
                <form action={removeFoodImage}>
                  <input type="hidden" name="foodId" value={food.id} />
                  <ConfirmSubmit label="Remove photo" confirmLabel="Confirm remove" small />
                </form>
              </div>
            )}
            <MediaUploader ownerId={food.id} kind="food_photo" prepare={prepareFoodImageUpload} finish={finishFoodImageUpload} defaultAlt={food.name} defaultCredit="Photo: FITX" />
          </Section>
          <Section title="Record">
            <dl className={`${styles.facts} ${styles.panel} ${styles.panelPad}`}>
              <div><dt>Source</dt><dd>{food.source === "fitx_admin" ? "Added in Admin" : food.source === "usda_fdc" ? "USDA FoodData Central" : food.source}</dd></div>
              {food.source_data_type && <div><dt>Data type</dt><dd>{food.source_data_type}</dd></div>}
              {food.source_version && <div><dt>Published</dt><dd>{food.source_version}</dd></div>}
              <div><dt>Licence</dt><dd>{food.licence}</dd></div>
              <div><dt>Last changed</dt><dd>{formatIstDate(food.updated_at) ?? "–"}</dd></div>
            </dl>
          </Section>
        </div>
      </div>
    </div>
  );
}
