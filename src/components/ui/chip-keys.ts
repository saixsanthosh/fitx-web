/** The chip index a key moves focus to, or null when the key is not a navigation key. Wraps around. */
export function nextChipIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  const from = current < 0 ? 0 : current;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return current < 0 ? 0 : (from + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return current < 0 ? count - 1 : (from - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
