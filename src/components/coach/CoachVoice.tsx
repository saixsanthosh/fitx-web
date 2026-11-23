"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, Volume2, VolumeX } from "lucide-react";
import { VOICE_PRIVACY } from "@/lib/ai/disclosure";
import { cn } from "@/lib/utils";
import { READ_ALOUD_KEY, TAP_MS, VOICE_OK_KEY, joinTranscript, pickVoice, recognitionLang, speakableText, voiceErrorText, type VoiceLike } from "./voice";
import styles from "./CoachVoice.module.css";

/*
 * Voice conversation: push to talk with the browser's own speech recognition, and replies read aloud with an
 * on-device voice. Nothing is recorded or stored by FITX: the browser turns speech into text, and that text is sent
 * like a typed message. Where the browser has no speech recognition, no microphone button is shown.
 */

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionConstructor = new () => Recognition;

function recognitionClass(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

const read = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
};

const noop = () => () => {};
/** True after hydration in a browser with speech recognition. */
function useRecognitionSupport() {
  return useSyncExternalStore(noop, () => recognitionClass() !== null, () => false);
}

/** Replies read aloud: on only with an on-device voice, and only when the member turned it on. */
export function useReadAloud() {
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);
  // Read once on the client; the toggle only renders after a voice is found (after hydration), so this never differs on screen.
  const [on, setOn] = useState(() => typeof window !== "undefined" && read(READ_ALOUD_KEY) === "on");

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

  const cancel = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!on || !voice) return;
      const spoken = speakableText(text);
      if (!spoken) return;
      const synth = window.speechSynthesis;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(spoken);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = 1;
      synth.speak(utterance);
    },
    [on, voice],
  );

  const toggle = useCallback(() => {
    setOn((old) => {
      write(READ_ALOUD_KEY, old ? "off" : "on");
      if (old) cancel();
      return !old;
    });
  }, [cancel]);

  return { available: voice !== null, on: on && voice !== null, toggle, speak, cancel };
}

export function ReadAloudToggle({ readAloud }: { readAloud: ReturnType<typeof useReadAloud> }) {
  if (!readAloud.available) return null;
  const Icon = readAloud.on ? Volume2 : VolumeX;
  return (
    <button
      type="button"
      onClick={readAloud.toggle}
      aria-pressed={readAloud.on}
      aria-label="Read replies aloud"
      title={readAloud.on ? "Replies are read aloud" : "Read replies aloud"}
      className={cn("grid h-11 w-11 place-items-center rounded-lg text-fitx-text-secondary transition-colors hover:bg-fitx-hover hover:text-fitx-text", readAloud.on && "text-fitx-primary-text")}
    >
      <Icon size={17} aria-hidden="true" />
    </button>
  );
}

/**
 * Hold to talk (or tap once to start and again to stop). While listening the words appear in the message box;
 * letting go sends them. The first use explains where speech goes before the microphone is switched on.
 */
export function VoiceButton({
  disabled,
  onTranscript,
  onFinished,
  onStart,
}: {
  disabled: boolean;
  onTranscript: (text: string) => void;
  onFinished: (text: string) => void;
  onStart?: () => void;
}) {
  const supported = useRecognitionSupport();
  const [listening, setListening] = useState(false);
  const [explain, setExplain] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const finals = useRef<string[]>([]);
  const heard = useRef("");
  const pressedAt = useRef(0);
  const latched = useRef(false);
  const callbacks = useRef({ onTranscript, onFinished });
  useEffect(() => {
    callbacks.current = { onTranscript, onFinished };
  }, [onTranscript, onFinished]);

  useEffect(() => () => recognition.current?.abort(), []);

  const begin = useCallback(() => {
    const Klass = recognitionClass();
    if (!Klass || recognition.current) return;
    setProblem(null);
    onStart?.();
    const instance = new Klass();
    instance.lang = recognitionLang(navigator.language);
    instance.interimResults = true;
    instance.continuous = true;
    instance.maxAlternatives = 1;
    finals.current = [];
    heard.current = "";
    instance.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finals.current.push(result[0].transcript);
        else interim += result[0].transcript;
      }
      heard.current = joinTranscript(finals.current, interim);
      callbacks.current.onTranscript(heard.current);
    };
    instance.onerror = (event) => setProblem(voiceErrorText(event.error));
    instance.onend = () => {
      recognition.current = null;
      latched.current = false;
      setListening(false);
      const text = heard.current.trim();
      if (text) callbacks.current.onFinished(text);
    };
    recognition.current = instance;
    try {
      instance.start();
      setListening(true);
    } catch {
      recognition.current = null;
      setProblem("Voice couldn't start. Please try again.");
    }
  }, [onStart]);

  const end = useCallback(() => {
    recognition.current?.stop();
  }, []);

  const press = () => {
    if (disabled) return;
    if (read(VOICE_OK_KEY) !== "yes") {
      setExplain(true);
      return;
    }
    if (recognition.current) {
      // A tap while latched on stops it.
      end();
      return;
    }
    pressedAt.current = Date.now();
    latched.current = false;
    begin();
  };
  const release = () => {
    if (!recognition.current || latched.current) return;
    if (Date.now() - pressedAt.current < TAP_MS) {
      latched.current = true;
      return;
    }
    end();
  };

  if (!supported) return null;
  return (
    <div className={styles.voice}>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={listening}
        aria-label={listening ? "Stop talking" : "Hold to talk"}
        title="Hold to talk, or tap to start and tap again to stop"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          press();
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onKeyDown={(event) => {
          if ((event.key === " " || event.key === "Enter") && !event.repeat) {
            event.preventDefault();
            press();
          }
        }}
        onKeyUp={(event) => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            release();
          }
        }}
        onContextMenu={(event) => event.preventDefault()}
        className={cn(styles.round, styles.mic, listening && styles.live)}
      >
        <span aria-hidden="true" className={styles.ring} />
        <Mic size={18} aria-hidden="true" />
      </button>
      <p className="sr-only" aria-live="assertive">{listening ? "Listening" : ""}</p>
      {problem && (
        <p role="status" className={styles.problem}>
          {problem}
          <button type="button" onClick={() => setProblem(null)} className={styles.link}>OK</button>
        </p>
      )}
      {explain && (
        <div role="dialog" aria-modal="false" aria-labelledby="coach-voice-title" className={styles.explain}>
          <h3 id="coach-voice-title" className={styles.explainTitle}>Talk to your coach</h3>
          <p className={styles.explainText}>{VOICE_PRIVACY}</p>
          <div className={styles.explainActions}>
            <button type="button" className="fitx-button" onClick={() => {
              write(VOICE_OK_KEY, "yes");
              setExplain(false);
            }}>
              Turn on voice
            </button>
            <button type="button" className={styles.link} onClick={() => setExplain(false)}>Not now</button>
          </div>
        </div>
      )}
    </div>
  );
}
