"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Check, ChevronDown, Lock, LockOpen } from "lucide-react";
import { pickVoice, recognitionLang, type VoiceLike } from "@/components/coach/voice";
import { SPORT_GROUPS, SPORT_LABEL } from "@/lib/activity/config";
import { PRIMARY_SPORTS, type Sport } from "@/lib/activity/types";
import { cn } from "@/lib/utils";
import { SPORT_TONE, SportIcon } from "./sports";

/*
 * Recording helpers in the spirit of Strava's record screen: a sport chooser with the main sports up front and the
 * rest grouped behind "More sports", auto-pause and spoken cues as per-device settings, and a lock so a phone in a
 * hand or pocket doesn't pause or finish by accident.
 */

function readLocal(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeLocal(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* A preference only. */ }
}

/** A yes/no setting kept on this device. Off until read, so the server render and the first paint agree. */
export function useDeviceSwitch(key: string): [boolean, (value: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setOn(readLocal(key) === "on"), 0);
    return () => window.clearTimeout(id);
  }, [key]);
  const set = useCallback((value: boolean) => {
    setOn(value);
    writeLocal(key, value ? "on" : "off");
  }, [key]);
  return [on, set];
}

export const AUTO_PAUSE_KEY = "fitx:activity:auto-pause";
export const AUDIO_CUES_KEY = "fitx:activity:audio-cues";

/** Speaks with an on-device voice only; `available` is false where the browser has none (then cues are not offered). */
export function useCueVoice() {
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const update = () => {
      const voices = synth.getVoices();
      const chosen = pickVoice(voices as unknown as VoiceLike[], recognitionLang(navigator.language));
      setVoice(chosen ? (voices.find((item) => item.name === chosen.name && item.lang === chosen.lang) ?? null) : null);
    };
    update();
    synth.addEventListener("voiceschanged", update);
    return () => {
      synth.removeEventListener("voiceschanged", update);
      synth.cancel();
    };
  }, []);
  const speak = useCallback((text: string) => {
    if (!voice) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    window.speechSynthesis.speak(utterance);
  }, [voice]);
  return { available: voice !== null, speak };
}

