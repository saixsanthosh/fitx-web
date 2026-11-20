// Audit actions of the Admin workouts, nutrition, billing and reports areas. No imports.
// Owned by the admin-content stream after admin-a; audit-catalog.ts merges it with audit-catalog-core.ts.

export const CONTENT_AUDIT_ACTIONS = {
  exercise_visibility_updated: { label: "Exercise visibility changed", group: "Content", source: "database" },
} as const satisfies Record<string, { label: string; group: string; source: "server" | "database" }>;

export const CONTENT_AUDIT_RESOURCE_TYPES = ["exercise"] as const;
