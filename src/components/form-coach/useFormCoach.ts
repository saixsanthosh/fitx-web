"use client";

import type { RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CoachSnapshot } from "@/lib/form-rules/session";
import type { ExerciseRule } from "@/lib/form-rules/types";
import type { CoachStage, FrameSize } from "./coach-machine";
import { CoachVoice as CoachVoiceForPreview } from "./voice";
import { CoachMachine } from "./coach-machine";
import type { LiveFigureHandle } from "@/components/home-workout/LiveFigure";
import type { VoiceGender } from "./voice";
import { pickVoice, readVoiceGender, readVoicePreference, speechSupported, writeVoiceGender, writeVoicePreference } from "./voice";

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
  voice: {
    supported: boolean;
    enabled: boolean;
    gender: VoiceGender;
    /** False when this device has no voice of the chosen gender (a pitched default is used). */
    matched: boolean;
    setEnabled(on: boolean): void;
    setGender(gender: VoiceGender): void;
    /** Says a short line in the chosen voice, to hear it before starting. */
    preview(): void;
  };
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
const subscribeVoices = (onChange: () => void) => {
  if (!speechSupported()) return () => undefined;
  const synth = window.speechSynthesis;
  synth.addEventListener?.("voiceschanged", onChange);
  window.addEventListener(VOICE_EVENT, onChange);
  return () => {
    synth.removeEventListener?.("voiceschanged", onChange);
    window.removeEventListener(VOICE_EVENT, onChange);
  };
};
const readMatched = () => {
  if (!speechSupported()) return true;
  const voices = window.speechSynthesis.getVoices();
  // Voices load late in some browsers: say nothing until they have arrived.
  return voices.length === 0 || pickVoice(voices, readVoiceGender(), document.documentElement.lang || "en-GB").matched;
};

/** The elements the camera loop draws into. Kept apart from the controller's values, which render. */
export interface CoachRefs {
  video: RefObject<HTMLVideoElement | null>;
  canvas: RefObject<HTMLCanvasElement | null>;
  meter: RefObject<HTMLDivElement | null>;
  figure: RefObject<LiveFigureHandle | null>;
}

export function useCoachRefs(): CoachRefs {
  const video = useRef<HTMLVideoElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const meter = useRef<HTMLDivElement | null>(null);
  const figure = useRef<LiveFigureHandle | null>(null);
  return useMemo(() => ({ video, canvas, meter, figure }), []);
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
  const voiceGender = useSyncExternalStore(subscribeVoice, readVoiceGender, () => "female" as VoiceGender);
  const voiceMatched = useSyncExternalStore(subscribeVoices, readMatched, () => true);

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
      pose: (points, aspect, mirrored, side) => refs.figure.current?.update(points, aspect, mirrored, side),
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

  const setVoiceGender = useCallback((gender: VoiceGender) => {
    writeVoiceGender(gender);
    window.dispatchEvent(new Event(VOICE_EVENT));
    if (machineRef.current) machineRef.current.voice.gender = gender;
  }, []);

  const previewVoice = useCallback(() => {
    new CoachVoiceForPreview(false, readVoiceGender()).preview("Ready when you are");
  }, []);

  return {
    stage,
    snapshot,
    frame,
    mirrored,
    cameraCount,
    notice,
    announcement,
    voice: { supported: voiceSupported, enabled: voiceEnabled, gender: voiceGender, matched: voiceMatched, setEnabled: setVoiceEnabled, setGender: setVoiceGender, preview: previewVoice },
    start: (rule) => void machine().start(rule, voiceEnabled, voiceGender),
    resume: () => void machine().resume(),
    finish: () => machine().finish(),
    switchCamera: () => void machine().switchCamera(),
    reset: () => machine().reset(),
  };
}
