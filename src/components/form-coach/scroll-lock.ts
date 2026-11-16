/**
 * One page-scroll lock shared by the coach's overlays: the workout's "Count with camera" sheet and
 * the live camera view inside it. Each overlay holds the lock while it is open, and the page gets
 * its scrolling back only when the last one lets go. Saving and restoring the style per overlay
 * breaks when a whole tree is removed at once (the back button mid-set): React runs the parent
 * sheet's cleanup before the camera view's, and the camera view then restores "hidden".
 */

export interface ScrollLockTarget {
  style: { overflow: string };
}

const held = new WeakMap<ScrollLockTarget, { count: number; overflow: string }>();

/** Stops `target` (the page body by default) scrolling until the returned release is called. */
export function lockScroll(target: ScrollLockTarget = document.body): () => void {
  let lock = held.get(target);
  if (!lock) {
    lock = { count: 0, overflow: target.style.overflow };
    held.set(target, lock);
    target.style.overflow = "hidden";
  }
  const current = lock;
  current.count += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    current.count -= 1;
    if (current.count > 0) return;
    held.delete(target);
    target.style.overflow = current.overflow;
  };
}
