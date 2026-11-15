"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type ThemeMode = "light" | "dark" | "system";

const THEME_KEY = "fitx-theme";
const THEME_EVENT = "fitx-theme-change";

function subscribe(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}

function getTheme(): ThemeMode {
  const mode = document.documentElement.dataset.theme;
  return mode === "dark" || mode === "system" ? mode : "light";
}

function getServerTheme(): ThemeMode { return "light"; }

export function ThemeSwitcher() {
  const theme = useSyncExternalStore(subscribe, getTheme, getServerTheme);

  useEffect(() => {
    let stored: string | null = null;
    try { stored = window.localStorage.getItem(THEME_KEY); } catch { /* System mode remains available. */ }
    const mode: ThemeMode = stored === "light" || stored === "dark" || stored === "system" ? stored : "light";
    document.documentElement.dataset.theme = mode;
    window.dispatchEvent(new Event(THEME_EVENT));
  }, []);

  function cycleTheme() {
    const next: ThemeMode = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // The current tab still changes theme if storage is unavailable.
    }
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";

  return (
    <button
      type="button"
      className="theme-switcher"
      aria-label={`Current theme: ${theme}. Switch to ${next} theme.`}
      title={`Theme: ${theme}`}
      onClick={cycleTheme}
    >
      <Icon size={17} aria-hidden="true" />
    </button>
  );
}
