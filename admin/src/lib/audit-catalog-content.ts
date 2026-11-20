// Audit actions of the Admin workouts, nutrition, billing and reports areas. No imports.
// Owned by the admin-content stream after admin-a; audit-catalog.ts merges it with audit-catalog-core.ts.
// "database" actions are written inside the fitx_admin_op_* functions of 20261121100036_fitx_admin_content
// (and 20261121100030 for exercise visibility); "server" ones by the Admin server through logAdminEvent.

export const CONTENT_AUDIT_ACTIONS = {
  exercise_visibility_updated: { label: "Exercise visibility changed", group: "Content", source: "database" },
  exercise_created: { label: "Exercise added", group: "Content", source: "database" },
  exercise_updated: { label: "Exercise edited", group: "Content", source: "database" },
  exercise_deleted: { label: "Exercise deleted", group: "Content", source: "database" },
  exercise_media_added: { label: "Exercise demonstration added", group: "Content", source: "database" },
  exercise_media_removed: { label: "Exercise demonstration removed", group: "Content", source: "database" },
  media_upload_refused: { label: "Upload refused after checks", group: "Content", source: "server" },
  programme_status_updated: { label: "Programme published or drafted", group: "Content", source: "database" },
  food_created: { label: "Food added", group: "Nutrition", source: "database" },
  food_updated: { label: "Food edited", group: "Nutrition", source: "database" },
  food_visibility_updated: { label: "Food visibility changed", group: "Nutrition", source: "database" },
  food_portions_updated: { label: "Food portions changed", group: "Nutrition", source: "database" },
  food_image_updated: { label: "Food photo changed", group: "Nutrition", source: "database" },
  food_category_renamed: { label: "Food category renamed", group: "Nutrition", source: "database" },
  billing_plan_created: { label: "Subscription plan added", group: "Billing", source: "database" },
  billing_plan_updated: { label: "Subscription plan edited", group: "Billing", source: "database" },
  report_exported: { label: "Report exported", group: "Reports", source: "server" },
} as const satisfies Record<string, { label: string; group: string; source: "server" | "database" }>;

export const CONTENT_AUDIT_RESOURCE_TYPES = ["exercise", "training_programme", "food", "food_category", "billing_plan", "report"] as const;
