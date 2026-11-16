"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type WakeLockState = "off" | "on" | "unsupported" | "blocked";

/**
 * Keeps the screen on while `enabled`, using the Screen Wake Lock API. Browsers drop the lock when
 * the tab is hidden, so it is requested again when the workout tab becomes visible.
 */
export function useScreenWakeLock(enabled: boolean): WakeLockState {
  const [state, setState] = useState<WakeLockState>("off");
  useEffect(() => {
    if (!enabled) return;
    if (!("wakeLock" in navigator)) { void Promise.resolve().then(() => setState("unsupported")); return; }
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      if (document.visibilityState !== "visible" || cancelled) return;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (cancelled) { void lock.release(); return; }
        sentinel = lock;
        setState("on");
        lock.addEventListener("release", () => { if (!cancelled) setState("off"); });
      } catch {
        if (!cancelled) setState("blocked");
      }
    };
    const onVisibility = () => { if (document.visibilityState === "visible" && (!sentinel || sentinel.released)) void acquire(); };
    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => undefined);
    };
  }, [enabled]);
  return enabled ? state : "off";
}

const SOUND_KEY = "fitx:workout:cues:v1";
const AWAKE_KEY = "fitx:workout:keep-awake:v1";

function readFlag(key: string, fallback: boolean) {
  try { const value = window.localStorage.getItem(key); return value === null ? fallback : value === "1"; } catch { return fallback; }
}
function writeFlag(key: string, value: boolean) {
  try { window.localStorage.setItem(key, value ? "1" : "0"); } catch { /* A per-device convenience only. */ }
}

/**
 * The end-of-rest and end-of-timer cue (two short tones and a vibration where supported) and this
 * device's preferences for it and for keeping the screen on. Browsers only allow sound after a tap,
 * so `prime()` runs on taps such as completing a set or starting a timer.
 */
export function useWorkoutCues() {
  const [cuesOn, setCuesOn] = useState(true);
  const [keepAwake, setKeepAwake] = useState(true);
  const cuesRef = useRef(true);
  const audioRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    void Promise.resolve().then(() => {
      const cues = readFlag(SOUND_KEY, true);
      cuesRef.current = cues;
      setCuesOn(cues);
      setKeepAwake(readFlag(AWAKE_KEY, true));
    });
    return () => { void audioRef.current?.close().catch(() => undefined); };
  }, []);

  const toggleCues = useCallback(() => {
    const next = !cuesRef.current;
    cuesRef.current = next;
    setCuesOn(next);
    writeFlag(SOUND_KEY, next);
  }, []);
  const toggleKeepAwake = useCallback(() => {
    setKeepAwake((current) => { writeFlag(AWAKE_KEY, !current); return !current; });
  }, []);

  const prime = useCallback(() => {
    if (!cuesRef.current) return;
    try {
      const AudioCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return;
      audioRef.current ??= new AudioCtor();
      if (audioRef.current.state === "suspended") void audioRef.current.resume();
    } catch { /* No sound on this device; the on-screen timer still shows. */ }
  }, []);

  const cue = useCallback(() => {
    if (!cuesRef.current) return;
    try { navigator.vibrate?.([160, 80, 160]); } catch { /* Vibration is optional. */ }
    const context = audioRef.current;
    if (!context || context.state !== "running") return;
    for (const offset of [0, 0.22]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + offset;
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.18);
    }
  }, []);

  return { cuesOn, keepAwake, toggleCues, toggleKeepAwake, prime, cue };
}
