import type { Metadata } from "next";
import { FoodForm, NEW_FOOD } from "@/components/content/food-form";
import { ContentHeader, contentStyles as styles } from "@/components/content/kit";
import { requireAdmin } from "@/lib/admin-auth";
import { getFoodCategories } from "@/lib/data/foods";
import { saveFood } from "../../actions";

export const metadata: Metadata = { title: "Add food" };

export default async function NewFoodPage() {
  await requireAdmin("nutrition.manage");
  const categories = await getFoodCategories();
  const names = categories.state === "ready" ? categories.categories.flatMap((item) => (item.category ? [item.category] : [])) : [];
  return (
    <div className={styles.page}>
      <ContentHeader eyebrow="04 Nutrition" title="Add food" back={{ href: "/nutrition", label: "Food database" }} meta="Values per 100 g as eaten. Add portions and a photo next." />
      <FoodForm action={saveFood.bind(null, null)} initial={NEW_FOOD} creating categories={names} />
    </div>
  );
}