/** A labelled on/off switch with a 44 px target. */
export function SettingSwitch({ label, hint, on, onChange, disabled }: { label: string; hint: string; on: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  const hintId = useId();
  return (
    <div className="flex min-h-12 items-center justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fitx-text">{label}</span>
        <span id={hintId} className="block text-xs leading-5 text-fitx-text-secondary">{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        aria-describedby={hintId}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className="group grid h-11 w-14 shrink-0 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fitx-primary disabled:opacity-50"
      >
        <span aria-hidden="true" className={cn("relative h-7 w-12 rounded-full transition-colors duration-200", on ? "bg-fitx-primary" : "bg-fitx-surface-variant ring-1 ring-inset ring-fitx-border")}>
          <span className={cn("absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-fitx-card shadow-sm transition-transform duration-200 motion-reduce:transition-none", on && "translate-x-5")} />
        </span>
      </button>
    </div>
  );
}

function SportButton({ sport, selected, onChoose }: { sport: Sport; selected: boolean; onChoose: (sport: Sport) => void }) {
  return (
    <button type="button" aria-pressed={selected} onClick={() => onChoose(sport)} className="group flex min-h-24 min-w-0 flex-col items-center justify-center gap-2 rounded-2xl text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fitx-primary">
      <span aria-hidden="true" className={cn(
        "relative grid h-16 w-16 place-items-center rounded-full border-2 transition-[transform,background-color,border-color] duration-200",
        selected ? cn(SPORT_TONE[sport].bg, SPORT_TONE[sport].border, SPORT_TONE[sport].text, "motion-safe:scale-105") : "border-transparent bg-fitx-surface-variant text-fitx-text-secondary group-hover:text-fitx-text",
      )}>
        <SportIcon sport={sport} size={26} />
        {selected && <span className={cn("absolute -right-0.5 -top-0.5 grid h-5 w-5 place-items-center rounded-full text-fitx-on-primary", SPORT_TONE[sport].fill)}><Check size={12} strokeWidth={3} /></span>}
      </span>
      <span className={cn("max-w-full truncate px-1", selected ? cn("font-semibold", SPORT_TONE[sport].text) : "text-fitx-text-secondary")}>{SPORT_LABEL[sport]}</span>
    </button>
  );
}

/**
 * Walk, run and ride up front (plus the chosen sport when it is another one), and every sport grouped behind
 * "More sports" once the database takes them (`more`).
 */
export function SportPicker({ sport, onChoose, more }: { sport: Sport; onChoose: (sport: Sport) => void; more: boolean }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const quick = PRIMARY_SPORTS.includes(sport) ? PRIMARY_SPORTS : [...PRIMARY_SPORTS, sport];
  return (
    <div>
      <div className={cn("grid gap-2", quick.length === 4 ? "grid-cols-4" : "grid-cols-3")} role="group" aria-label="Activity type">
        {quick.map((option) => <SportButton key={option} sport={option} selected={sport === option} onChoose={onChoose} />)}
      </div>
      {more && (
        <>
          <button type="button" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((value) => !value)} className="mt-2 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl text-sm font-medium text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text">
            More sports
            <ChevronDown size={16} aria-hidden="true" className={cn("transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} />
          </button>
          <div id={listId} hidden={!open} className="mt-1 space-y-3">
            {SPORT_GROUPS.map((group) => (
              <div key={group.id} role="group" aria-label={group.label}>
                <p className="px-1 text-xs font-semibold uppercase tracking-[.12em] text-fitx-text-secondary">{group.label}</p>
                <ul className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {group.sports.map((option) => (
                    <li key={option}>
                      <button
                        type="button"
                        aria-pressed={sport === option}
                        onClick={() => { onChoose(option); setOpen(false); }}
                        className={cn(
                          "flex min-h-11 w-full items-center gap-2 rounded-xl border px-3 text-left text-sm font-medium transition-colors",
                          sport === option ? cn(SPORT_TONE[option].border, SPORT_TONE[option].bg, SPORT_TONE[option].text) : "border-fitx-border text-fitx-text hover:bg-fitx-hover",
                        )}
                      >
                        <SportIcon sport={option} size={17} className={sport === option ? undefined : "text-fitx-text-secondary"} />
                        <span className="truncate">{SPORT_LABEL[option]}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const HOLD_MS = 800;

/**
 * Locked controls: Pause and Finish are replaced by one button that must be held (pointer or Space/Enter) for
 * 0.8 s, so a bumped screen changes nothing. The ring fills with transform only; with reduced motion it doesn't
 * animate, and the hold still works.
 */
export function UnlockButton({ onUnlock }: { onUnlock: () => void }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);
  const stop = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  }, []);
  useEffect(() => stop, [stop]);
  const begin = () => {
    if (timer.current !== null) return;
    setHolding(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onUnlock();
    }, HOLD_MS);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
      event.preventDefault();
      begin();
    }
  };
  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === " " || event.key === "Enter") stop();
  };
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    begin();
  };
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        aria-label="Hold to unlock controls"
        onPointerDown={onPointerDown}
        onPointerUp={stop}
        onPointerCancel={stop}
        onPointerLeave={stop}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onContextMenu={(event) => event.preventDefault()}
        className="group relative grid h-20 w-20 touch-none select-none place-items-center rounded-full border border-fitx-border bg-fitx-surface text-fitx-text focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-fitx-primary"
      >
        <span aria-hidden="true" className={cn("absolute inset-0 rounded-full bg-fitx-primary/20 motion-safe:transition-transform motion-safe:ease-linear", holding ? "scale-100 motion-safe:duration-[800ms]" : "scale-0 duration-0")} />
        {holding ? <LockOpen size={26} aria-hidden="true" className="relative" /> : <Lock size={26} aria-hidden="true" className="relative" />}
      </button>
      <span className="text-sm font-semibold text-fitx-text">Hold to unlock</span>
    </div>
  );
}
