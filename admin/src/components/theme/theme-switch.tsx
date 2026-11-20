"use client";

import { useId, useState, useTransition } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { ADMIN_THEME_LABELS, ADMIN_THEMES, themeAttribute, type AdminTheme } from "./theme";
import { saveAdminTheme } from "./theme-actions";
import styles from "./theme-switch.module.css";

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

/**
 * Light, dark or system. The page switches at once (the <html> attribute), then the choice is kept in a
 * cookie so the server paints the next page in it. Arrow keys move between the three, as in any radio group.
 */
export function ThemeSwitch({ initial }: { initial: AdminTheme }) {
  const [theme, setTheme] = useState<AdminTheme>(initial);
  const [, startTransition] = useTransition();
  const name = useId();

  function choose(next: AdminTheme) {
    setTheme(next);
    const attribute = themeAttribute(next);
    const root = document.documentElement;
    if (attribute) root.setAttribute("data-theme", attribute);
    else root.removeAttribute("data-theme");
    startTransition(() => saveAdminTheme(next));
  }

  return (
    <fieldset className={styles.switch}>
      <legend className="sr-only">Theme</legend>
      {ADMIN_THEMES.map((option) => {
        const Icon = ICONS[option];
        return (
          <label key={option} className={styles.option} title={ADMIN_THEME_LABELS[option]}>
            <input type="radio" name={name} value={option} checked={theme === option} onChange={() => choose(option)} />
            <Icon aria-hidden="true" size={16} />
            <span className="sr-only">{ADMIN_THEME_LABELS[option]}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
