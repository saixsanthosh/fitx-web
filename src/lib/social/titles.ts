/**
 * Explore's page titles (bug 78). The layout's template lives here so that a page which changes what it shows without
 * a navigation (the story viewer moving on to the next account in the tray) can keep its tab title in step, built the
 * same way Next builds it from the template.
 */
export const EXPLORE_TITLE_TEMPLATE = "%s · Explore · FITX";

/** A page's whole tab title from its own title, as Next fills in the template ("Story by @x · Explore · FITX"). */
export function exploreTabTitle(title: string): string {
  return EXPLORE_TITLE_TEMPLATE.replace(/%s/g, () => title);
}

/** The story viewer's title: whose stories are on screen. */
export function storyTitle(username: string): string {
  return `Story by @${username}`;
}
