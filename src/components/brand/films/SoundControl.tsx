"use client";

import { Volume2, VolumeX } from "lucide-react";
import type { FilmSound } from "./filmSound";
import styles from "./FilmControls.module.css";

/**
 * The film's "Sound" button (BRIEF-2 3.4), beside Skip. Renders nothing when the film has no sound, so there is never
 * a dummy control. Muted by default; a refused stored "on" shows "Tap for sound" until the member taps it.
 */
export function SoundControl({ sound }: { sound: FilmSound }) {
  if (!sound.available) return null;
  return (
    <span className={styles.wrap}>
      <button type="button" className={styles.sound} aria-pressed={sound.on} onClick={sound.toggle} data-coach-avoid="" data-fitx-film-sound="">
        {sound.on ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
        <span>Sound</span>
      </button>
      {sound.needsTap && <span className={styles.hint} role="status">Tap for sound</span>}
    </span>
  );
}
