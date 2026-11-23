// Audit actions of the Admin Explore section (moderation, communities, challenges). No imports.
// "database" actions are written inside the fitx_admin_op_* functions of 20261124100020_fitx_admin_explore;
// "server" ones by the Admin server through logAdminEvent. audit-catalog.ts merges this list with the others.

export const EXPLORE_AUDIT_ACTIONS = {
  explore_report_dismissed: { label: "Explore report dismissed", group: "Explore", source: "database" },
  explore_report_claimed: { label: "Explore report taken for review", group: "Explore", source: "database" },
  explore_content_limited: { label: "Explore content limited", group: "Explore", source: "database" },
  explore_content_hidden: { label: "Explore content hidden", group: "Explore", source: "database" },
  explore_content_unhidden: { label: "Explore content shown again", group: "Explore", source: "database" },
  explore_content_removed: { label: "Explore content removed", group: "Explore", source: "database" },
  explore_profile_cleared: { label: "Explore profile photo or bio cleared", group: "Explore", source: "database" },
  explore_member_warned: { label: "Explore warning sent", group: "Explore", source: "database" },
  explore_member_suspended: { label: "Member suspended in Explore", group: "Explore", source: "database" },
  explore_member_unsuspended: { label: "Explore suspension lifted", group: "Explore", source: "database" },
  explore_community_saved: { label: "Community saved", group: "Explore", source: "database" },
  explore_community_role_set: { label: "Community moderator changed", group: "Explore", source: "database" },
  explore_challenge_saved: { label: "Challenge saved", group: "Explore", source: "database" },
  explore_challenge_closed: { label: "Challenge closed", group: "Explore", source: "database" },
  explore_template_saved: { label: "Challenge template saved", group: "Explore", source: "database" },
  explore_report_viewed: { label: "Explore report opened", group: "Explore", source: "server" },
} as const satisfies Record<string, { label: string; group: string; source: "server" | "database" }>;

export const EXPLORE_AUDIT_RESOURCE_TYPES = ["social_report", "social_post", "social_comment", "social_story", "social_profile", "social_community", "social_challenge"] as const;

/** Looks, not changes: listed on /audit but kept off the Dashboard's recent activity. */
export const EXPLORE_READ_ONLY_AUDIT_ACTIONS = ["explore_report_viewed"] as const satisfies readonly (keyof typeof EXPLORE_AUDIT_ACTIONS)[];
