/** Keyboard handling for a horizontal tab list. Pure, so node tests can cover it. */

export type TabKeyOptions = {
  /** Flags per tab, in order; disabled tabs are skipped. */
  disabled?: readonly boolean[];
  /** Left and Right arrows swap in right-to-left layouts. */
  rtl?: boolean;
};

/**
 * The index of the tab a key moves to, or null when the key is not a tab-list key or nothing can
 * receive focus. Arrows wrap around, Home and End jump to the first and last enabled tab.
 */
export function nextTabIndex(key: string, current: number, count: number, options: TabKeyOptions = {}): number | null {
  if (count <= 0) return null;
  const enabled = (index: number) => !options.disabled?.[index];
  const forwardKey = options.rtl ? "ArrowLeft" : "ArrowRight";
  const backwardKey = options.rtl ? "ArrowRight" : "ArrowLeft";
  const step = key === forwardKey ? 1 : key === backwardKey ? -1 : 0;
  if (step !== 0) {
    const start = current >= 0 && current < count ? current : step === 1 ? -1 : 0;
    for (let offset = 1; offset <= count; offset += 1) {
      const index = (((start + step * offset) % count) + count) % count;
      if (enabled(index)) return index;
    }
    return null;
  }
  if (key === "Home") {
    for (let index = 0; index < count; index += 1) if (enabled(index)) return index;
    return null;
  }
  if (key === "End") {
    for (let index = count - 1; index >= 0; index -= 1) if (enabled(index)) return index;
    return null;
  }
  return null;
}

/** The tab to select: `wanted` when it names an enabled tab, else the first enabled one (or null). */
export function resolveTab<T extends { id: string; disabled?: boolean }>(tabs: readonly T[], wanted: string | null | undefined): string | null {
  const match = tabs.find((tab) => tab.id === wanted && !tab.disabled);
  return match?.id ?? tabs.find((tab) => !tab.disabled)?.id ?? null;
}
