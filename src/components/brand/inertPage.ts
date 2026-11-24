/**
 * Shutting the page behind a full-screen film (CinematicIntro, and the welcome film after onboarding through
 * PostOnboardingSequence), so a modal that says it is one really is.
 *
 * `inertOutside(root)` makes everything outside `root` inert while the opaque film covers the page: focus, clicks and
 * assistive tech cannot reach (or Tab through) controls nobody can see, such as the links under it. It walks up from
 * `root` to <body>, marking the siblings at each level; scripts, styles and links are skipped, and elements that were
 * inert already are left alone (so releasing never wakes something another part of the page shut). Returns the
 * elements it changed, for `releaseInert`, which gives them back.
 */
export function inertOutside(root: HTMLElement): HTMLElement[] {
  const marked: HTMLElement[] = [];
  let node: Element = root;
  while (node !== document.body && node.parentElement) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (sibling === node || !(sibling instanceof HTMLElement) || sibling.inert) continue;
      if (sibling.tagName === "SCRIPT" || sibling.tagName === "STYLE" || sibling.tagName === "LINK") continue;
      sibling.inert = true;
      marked.push(sibling);
    }
    node = node.parentElement;
  }
  return marked;
}

export function releaseInert(marked: HTMLElement[]) {
  for (const element of marked) element.inert = false;
  marked.length = 0;
}
