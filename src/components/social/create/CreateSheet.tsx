"use client";

import Link from "next/link";
import { useRef, useState, type KeyboardEvent } from "react";
import { m } from "framer-motion";
import { Clapperboard, ImagePlus, Plus, Sparkles, type LucideIcon } from "lucide-react";
import { useReducedMotionSafe } from "@/components/motion/useReducedMotionSafe";
import { Sheet } from "@/components/ui/Sheet";
import { createChoices, CREATE_OPTIONS, type CreateKey, type CreateOption } from "@/lib/social/rail";
import styles from "../Explore.module.css";

const ICONS: Record<CreateKey, LucideIcon> = { photo: ImagePlus, story: Sparkles, video: Clapperboard };

/**
 * Explore's "New post" pill. With one way to create (photo posts, until stories and videos ship) it goes straight to
 * the composer; with more it opens the create menu: "Photo post", "Story" and "Video".
 */
export function NewPostButton({ videosOn, options = CREATE_OPTIONS }: { videosOn: boolean; options?: readonly CreateOption[] }) {
  const [open, setOpen] = useState(false);
  const choices = createChoices(videosOn, options);
  const label = <><Plus size={19} aria-hidden="true" /><span className={styles.newPostLabel}>New post</span></>;
  if (choices.length <= 1) {
    return <Link href={choices[0]?.href ?? "/explore/new"} className={styles.newPost} aria-label="New post">{label}</Link>;
  }
  return (
    <>
      <button type="button" className={styles.newPost} aria-label="New post" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(true)}>
        {label}
      </button>
      <CreateSheet open={open} onClose={() => setOpen(false)} choices={choices} />
    </>
  );
}

/** The create menu, in a sheet: each choice is a link, with arrow keys moving between them. */
export function CreateSheet({ open, onClose, choices }: { open: boolean; onClose: () => void; choices: readonly CreateOption[] }) {
  const reduced = useReducedMotionSafe();
  const list = useRef<HTMLUListElement>(null);
  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...(list.current?.querySelectorAll<HTMLAnchorElement>("[role=menuitem]") ?? [])];
    if (!items.length) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLAnchorElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  }
  return (
    <Sheet open={open} onClose={onClose} title="Create">
      <ul ref={list} role="menu" aria-label="Create" className={styles.createList} onKeyDown={onKeyDown}>
        {choices.map((choice, index) => {
          const Icon = ICONS[choice.key];
          return (
            <m.li
              key={choice.key}
              role="none"
              initial={reduced ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, delay: reduced ? 0 : 0.04 * index, ease: [0.22, 1, 0.36, 1] }}
            >
              <Link role="menuitem" href={choice.href} className={styles.createItem} onClick={onClose}>
                <span className={styles.createIcon} aria-hidden="true"><Icon size={22} /></span>
                <span className={styles.createText}>
                  <span className={styles.createLabel}>{choice.label}</span>
                  <span className={styles.createHint}>{choice.hint}</span>
                </span>
              </Link>
            </m.li>
          );
        })}
      </ul>
    </Sheet>
  );
}
