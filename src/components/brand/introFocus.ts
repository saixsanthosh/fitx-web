type FocusDocument = Pick<Document, "activeElement" | "querySelectorAll">;

/**
 * Where focus goes when the film closes while it is on the overlay's Skip button, which is about to be
 * hidden. Someone on the keyboard (Skip shows its focus ring: they pressed Tab while the film waited for the
 * app, or while it played) carries on from the top of the page, on its first "Skip to content" link that
 * can take focus (SkipLink, shown while focused): where Tab starts on any page load. Otherwise the next Tab
 * would start from the overlay's place in the page, which is after the header on the home page. Anyone
 * else's focus (a mouse click on Skip) is let go, as before. Returns the link that took focus, if any.
 */
export function focusAfterFilm(skip: HTMLElement, doc: FocusDocument = document): HTMLElement | null {
  if (skip.matches(":focus-visible")) {
    for (const link of Array.from(doc.querySelectorAll<HTMLElement>(".fitx-skip-link"))) {
      link.focus({ preventScroll: true });
      if (doc.activeElement === link) return link;
    }
  }
  skip.blur();
  return null;
}
