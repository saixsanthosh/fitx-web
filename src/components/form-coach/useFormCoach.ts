"use client";

import type { RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CoachSnapshot } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import type { CoachStage, FrameSize } from "./coach-machine";
import { CoachMachine } from "./coach-machine";
import { readVoicePreference, speechSupported, writeVoicePreference } from "./voice";

export type { CoachStage, FrameSize } from "./coach-machine";

export interface FormCoachController {
  stage: CoachStage;
  snapshot: CoachSnapshot | null;
  /** Camera picture size, once known. */
  frame: FrameSize | null;
  /** Show the picture mirrored (selfie cameras). */
  mirrored: boolean;
  cameraCount: number;
  /** A note about this device (e.g. running slowly). */
  notice: string | null;
  /** Latest message for screen readers. */
  announcement: string;
  voice: { supported: boolean; enabled: boolean; setEnabled(on: boolean): void };
  start(rule: ExerciseRule): void;
  resume(): void;
  finish(): void;
  switchCamera(): void;
  reset(): void;
}

const VOICE_EVENT = "fitx:form-coach:voice";
const subscribeVoice = (onChange: () => void) => {
  window.addEventListener(VOICE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(VOICE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
};
const subscribeNothing = () => () => undefined;

/** The elements the camera loop draws into. Kept apart from the controller's values, which render. */
export interface CoachRefs {
  video: RefObject<HTMLVideoElement | null>;
  canvas: RefObject<HTMLCanvasElement | null>;
  meter: RefObject<HTMLDivElement | null>;
}

export function useCoachRefs(): CoachRefs {
  const video = useRef<HTMLVideoElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const meter = useRef<HTMLDivElement | null>(null);
  return useMemo(() => ({ video, canvas, meter }), []);
}

export function useFormCoach(refs: CoachRefs): FormCoachController {
  const machineRef = useRef<CoachMachine | null>(null);
  const [stage, setStage] = useState<CoachStage>({ name: "idle" });
  const [snapshot, setSnapshot] = useState<CoachSnapshot | null>(null);
  const [frame, setFrame] = useState<FrameSize | null>(null);
  const [mirrored, setMirrored] = useState(true);
  const [cameraCount, setCameraCount] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const voiceEnabled = useSyncExternalStore(subscribeVoice, readVoicePreference, () => false);
  const voiceSupported = useSyncExternalStore(subscribeNothing, speechSupported, () => false);

  /** The runtime is created on first use, from an event handler, never during render. */
  const machine = useCallback(() => {
    machineRef.current ??= new CoachMachine({
      setStage,
      setSnapshot,
      setFrame,
      setMirrored,
      setCameraCount,
      setNotice,
      announce: setAnnouncement,
      video: () => refs.video.current,
      canvas: () => refs.canvas.current,
      meter: () => refs.meter.current,
    });
    return machineRef.current;
  }, [refs]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") machineRef.current?.backgrounded();
    };
    const onPageHide = () => machineRef.current?.backgrounded();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  // Leaving the page (or the page being hidden by navigation) always turns the camera off.
  useLayoutEffect(() => () => {
    machineRef.current?.dispose();
    machineRef.current = null;
  }, []);

  const setVoiceEnabled = useCallback((on: boolean) => {
    writeVoicePreference(on);
    window.dispatchEvent(new Event(VOICE_EVENT));
    const current = machineRef.current;
    if (current) {
      current.voice.enabled = on;
      if (on) current.voice.prime();
      else current.voice.stop();
    }
  }, []);

  return {
    stage,
    snapshot,
    frame,
    mirrored,
    cameraCount,
    notice,
    announcement,
    voice: { supported: voiceSupported, enabled: voiceEnabled, setEnabled: setVoiceEnabled },
    start: (rule) => void machine().start(rule, voiceEnabled),
    resume: () => void machine().resume(),
    finish: () => machine().finish(),
    switchCamera: () => void machine().switchCamera(),
    reset: () => machine().reset(),
  };
}
