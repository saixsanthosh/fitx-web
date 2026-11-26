/**
 * Nutrition's title, for its layout's metadata. It is a template object, not a plain string: in Next.js a layout's
 * plain string title resolves with no template, so every page under it loses the root layout's "%s | FITX" (Food data
 * sources read just "Food data sources"). `default` names /nutrition, whose page is a client component and can't export
 * metadata ("Nutrition | FITX", through the root's template); `template` keeps "| FITX" on the pages under it ("Food
 * data sources | FITX"), the same template as the root layout's.
 */
export const NUTRITION_TITLE = { default: "Nutrition", template: "%s | FITX" } as const;
