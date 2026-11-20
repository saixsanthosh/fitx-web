import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { CategoryRename } from "@/components/content/category-rename";
import { SubmitButton } from "@/components/content/confirm-submit";
import { ContentHeader, ContentTabs, DataState, Empty, Pager, Pill, Section, StateNotice, contentStyles as styles, formatCount } from "@/components/content/kit";
import { hasPermission, requireAdmin } from "@/lib/admin-auth";
import { CONTENT_MIGRATION } from "@/lib/content/errors";
import { DIET_LABELS } from "@/lib/content/vocabulary";
import { FOOD_PAGE_SIZE, NO_CATEGORY, getFoodCategories, listFoods, parseFoodFilters, type FoodFilters, type FoodRow } from "@/lib/data/foods";
import { firstParam } from "@/lib/search-params";
import { renameFoodCategory, setFoodActive } from "./actions";

export const metadata: Metadata = { title: "Nutrition" };

type Params = Record<string, string | string[] | undefined>;
type Tab = "foods" | "categories" | "plans";

const NOTICES = {
  shown: { text: "Food shown in food search.", good: true },
  hidden: { text: "Food hidden from food search. Meals already logged keep it.", good: true },
  save_failed: { text: "The change could not be saved. Nothing was changed.", good: false },
  invalid: { text: "That request was not valid.", good: false },
  configuration: { text: "Server data access is not configured.", good: false },
  forbidden: { text: "Your role cannot make this change.", good: false },
};

function listHref(filters: FoodFilters, change: Partial<FoodFilters> = {}) {
  const next = { ...filters, ...change };
  const query = new URLSearchParams();
  if (next.q) query.set("q", next.q);
  if (next.category) query.set("category", next.category);
  if (next.visibility !== "all") query.set("visibility", next.visibility);
  if (next.source !== "all") query.set("source", next.source);
  if (next.page > 1) query.set("page", String(next.page));
  const text = query.toString();
  return text ? `/nutrition?${text}` : "/nutrition";
}

const grams = (value: number) => `${value.toLocaleString("en-IN", { maximumFractionDigits: 1 })} g`;

function FoodItem({ row, supabaseHost }: { row: FoodRow; supabaseHost: string | null }) {
  const ownPhoto = Boolean(row.image_url && supabaseHost && row.image_url.startsWith(supabaseHost));
  return (
    <li className={styles.row}>
      <span className={`${styles.thumb} ${row.is_active ? "" : styles.thumbHidden}`} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- FITX's own Storage copy; Admin's CSP allows only this project */}
        {ownPhoto && row.image_url ? <img src={row.image_url} alt="" loading="lazy" width={52} height={52} /> : row.name.slice(0, 2).toUpperCase()}
      </span>
      <Link className={styles.rowLink} href={`/nutrition/foods/${encodeURIComponent(row.id)}`}>
        <span className={styles.rowTitle}>{row.name}</span>
        <span className={styles.rowSub}>
          {row.category ?? "No category"}
          {row.diet_type ? ` · ${DIET_LABELS[row.diet_type as keyof typeof DIET_LABELS] ?? row.diet_type}` : ""}
        </span>
      </Link>
      <span className={styles.rowNumbers}>
        {Math.round(row.kcal).toLocaleString("en-IN")} kcal · P {grams(row.protein_g)} · C {grams(row.carbs_g)} · F {grams(row.fat_g)}
      </span>
      <span className={styles.rowMeta}>
        <Pill tone={row.is_active ? "good" : "neutral"}>{row.is_active ? "Shown" : "Hidden"}</Pill>
        {row.source === "fitx_admin" && <Pill tone="accent" plain>Admin</Pill>}
        {row.value_basis === "estimated" && <Pill plain>Estimate</Pill>}
      </span>
      <form action={setFoodActive} className={styles.rowAction}>
        <input type="hidden" name="foodId" value={row.id} />
        <input type="hidden" name="active" value={String(!row.is_active)} />
        <SubmitButton quiet small>{row.is_active ? "Hide" : "Show"}</SubmitButton>
      </form>
    </li>
  );
}

async function FoodsTab({ filters, categories }: { filters: FoodFilters; categories: string[] }) {
  const result = await listFoods(filters);
  const filtered = Boolean(filters.q || filters.category || filters.visibility !== "all" || filters.source !== "all");
  const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "") ?? null;
  return (
    <div className={styles.section}>
      <form action="/nutrition" className={styles.toolbar} role="search">
        <label className={styles.search}>
          <span className={styles.srOnly}>Search foods</span>
          <Search aria-hidden="true" size={18} />
          <input type="search" name="q" defaultValue={filters.q} maxLength={80} placeholder="Name, alias or search word" />
        </label>
        <div className={styles.filters}>
          <select name="category" defaultValue={filters.category} aria-label="Category">
            <option value="">All categories</option>
            <option value={NO_CATEGORY}>No category</option>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <select name="source" defaultValue={filters.source} aria-label="Source">
            <option value="all">All sources</option>
            <option value="usda">USDA FoodData Central</option>
            <option value="admin">Added in Admin</option>
          </select>
          <select name="visibility" defaultValue={filters.visibility} aria-label="Visibility">
            <option value="all">Shown and hidden</option>
            <option value="shown">Shown</option>
            <option value="hidden">Hidden</option>
          </select>
          <div className={styles.filterActions}>
            <button className={`${styles.button} ${styles.small}`} type="submit">Apply</button>
            {filtered && <Link className={`${styles.buttonQuiet} ${styles.small}`} href="/nutrition">Clear</Link>}
          </div>
        </div>
      </form>
      {result.state !== "ready" ? (
        <DataState state={result.state} />
      ) : (
        <div className={styles.panel}>
          <p className={`${styles.hint} ${styles.panelPad}`}>Values per 100 g as eaten.</p>
          {result.rows.length ? (
            <ul className={styles.list} aria-label="Foods">
              {result.rows.map((row) => <FoodItem key={row.id} row={row} supabaseHost={supabaseHost} />)}
            </ul>
          ) : (
            <Empty title={filtered ? "No food matches" : "No foods yet"}>
              {filtered ? <Link className={styles.buttonQuiet} href="/nutrition">Clear filters</Link> : <Link className={styles.button} href="/nutrition/foods/new">Add food</Link>}
            </Empty>
          )}
          <Pager page={filters.page} total={result.total} pageSize={FOOD_PAGE_SIZE} href={(page) => listHref(filters, { page })} />
        </div>
      )}
    </div>
  );
}

export default async function NutritionPage({ searchParams }: { searchParams: Promise<Params> }) {
  const operator = await requireAdmin("nutrition.manage");
  const params = await searchParams;
  const tabParam = firstParam(params.tab);
  const tab: Tab = tabParam === "categories" || tabParam === "plans" ? tabParam : "foods";
  const filters = parseFoodFilters(params);
  const categoryResult = await getFoodCategories();
  const categories = categoryResult.state === "ready" ? categoryResult.categories : [];
  const named = categories.flatMap((item) => (item.category ? [item.category] : [])).sort((a, b) => a.localeCompare(b));
  const totalFoods = categoryResult.state === "ready" ? categories.reduce((sum, item) => sum + item.foods, 0) : null;
  const shownFoods = categoryResult.state === "ready" ? categories.reduce((sum, item) => sum + item.active, 0) : null;
  return (
    <div className={styles.page}>
      <ContentHeader
        eyebrow="04 Nutrition"
        title="Nutrition"
        meta={totalFoods !== null ? `${formatCount(shownFoods)} foods in search of ${formatCount(totalFoods)}` : undefined}
        actions={<Link className={styles.button} href="/nutrition/foods/new"><Plus aria-hidden="true" size={16} />Add food</Link>}
      />
      <StateNotice state={firstParam(params.state)} messages={NOTICES} />
      <ContentTabs
        label="Nutrition"
        items={[
          { href: "/nutrition", label: "Food database", count: totalFoods, current: tab === "foods" },
          { href: "/nutrition?tab=categories", label: "Categories", count: categoryResult.state === "ready" ? named.length : null, current: tab === "categories" },
          { href: "/nutrition?tab=plans", label: "Meal plans", current: tab === "plans" },
        ]}
      />
      {tab === "foods" && <FoodsTab filters={filters} categories={named} />}
      {tab === "categories" &&
        (categoryResult.state !== "ready" ? (
          <DataState state={categoryResult.state} migration={CONTENT_MIGRATION} />
        ) : (
          <div className={styles.page}>
            <Section title="Rename or merge">
              <CategoryRename action={renameFoodCategory} categories={named} />
            </Section>
            <Section title="All categories" note="Foods shown in search, of all foods">
              <ul className={styles.vocab}>
                {categories.map((item) => (
                  <li key={item.category ?? NO_CATEGORY}>
                    <Link className={styles.vocabItem} href={`/nutrition?category=${encodeURIComponent(item.category ?? NO_CATEGORY)}`}>
                      <strong>{item.category ?? "No category"}</strong>
                      <span className={styles.vocabCount}>{item.active.toLocaleString("en-IN")}</span>
                      <span>of {item.foods.toLocaleString("en-IN")}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        ))}
      {tab === "plans" && (
        <div className={`${styles.panel} ${styles.panelPad}`}>
          <Empty title="No meal plans in the database">
            <p>Members build their own saved meals and day routines, which only they can see. Their counts are in Reports.</p>
            {hasPermission(operator, "reports.view") && <Link className={styles.buttonQuiet} href="/reports#nutrition">Open Reports</Link>}
          </Empty>
        </div>
      )}
    </div>
  );
}
